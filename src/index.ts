import dotenv from "dotenv";
dotenv.config();

import express, { type Request, type Response } from "express";
import { createServer } from "http";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import compression from "compression";
import cookieParser from "cookie-parser";
import indexRouter from "./routes/index.route.ts";

const app = express();
const port = process.env.PORT || 5000;

app.set("trust proxy", 1);

app.use(helmet());
app.use(
  helmet.contentSecurityPolicy({
    directives: { defaultSrc: "'self'", scriptSrc: "'self'" },
  })
);
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "QUERY"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.use(compression());
app.use(cookieParser());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
});
app.use(limiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req: Request, res: Response) => res.status(200).json({ status: "ok" }));

app.use("/api/v1", indexRouter);

app.use((req: Request, res: Response) => {
  return res.status(404).json({ message: "Route not found" });
});

const httpServer = createServer(app);

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
