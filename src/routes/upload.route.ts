import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import { signUpload } from "../controllers/upload.controller.ts";

const router = Router();

router.post("/sign", authenticate, signUpload);

export default router;
