import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import { orderWriteRateLimiter } from "../lib/rateLimit.ts";
import { createOrder, transitionOrderStatus } from "../controllers/order.controller.ts";

const router = Router();

router.post("/", authenticate, orderWriteRateLimiter, createOrder);
router.patch("/:id/status", authenticate, orderWriteRateLimiter, transitionOrderStatus);

export default router;
