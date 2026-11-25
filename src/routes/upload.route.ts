import express, { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import { signUpload, uploadFileFallback } from "../controllers/upload.controller.ts";

const router = Router();

router.post(
  "/",
  authenticate,
  express.raw({ type: ["multipart/form-data", "application/octet-stream"], limit: "10mb" }),
  uploadFileFallback
);
router.post("/sign", authenticate, signUpload);

export default router;
