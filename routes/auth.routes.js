import { checkEmailAndPhoneExists, getProfileByHandle, login, sendOtpToEmail, updateToUserPassword, verifyEmail, verifyEmailAndOTP, googleLogin, register } from "../controllers/auth.controller.js";

const router = Router();

router.post("/login", login );
router.post("/verify-email", verifyEmail);
router.post("/send-otp-to-email", sendOtpToEmail);
router.post("/check-email-and-phone-exists", checkEmailAndPhoneExists);
router.post("/verify-otp", verifyEmailAndOTP);
router.patch("/update-user-password", updateToUserPassword);
router.post("/register", register);
router.post("/google-login", googleLogin);
// router.post("/refresh-token", );
// router.post("/logout", );

router.get("/profile/:handle", getProfileByHandle);
export default router;