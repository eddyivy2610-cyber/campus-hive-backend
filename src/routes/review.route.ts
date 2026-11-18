import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import { createReview } from "../controllers/review.controller.ts";

const router = Router();

router.post("/", authenticate, createReview);

export default router;
