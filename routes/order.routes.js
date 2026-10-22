import { Router } from "express";
import { getAllOrdersAdmin, createOrder, getSellerOrders } from "../controllers/order.controller.js";
import { protect } from "../utils/auth.js";

const router = Router();

// Middleware to emit deprecation warning header for legacy Express order routes
router.use((req, res, next) => {
  res.setHeader("Deprecation", "@deprecated Use Next.js /api/orders");
  next();
});

router.post("/create", protect, createOrder);
router.get("/seller/all", protect, getSellerOrders);

// Admin / Internal access
router.get("/admin/all", protect, getAllOrdersAdmin);

export default router;
