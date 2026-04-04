import { Router } from "express";
import { submitIdentityVerification, getPendingVerifications, reviewVerification, getAllVerifications } from "../controllers/verification.controller.js";

const router = Router();

// Regular users can submit
router.post("/submit", submitIdentityVerification);

// Admin can fetch and review
router.get("/pending", getPendingVerifications);
router.get("/all", getAllVerifications);
router.patch("/review/:id", reviewVerification);

export default router;
