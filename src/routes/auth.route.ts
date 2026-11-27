import { Router, Request, Response } from "express";
import prisma from "../prisma.ts";
import { signup, signupVerification } from "../controllers/signup.controller.ts";
import { requestNewVerificationTokenCode, requestVerificationForForgetPassword, verifyVerificationForForgetPassword } from "../controllers/verification-token.controller.ts";
import { getMe, logout, logoutAll, processVerificationForForgetPassword, refreshToken } from "../controllers/auth.controller.ts";
import { signin } from "../controllers/signin.controller.ts";
import { authenticate } from "../middlewares/auth.middleware.ts";
import { loginRateLimiter, otpIpRateLimiter } from "../lib/rateLimit.ts";

const router = Router();

router.post("/sign-up", otpIpRateLimiter, signup);
router.post("/sign-up/verify-email/:token", otpIpRateLimiter, signupVerification);

// User sign in
router.post("/sign-in", loginRateLimiter, signin);

// session refresh 
router.post("/refresh", refreshToken);

// Request new otp code for verification
// General endpoint for requesting a new otp code (POST preferred; GET retained for legacy test compatibility)
router.post("/verify-email/:token/new", otpIpRateLimiter, requestNewVerificationTokenCode);
router.get("/verify-email/:token/new", otpIpRateLimiter, requestNewVerificationTokenCode);

router.post("/forget-password", otpIpRateLimiter, requestVerificationForForgetPassword);
router.post("/forget-password/:token", otpIpRateLimiter, verifyVerificationForForgetPassword);
router.put("/forget-password/:token/new-password", otpIpRateLimiter, processVerificationForForgetPassword);

router.get("/me", authenticate, getMe);
router.post("/logout", authenticate, logout);
router.post("/logout-all", authenticate, logoutAll);

// Frontend (campushive) compatibility aliases
router.post("/register", otpIpRateLimiter, signup);
router.post("/login", loginRateLimiter, signin);
router.post("/password-reset/request", otpIpRateLimiter, requestVerificationForForgetPassword);
router.post("/password-reset/confirm", otpIpRateLimiter, processVerificationForForgetPassword);
router.post("/verify-otp", otpIpRateLimiter, async (req: Request, res: Response) => {
  try {
    req.params = req.params || {};
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const otp = req.body?.otp ?? req.body?.code;
    if (otp !== undefined) req.body.otp = otp;
    if (!req.params.token && email) {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (user) {
        const vt = await prisma.verificationToken.findFirst({
          where: {
            userId: user.id,
            type: "EMAIL_VERIFICATION_SIGNUP",
            verified: false,
          },
          orderBy: { createdAt: "desc" },
          select: { token: true },
        });
        if (vt) req.params.token = vt.token;
      }
    }
    return await signupVerification(req, res);
  } catch (err) {
    console.error("[verify-otp alias] Error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

async function handleResendByEmail(req: Request, res: Response) {
  try {
    req.params = req.params || {};
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!req.params.token && email) {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (user) {
        const vt = await prisma.verificationToken.findFirst({
          where: {
            userId: user.id,
            type: "EMAIL_VERIFICATION_SIGNUP",
            verified: false,
          },
          orderBy: { createdAt: "desc" },
          select: { token: true },
        });
        if (vt) req.params.token = vt.token;
      }
    }
    if (!req.params.token) {
      res.status(200).json({
        success: true,
        message: "If an unverified account exists for this email, a new verification code has been sent.",
      });
      return;
    }
    return await requestNewVerificationTokenCode(req, res);
  } catch (err) {
    console.error("[send-otp alias] Error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

router.post("/send-otp-to-email", otpIpRateLimiter, handleResendByEmail);
router.post("/resend-verification", otpIpRateLimiter, handleResendByEmail);
router.post("/send-otp", otpIpRateLimiter, handleResendByEmail);

export default router;