import { Response } from "express";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";

const VALID_FROM_STATUSES: Record<string, string[]> = {
  processing: ["pending"],
  delivered: ["processing"],
  disputed: ["processing"],
  cancelled: ["pending", "processing"],
  completed: ["delivered"],
};

export async function createOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const buyerId = req.auth?.userId;
    if (!buyerId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const { sellerId, storeId, totalAmount } = req.body || {};
    if (!sellerId || typeof sellerId !== "string") {
      res.status(400).json({ message: "sellerId is required", error: "bad_request" });
      return;
    }

    const order = await prisma.order.create({
      data: {
        buyerId,
        sellerId,
        storeId: typeof storeId === "string" ? storeId : null,
        status: "processing",
        totalAmount: Number.isFinite(Number(totalAmount)) ? Number(totalAmount) : 0,
      },
    });

    res.status(201).json({ success: true, data: order });
  } catch (err) {
    console.error("Error creating order:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function transitionOrderStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const orderId = String(req.params.id || "");
    const { status: nextStatus } = req.body || {};

    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }
    if (!nextStatus || typeof nextStatus !== "string" || !VALID_FROM_STATUSES[nextStatus]) {
      res.status(400).json({ message: "Invalid target order status", error: "bad_request" });
      return;
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      res.status(404).json({ message: "Order not found", error: "not_found" });
      return;
    }
    if (order.buyerId !== userId && order.sellerId !== userId) {
      res.status(403).json({ message: "Forbidden: not order participant", error: "forbidden" });
      return;
    }

    const allowedFrom = VALID_FROM_STATUSES[nextStatus];
    const updated = await prisma.order.updateMany({
      where: {
        id: orderId,
        status: { in: allowedFrom },
      },
      data: {
        status: nextStatus,
      },
    });

    if (updated.count === 0) {
      res.status(409).json({
        message: "Order status transition conflict",
        error: "status_conflict",
      });
      return;
    }

    const latest = await prisma.order.findUnique({ where: { id: orderId } });
    res.status(200).json({ success: true, data: latest });
  } catch (err) {
    console.error("Error transitioning order:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
