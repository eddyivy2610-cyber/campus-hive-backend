import { Router } from "express";
import { checkEmailAndPhoneExists, getProfileByHandle, login, updateToUserPassword, googleLogin, refreshToken } from "../controllers/auth.controller.js";
import { protect } from "../utils/auth.js";

const router = Router();

// Remaining Express authentication routes (Registration & OTP routes migrated to Next.js API)
router.post("/login", login);
router.post("/check-email-and-phone-exists", checkEmailAndPhoneExists);
router.patch("/update-user-password", updateToUserPassword);
router.post("/google-login", googleLogin);
router.get("/refresh-token", protect, refreshToken);

router.get("/profile/:handle", getProfileByHandle);
export default router;
