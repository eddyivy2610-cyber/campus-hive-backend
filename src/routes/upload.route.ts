import express, { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import { uploadActionRateLimiter } from "../lib/rateLimit.ts";
import { signUpload, uploadFileFallback } from "../controllers/upload.controller.ts";

const router = Router();

router.post(
  "/",
  authenticate,
  uploadActionRateLimiter,
  express.raw({ type: ["multipart/form-data", "application/octet-stream"], limit: "10mb" }),
  uploadFileFallback
);
router.post("/sign", authenticate, uploadActionRateLimiter, signUpload);
router.post("/signature", authenticate, uploadActionRateLimiter, signUpload);

export default router;
