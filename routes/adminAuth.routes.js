import { Router } from "express";
import { adminSignUp, adminSignIn } from "../controllers/adminAuth.controller.js";

const router = Router();

router.post("/signup", adminSignUp);
router.post("/signin", adminSignIn);

export default router;
