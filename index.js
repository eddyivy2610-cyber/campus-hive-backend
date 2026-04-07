import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import clusters from "cluster";
import os from "os";
import routes from "./routes/index.js";
import { connectDB } from "./utils/db.js";

const app = express();
const port = process.env.PORT || 4000;

// Security middlewares
app.use(helmet({
  contentSecurityPolicy: false,
}));

// CORS configuration supporting dynamic origins from environment variable
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ["*"];
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs,
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Health check routes
app.get("/", (req, res) => {
  res.status(200).json({ message: "Campus Market API is running", status: "ok" });
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// API Routes
app.use("/api", routes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong", error: process.env.NODE_ENV === 'development' ? err.message : undefined });
});

// Database connection
await connectDB();

// Cluster mode or Single process
const useClustering = process.env.USE_CLUSTERING === 'true';

if (useClustering && clusters.isPrimary) {
  const numCPUs = os.cpus().length;
  console.log(`Master ${process.pid} setting up ${numCPUs} workers...`);

  for (let i = 0; i < numCPUs; i++) {
    clusters.fork();
  }

  clusters.on("online", (worker) => {
    console.log(`Worker ${worker.process.pid} is online`);
  });

  clusters.on("exit", (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Starting a new worker...`);
    clusters.fork();
  });
} else {
  app.listen(port, () => {
    console.log(`Server is running on port ${port} (PID: ${process.pid})`);
  });
}
