import { Router } from "express";
import { signup, signupVerification } from "../controllers/signup.controller.ts";
import { requestNewVerificationTokenCode, requestVerificationForForgetPassword, verifyVerificationForForgetPassword } from "../controllers/verification-token.controller.ts";
import { getMe, logout, logoutAll, processVerificationForForgetPassword, refreshToken } from "../controllers/auth.controller.ts";
import { signin } from "../controllers/signin.controller.ts";
import { authenticate } from "../middlewares/auth.middleware.ts";
import { loginRateLimiter, otpIpRateLimiter } from "../lib/rateLimit.ts";

const router = Router();

router.post("/sign-up", otpIpRateLimiter, signup);
router.post("/sign-up/verify-email/:token", signupVerification);

// User sign in
router.post("/sign-in", loginRateLimiter, signin);

// session refresh 
router.post("/refresh", refreshToken);

// Request new otp code for verification
// General endpoint for requesting a new otp code
router.get("/verify-email/:token/new", otpIpRateLimiter, requestNewVerificationTokenCode);

router.post("/forget-password", otpIpRateLimiter, requestVerificationForForgetPassword);
router.post("/forget-password/:token", verifyVerificationForForgetPassword);
router.put("/forget-password/:token/new-password", processVerificationForForgetPassword);

router.get("/me", authenticate, getMe);
router.post("/logout", authenticate, logout);
router.post("/logout-all", authenticate, logoutAll);

export default router;