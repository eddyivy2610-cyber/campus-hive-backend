import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import { reviewWriteRateLimiter } from "../lib/rateLimit.ts";
import { createReview, getReviews } from "../controllers/review.controller.ts";

const router = Router();

router.get("/", getReviews);
router.post("/", authenticate, reviewWriteRateLimiter, createReview);

export default router;
