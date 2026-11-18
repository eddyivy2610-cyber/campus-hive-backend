import { Router } from "express";
import { requireAdmin } from "../middlewares/auth.middleware.ts";
import { adminUpdateStoreStatus } from "../controllers/admin.controller.ts";

const router = Router();

router.patch("/stores/:id", requireAdmin, adminUpdateStoreStatus);

export default router;
