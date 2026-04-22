import { Router } from "express";
import { getAdminLogs } from "../controllers/adminLogs.controller.js";
import { adminProtect } from "../utils/auth.js";

const router = Router();

router.get("/", adminProtect, getAdminLogs);

export default router;
