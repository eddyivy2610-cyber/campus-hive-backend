import { Router } from "express";
import { signup, signupVerification } from "../controllers/signup.controller.ts";
import { requestNewVerificationTokenCode, requestVerificationForForgetPassword, verifyVerificationForForgetPassword } from "../controllers/verification-token.controller.ts";
import { processVerificationForForgetPassword, refreshToken } from "../controllers/auth.controller.ts";
import { signin } from "../controllers/signin.controller.ts";

const router = Router();

router.post("/sign-up", signup);
router.post("/sign-up/verify-email/:token", signupVerification);

// User sign in
router.post("/sign-in", signin);

// session refresh 
router.put("/refresh/:token", refreshToken);

// Request new otp code for verification
// General endpoint for requesting a new otp code
router.get("/verify-email/:token/new", requestNewVerificationTokenCode);

router.post("/forget-password", requestVerificationForForgetPassword);
router.post("/forget-password/:token", verifyVerificationForForgetPassword);
router.put("/forget-password/:token/new-password", processVerificationForForgetPassword);

export default router;