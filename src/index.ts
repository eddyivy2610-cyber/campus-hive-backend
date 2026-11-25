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

// CSRF protection: reject state-changing requests with untrusted Origin header
app.use((req: Request, res: Response, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return res.status(403).json({
        message: "CSRF check failed: untrusted Origin",
        error: "csrf_origin_rejected",
      });
    }
  }
  next();
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 10000 : 100,
  message: "Too many requests from this IP, please try again later.",
});
app.use(limiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
