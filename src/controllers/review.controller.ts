import { Response } from "express";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";

export async function createReview(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const reviewerId = req.auth?.userId;
    if (!reviewerId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const { orderId, rating, comment } = req.body || {};
    if (!orderId || typeof orderId !== "string") {
      res.status(400).json({ message: "orderId is required", error: "bad_request" });
      return;
    }
    const numericRating = Number(rating);
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      res.status(400).json({ message: "rating must be an integer between 1 and 5", error: "bad_request" });
      return;
    }
    if (!comment || typeof comment !== "string" || !comment.trim()) {
      res.status(400).json({ message: "comment is required", error: "bad_request" });
      return;
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      res.status(404).json({ message: "Order not found", error: "not_found" });
      return;
    }
    if (order.buyerId !== reviewerId) {
      res.status(403).json({ message: "Forbidden: only the buyer can review this order", error: "forbidden" });
      return;
    }
    if (order.status !== "delivered" && order.status !== "completed") {
      res.status(400).json({ message: "Order must be delivered before reviewing", error: "bad_request" });
      return;
    }

    const review = await prisma.review.create({
      data: {
        orderId,
        reviewerId,
        sellerId: order.sellerId,
        rating: numericRating,
        comment: comment.trim(),
      },
    });

    res.status(201).json({ success: true, data: review });
  } catch (err: any) {
    if (err?.code === "P2002") {
      res.status(409).json({
        message: "Review already exists for this order",
        error: "duplicate_review",
      });
      return;
    }
    console.error("Error creating review:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
