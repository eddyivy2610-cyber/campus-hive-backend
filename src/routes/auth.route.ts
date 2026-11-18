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

// Frontend (campushive) compatibility aliases
router.post("/register", otpIpRateLimiter, signup);
router.post("/login", loginRateLimiter, signin);
router.post("/password-reset/request", otpIpRateLimiter, requestVerificationForForgetPassword);
router.post("/password-reset/confirm", processVerificationForForgetPassword);
router.post("/verify-otp", async (req: Request, res: Response) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const otp = req.body?.otp ?? req.body?.code;
  if (otp !== undefined) req.body.otp = otp;
  if (!req.params.token && email) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      const vt = await prisma.verificationToken.findFirst({
        where: { userId: user.id, type: "SIGNUP", verified: false },
        orderBy: { createdAt: "desc" },
        select: { token: true },
      });
      if (vt) req.params.token = vt.token;
    }
  }
  return signupVerification(req, res);
});

export default router;