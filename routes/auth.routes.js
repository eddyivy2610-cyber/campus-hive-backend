import { Router } from "express";
import { checkEmailAndPhoneExists, login, sendOtpToEmail, updateToUserPassword, verifyEmail, verifyEmailAndCreateTempData } from "../controllers/auth.controller.js";
import { register } from "../controllers/user.controller.js";

const router = Router();

router.post("/login", login );
router.post("/verify-email", verifyEmail);
router.post("/send-otp-to-email", sendOtpToEmail);
router.post("/check-email-and-phone-exists", checkEmailAndPhoneExists);
router.post("/send-otp-to-email", sendOtpToEmail);
router.post("/verify-email-and-create-temp-data", verifyEmailAndCreateTempData);
router.patch("/update-user-password", updateToUserPassword);
router.post("/register", register);
// router.post("/refresh-token", );
// router.post("/logout", );

export default router;