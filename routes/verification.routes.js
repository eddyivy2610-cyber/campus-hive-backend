import { Router } from "express";
import { submitIdentityVerification, getPendingVerifications, reviewVerification, getAllVerifications } from "../controllers/verification.controller.js";
import { protect, adminProtect } from "../utils/auth.js";

const router = Router();

// Regular users can submit
router.post("/submit", protect, submitIdentityVerification);

// Admin can fetch and review
router.get("/pending", adminProtect, getPendingVerifications);
router.get("/all", adminProtect, getAllVerifications);
router.patch("/review/:id", adminProtect, reviewVerification);

export default router;
