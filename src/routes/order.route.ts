import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import { createOrder, transitionOrderStatus } from "../controllers/order.controller.ts";

const router = Router();

router.post("/", authenticate, createOrder);
router.patch("/:id/status", authenticate, transitionOrderStatus);

export default router;
