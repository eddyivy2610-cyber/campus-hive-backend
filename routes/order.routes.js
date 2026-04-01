import { Router } from "express";
import { getAllOrdersAdmin, createOrder } from "../controllers/order.controller.js";

const router = Router();

router.post("/create", createOrder);

// Admin / Internal access
router.get("/admin/all", getAllOrdersAdmin);

export default router;
