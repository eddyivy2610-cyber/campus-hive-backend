import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import { getSellerStats } from "../controllers/dashboard.controller.ts";

const router = Router();

router.get("/seller-stats", authenticate, getSellerStats);

export default router;
