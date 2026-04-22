import { Router } from "express";
import { getAllOrdersAdmin, createOrder, getSellerOrders } from "../controllers/order.controller.js";
import { protect } from "../utils/auth.js";

const router = Router();

router.post("/create", protect, createOrder);
router.get("/seller/all", protect, getSellerOrders);

// Admin / Internal access
router.get("/admin/all", protect, getAllOrdersAdmin);

export default router;
