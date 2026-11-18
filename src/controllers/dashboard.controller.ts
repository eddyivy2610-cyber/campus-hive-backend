import { Response } from "express";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";

export async function getSellerStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const role = req.auth?.role;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const requestedSellerId =
      typeof req.query.sellerId === "string" ? req.query.sellerId.trim() : "";

    let targetSellerId = userId;
    if (requestedSellerId && requestedSellerId !== userId) {
      if (role !== "ADMIN") {
        res.status(403).json({
          message: "Forbidden: cannot access another seller's statistics",
          error: "forbidden",
        });
        return;
      }
      targetSellerId = requestedSellerId;
    }

    const scopedStoreId =
      typeof req.query.storeId === "string" ? req.query.storeId.trim() : "";

    const orderWhere: any = { sellerId: targetSellerId };
    if (scopedStoreId) {
      orderWhere.storeId = scopedStoreId;
    }

    const [storesCount, activeListingsCount, orderGroups, reviewsCount] = await Promise.all([
      prisma.store.count({ where: { ownerId: targetSellerId, status: { not: "deleted" } } }),
      prisma.listing.count({ where: { sellerId: targetSellerId, status: "active" } }),
      prisma.order.groupBy({
        by: ["status"],
        where: orderWhere,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      prisma.review.count({ where: { sellerId: targetSellerId } }),
    ]);

    const byStatus: Record<string, number> = {
      pending: 0,
      confirmed: 0,
      processing: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
      disputed: 0,
    };
    let totalOrders = 0;
    let completedOrderValue = 0;
    let activeOrderValue = 0;

    for (const g of orderGroups) {
      const st = String(g.status || "");
      const cnt = Number(g._count?._all ?? 0);
      const amt = Number(g._sum?.totalAmount ?? 0);
      if (st in byStatus) byStatus[st] = cnt;
      totalOrders += cnt;
      if (st === "delivered") {
        completedOrderValue += amt;
      } else if (st === "pending" || st === "confirmed" || st === "processing" || st === "shipped") {
        activeOrderValue += amt;
      }
    }

    const activeOrdersCount =
      byStatus.pending + byStatus.confirmed + byStatus.processing + byStatus.shipped;
    const completedOrdersCount = byStatus.delivered;
    const cancelledOrdersCount = byStatus.cancelled;
    const disputedOrdersCount = byStatus.disputed;

    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({
      success: true,
      data: {
        sellerId: targetSellerId,
        scopedStoreId: scopedStoreId || null,
        storesCount,
        activeListingsCount,
        ordersCount: totalOrders,
        reviewsCount,
        orders: {
          totalOrders,
          byStatus,
          activeOrdersCount,
          completedOrdersCount,
          cancelledOrdersCount,
          disputedOrdersCount,
        },
        orderValue: {
          completedOrderValue,
          activeOrderValue,
          currency: "NGN",
        },
      },
    });
  } catch (err) {
    console.error("Seller stats error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
