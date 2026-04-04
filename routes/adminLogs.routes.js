import { Router } from "express";
import { getAdminLogs } from "../controllers/adminLogs.controller.js";

const router = Router();

router.get("/", getAdminLogs);

export default router;
