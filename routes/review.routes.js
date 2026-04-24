import { Router } from "express";
import { createReview, getSellerReviews } from "../controllers/review.controller.js";
import { protect } from "../utils/auth.js";

const router = Router();

router.get("/seller/:sellerId", getSellerReviews);
router.post("/", protect, createReview);

export default router;
