import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
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

// Basic Rate limiting for security
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
  res.status(200).json({ message: "Campus Market API is live", status: "ok" });
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
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
