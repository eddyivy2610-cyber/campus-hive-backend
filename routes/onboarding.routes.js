import { Router } from "express";
import { updateOnboardingChoice, applyAsSeller, finalizeSellerProfile } from "../controllers/onboarding.controller.js";
import { protect } from "../utils/auth.js";
import upload from "../middleware/upload.js";

const router = Router();

// All onboarding routes require authentication
router.patch("/choice", protect, updateOnboardingChoice);
router.post("/apply-seller", protect, upload.single("idImage"), applyAsSeller);
router.patch("/finalize-seller", protect, finalizeSellerProfile);

// Simulation Routes (for development/testing)
router.post("/admin/approve/:userId", adminApproveSeller);
router.post("/admin/reject/:userId", adminRejectSeller);

export default router;
