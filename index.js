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
app.use(cors({
    origin: process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(',') : "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
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

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something went wrong");
});

await connectDB();

app.use("/api", routes);

if (clusters.isMaster) {
    const numCPUs = os.cpus().length;
    console.log(`Master ${process.pid} cluster setting up ${numCPUs} workers...`);

    for ( let i=0; i<numCPUs; i++) {
        clusters.fork();
    }

    clusters.on("online", (worker) => {
        console.log(`Worker ${worker.process.pid} is online`);
    });

    clusters.on("exit", (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died with code: ${code}, and signal: ${signal}`);
        console.log("Starting a new worker");
        clusters.fork();
    });
} else {
    app.listen(port, () => {
        console.log(`Worker ${process.pid} started`);
        console.log(`Server is running on port ${port}`);
    });
}
