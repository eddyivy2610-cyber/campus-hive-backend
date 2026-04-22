import { Router } from "express";
import { submitIdentityVerification, getPendingVerifications, reviewVerification, getAllVerifications } from "../controllers/verification.controller.js";
import { protect, adminOnly } from "../utils/auth.js";

const router = Router();

// Regular users can submit
router.post("/submit", protect, submitIdentityVerification);

// Admin can fetch and review
router.get("/pending", protect, adminOnly, getPendingVerifications);
router.get("/all", protect, adminOnly, getAllVerifications);
router.patch("/review/:id", protect, adminOnly, reviewVerification);

export default router;
