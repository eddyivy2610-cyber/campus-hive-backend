import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import routes from "./routes/index.js";
import { connectDB } from "./utils/db.js";
import { createServer } from "http";
import { initSocket } from "./socket/index.js";

const app = express();
const httpServer = createServer(app);
const port = process.env.PORT || 4000;

// 1. Position CORS at the VERY TOP to handle preflights before any other logic
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) 
  : ["*"];

app.use(cors({
  origin: (origin, callback) => {
    // If no origin (e.g. server-to-server) or origin is in allowed list, or wildcard is present
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked for origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 200 // Some legacy browsers choke on 204
}));

// 2. Standard security and compression
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

// 3. Rate limiting (after CORS check)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  message: 'Too many requests, please try again later.'
});
app.use(limiter);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Basic health check for Render
app.get("/", (req, res) => {
  res.status(200).json({ message: "Campus Hive API is live", status: "ok" });
});

// API Routes
app.use("/api", routes);

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Internal server error" });
});

// Start Server after DB Connection
await connectDB();

// Initialize Socket.IO
initSocket(httpServer, allowedOrigins);

httpServer.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
