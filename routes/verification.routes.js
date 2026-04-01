import { Router } from "express";
import { submitIdentityVerification, getPendingVerifications, reviewVerification } from "../controllers/verification.controller.js";

const router = Router();

// Regular users can submit
router.post("/submit", submitIdentityVerification);

// Admin can fetch and review
router.get("/pending", getPendingVerifications);
router.patch("/review/:id", reviewVerification);

export default router;
