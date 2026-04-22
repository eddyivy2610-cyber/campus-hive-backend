import { Router } from "express";
import { getAdminLogs } from "../controllers/adminLogs.controller.js";
import { protect, adminOnly } from "../utils/auth.js";

const router = Router();

router.get("/", protect, adminOnly, getAdminLogs);

export default router;
