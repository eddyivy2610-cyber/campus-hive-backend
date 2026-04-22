import { Router } from "express";
import { getSellerDashboardStats } from "../controllers/dashboard.controller.js";
import { protect } from "../utils/auth.js";

const router = Router();

router.get("/seller-stats", protect, getSellerDashboardStats);

export default router;
