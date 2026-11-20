import { Request, Response } from "express";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";

export async function getReviews(req: Request, res: Response): Promise<void> {
  try {
    const sellerId = typeof req.query.sellerId === "string" ? req.query.sellerId.trim() : "";
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor.trim() : "";
    const rawLimit = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 20;

    const where: any = {};
    if (sellerId) {
      where.sellerId = sellerId;
    }

    const rows = await prisma.review.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        reviewer: {
          select: {
            displayName: true,
            fullName: true,
            username: true,
            profileImage: true,
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null;

    res.status(200).json({
      success: true,
      data: slice.map((r) => ({
        id: r.id,
        sellerId: r.sellerId,
        rating: r.rating,
        comment: r.comment,
        images: [],
        createdAt: r.createdAt.toISOString(),
        reviewer: {
          name:
            r.reviewer?.displayName ||
            r.reviewer?.fullName ||
            r.reviewer?.username ||
            "CampusHive Student",
          avatar: r.reviewer?.profileImage || undefined,
        },
      })),
      hasMore,
      nextCursor,
    });
  } catch (err) {
    console.error("Error fetching reviews:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

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
