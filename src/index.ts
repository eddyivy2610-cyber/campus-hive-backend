import dotenv from "dotenv";
dotenv.config();

import express, { type Request, type Response } from "express";
import { createServer } from "http";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import compression from "compression";
import cookieParser from "cookie-parser";
import indexRouter from "./routes/index.route.ts";
import helmet from "helmet";
import { MAX_STORES_PER_USER } from "./lib/config.ts";
import { startRefreshTokenCleanupSchedule } from "./services/session.service.ts";
import prisma from "./prisma.ts";

const app = express();
const port = process.env.PORT || 5000;

app.set(
  "trust proxy",
  process.env.TRUST_PROXY
    ? process.env.TRUST_PROXY === "false"
      ? false
      : Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY
    : process.env.NODE_ENV === "production"
      ? 1
      : "loopback"
);

app.use(helmet());
app.use(
  helmet.contentSecurityPolicy({
    directives: { defaultSrc: "'self'", scriptSrc: "'self'" },
  })
);
const RAW_CLIENT_ORIGINS =
  process.env.CLIENT_ORIGIN ||
  process.env.ALLOWED_ORIGINS ||
  process.env.APP_ALLOWED_ORIGINS ||
  "http://localhost:3000,http://127.0.0.1:3000,http://127.0.0.1:5000,https://campushiveng.vercel.app";

const ALLOWED_ORIGINS = RAW_CLIENT_ORIGINS
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "QUERY"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.use(compression());
app.use(cookieParser());

// CSRF protection: verify Origin (or Referer / Fetch Metadata for cookie-authenticated writes)
app.use((req: Request, res: Response, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin) {
      if (!ALLOWED_ORIGINS.includes(origin.replace(/\/+$/, ""))) {
        return res.status(403).json({
          message: "CSRF check failed: untrusted Origin",
          error: "csrf_origin_rejected",
        });
      }
    } else {
      const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
      if (fetchSite === "cross-site") {
        return res.status(403).json({
          message: "CSRF check failed: cross-site request rejected",
          error: "csrf_cross_site_rejected",
        });
      }
      const referer = req.headers.referer;
      if (referer) {
        try {
          const refOrigin = new URL(referer).origin;
          if (!ALLOWED_ORIGINS.includes(refOrigin)) {
            return res.status(403).json({
              message: "CSRF check failed: untrusted Referer",
              error: "csrf_referer_rejected",
            });
          }
        } catch {
          return res.status(403).json({
            message: "CSRF check failed: malformed Referer",
            error: "csrf_referer_rejected",
          });
        }
      }
      const hasSessionCookies = Boolean(
        req.cookies?.accessToken || req.cookies?.refreshToken
      );
      if (
        hasSessionCookies &&
        !referer &&
        fetchSite !== "same-origin" &&
        fetchSite !== "same-site" &&
        process.env.NODE_ENV === "production"
      ) {
        return res.status(403).json({
          message: "CSRF check failed: Origin or same-origin header required for cookie-authenticated writes.",
          error: "csrf_origin_required",
        });
      }
    }
  }
  next();
});

// Prevent intermediary caching on auth and admin endpoints
app.use(["/api/v1/auth", "/api/v1/admin"], (_req: Request, res: Response, next) => {
  res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  next();
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 10000 : 1500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests from this IP, please try again later." },
});
app.use(limiter);

function stripDangerousKeys(value: unknown, depth = 0): unknown {
  if (depth > 12 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripDangerousKeys(item, depth + 1));
  }
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    clean[k] = stripDangerousKeys(v, depth + 1);
  }
  return clean;
}

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use((req: Request, _res: Response, next) => {
  if (req.body && typeof req.body === "object") {
    req.body = stripDangerousKeys(req.body);
  }
  next();
});

app.get("/health/live", (req: Request, res: Response) => {
  res.setHeader("X-Backend-Identity", "pg-express");
  res.setHeader("Cache-Control", "no-cache, no-store, max-age=0, must-revalidate");
  return res.status(200).json({
    status: "ok",
    backend: "pg-express",
    probe: "liveness",
    environment: process.env.NODE_ENV || "test",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", async (req: Request, res: Response) => {
  res.setHeader("X-Backend-Identity", "pg-express");
  res.setHeader("Cache-Control", "no-cache, no-store, max-age=0, must-revalidate");
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({
      status: "ok",
      backend: "pg-express",
      probe: "readiness",
      environment: process.env.NODE_ENV || "test",
      database: { status: "connected", latencyMs: Date.now() - start },
      config: { maxStoresPerUser: MAX_STORES_PER_USER },
      timestamp: new Date().toISOString(),
    });
  } catch {
    return res.status(503).json({
      success: false,
      status: "degraded",
      backend: "pg-express",
      probe: "readiness",
      environment: process.env.NODE_ENV || "test",
      error: "Database temporarily unavailable. Please try again shortly.",
      database: { status: "disconnected", latencyMs: Date.now() - start },
      timestamp: new Date().toISOString(),
    });
  }
});

app.use("/api/v1", indexRouter);

app.use((req: Request, res: Response) => {
  return res.status(404).json({ message: "Route not found" });
});

const httpServer = createServer(app);
startRefreshTokenCleanupSchedule();

httpServer.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});


// Gracefull server shutdown
const shutdown = async (signal:string) => {
  console.log(`${signal} received, shutting down..`);
  httpServer.close(()=> {
    console.log("HTTP server closed.");
    process.exit(0);
  });

  setTimeout(()=>process.exit(1), 10_00);
}

process.on("SIGTERM", ()=>shutdown("SIGTERM"));
process.on("SIGINT", ()=>shutdown("SIGINT"));
