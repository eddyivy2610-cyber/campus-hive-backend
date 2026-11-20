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

    const listingWhere: any = { sellerId: targetSellerId, status: { not: "deleted" } };
    const storeWhere: any = { ownerId: targetSellerId, status: { not: "deleted" } };
    if (scopedStoreId) {
      listingWhere.storeId = scopedStoreId;
      storeWhere.id = scopedStoreId;
    }

    const [stores, listings, orderGroups, reviewsAgg, recentOrders] = await Promise.all([
      prisma.store.findMany({
        where: storeWhere,
        select: { id: true, name: true, followersCount: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.listing.findMany({
        where: listingWhere,
        select: { id: true, title: true, price: true, category: true, status: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.order.groupBy({
        by: ["status"],
        where: orderWhere,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      prisma.review.aggregate({
        where: { sellerId: targetSellerId },
        _count: { _all: true },
        _avg: { rating: true },
      }),
      prisma.order.findMany({
        where: orderWhere,
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          buyer: { select: { displayName: true, fullName: true, username: true } },
        },
      }),
    ]);

    const storesCount = stores.length;
    const primaryStore = stores[0] || null;
    const activeListings = listings.filter((l) => l.status === "active");
    const activeListingsCount = activeListings.length;
    const inactiveListingsCount = listings.length - activeListingsCount;
    const reviewsCount = Number(reviewsAgg._count?._all ?? 0);
    const storeRating = Number(reviewsAgg._avg?.rating ?? 0);
    const followersCount = stores.reduce((sum, s) => sum + Number(s.followersCount ?? 0), 0);

    const categoryMap = new Map<string, number>();
    for (const l of listings) {
      const cat = l.category || "Other";
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
    }
    const categories = Array.from(categoryMap.entries()).map(([category, count]) => ({
      category,
      count,
    }));

    const formatNaira = (amount: number) => `₦${Math.round(amount).toLocaleString("en-NG")}`;

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
        generatedAt: new Date().toISOString(),
        storesCount,
        activeListingsCount,
        ordersCount: totalOrders,
        reviewsCount,
        listings: {
          total: listings.length,
          active: activeListingsCount,
          inactive: inactiveListingsCount,
          products: listings.length,
          services: 0,
          categories,
        },
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
          completedOrderValueFormatted: formatNaira(completedOrderValue),
          activeOrderValue,
          activeOrderValueFormatted: formatNaira(activeOrderValue),
          currency: "NGN",
        },
        audience: {
          followersCount,
          impressions: 0,
        },
        store: {
          hasStore: storesCount > 0,
          storeId: primaryStore?.id ?? null,
          storeName: primaryStore?.name ?? null,
          storeRating: Number(storeRating.toFixed(1)),
          storedListingsCount: listings.length,
          driftDetected: false,
        },
        recentActivity: recentOrders.map((o) => ({
          id: o.id,
          orderId: o.id,
          status: o.status,
          totalAmount: Number(o.totalAmount ?? 0),
          priceFormatted: formatNaira(Number(o.totalAmount ?? 0)),
          itemSummary: "Order",
          buyerDisplayName:
            o.buyer?.displayName || o.buyer?.fullName || o.buyer?.username || "Buyer",
          createdAt: o.createdAt.toISOString(),
        })),
        topItems: listings.slice(0, 5).map((l) => ({
          id: l.id,
          title: l.title,
          views: 0,
          price: Number(l.price ?? 0),
          priceFormatted: formatNaira(Number(l.price ?? 0)),
          image: "",
          category: l.category || "Other",
          status: l.status,
        })),
      },
    });
  } catch (err) {
    console.error("Seller stats error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
