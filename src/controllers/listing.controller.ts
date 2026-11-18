import { Request, Response } from "express";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";
import { toPublicListing } from "../lib/serializers.ts";

const PUBLIC_LISTING_SELECT = {
  id: true,
  storeId: true,
  title: true,
  description: true,
  price: true,
  category: true,
  campus: true,
  location: true,
  status: true,
  createdAt: true,
} as const;

export async function createListing(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const { storeId, title, description, price, category, campus, location, images } = req.body || {};
    if (Array.isArray(images)) {
      for (const imgUrl of images) {
        if (
          typeof imgUrl === "string" &&
          (imgUrl.includes("/authenticated/") || imgUrl.includes("campushive/private_docs"))
        ) {
          res.status(400).json({
            message: "Private business documents cannot be attached to public listings",
            error: "bad_request",
          });
          return;
        }
      }
    }
    if (!storeId || typeof storeId !== "string") {
      res.status(400).json({ message: "storeId is required", error: "bad_request" });
      return;
    }
    if (!title || typeof title !== "string" || !title.trim()) {
      res.status(400).json({ message: "title is required", error: "bad_request" });
      return;
    }
    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      res.status(400).json({ message: "Valid non-negative price is required", error: "bad_request" });
      return;
    }

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
      res.status(404).json({ message: "Store not found", error: "not_found" });
      return;
    }
    if (store.ownerId !== userId) {
      res.status(403).json({ message: "Forbidden: not store owner", error: "forbidden" });
      return;
    }
    if (store.status !== "active") {
      res.status(403).json({ message: "Store is suspended or inactive", error: "store_not_active" });
      return;
    }

    const listing = await prisma.listing.create({
      data: {
        storeId: store.id,
        sellerId: userId,
        title: title.trim(),
        description: typeof description === "string" ? description : null,
        price: numericPrice,
        category: typeof category === "string" ? category : null,
        campus: typeof campus === "string" ? campus : store.campus,
        location: typeof location === "string" ? location : store.operatingLocation,
      },
      select: PUBLIC_LISTING_SELECT,
    });

    res.status(201).json({ success: true, data: listing });
  } catch (err) {
    console.error("Error creating listing:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function updateListing(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const id = String(req.params.id || "");
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const existing = await prisma.listing.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Listing not found", error: "not_found" });
      return;
    }
    if (existing.sellerId !== userId) {
      res.status(403).json({ message: "Forbidden: not listing owner", error: "forbidden" });
      return;
    }

    const { title, description, price, category, campus, location, status } = req.body || {};
    const updated = await prisma.listing.update({
      where: { id },
      data: {
        ...(typeof title === "string" && title.trim() ? { title: title.trim() } : {}),
        ...(typeof description === "string" ? { description } : {}),
        ...(price !== undefined && Number.isFinite(Number(price)) ? { price: Number(price) } : {}),
        ...(typeof category === "string" ? { category } : {}),
        ...(typeof campus === "string" ? { campus } : {}),
        ...(typeof location === "string" ? { location } : {}),
        ...(typeof status === "string" ? { status } : {}),
      },
      select: PUBLIC_LISTING_SELECT,
    });

    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    console.error("Error updating listing:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function deleteListing(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const id = String(req.params.id || "");
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const existing = await prisma.listing.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Listing not found", error: "not_found" });
      return;
    }
    if (existing.sellerId !== userId) {
      res.status(403).json({ message: "Forbidden: not listing owner", error: "forbidden" });
      return;
    }

    await prisma.listing.delete({ where: { id } });
    res.status(200).json({ success: true, message: "Listing deleted" });
  } catch (err) {
    console.error("Error deleting listing:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function listFeed(req: Request, res: Response): Promise<void> {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit || "20"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;
    const cursorRaw = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const campus = typeof req.query.campus === "string" ? req.query.campus.trim() : "";

    let cursorFilter: any = undefined;
    if (cursorRaw) {
      try {
        const parsed = JSON.parse(Buffer.from(cursorRaw, "base64url").toString("utf8"));
        const cursorDate = new Date(parsed.createdAt);
        const cursorId = String(parsed.id || "");
        if (!isNaN(cursorDate.getTime()) && cursorId) {
          cursorFilter = {
            OR: [
              { createdAt: { lt: cursorDate } },
              { createdAt: cursorDate, id: { lt: cursorId } },
            ],
          };
        }
      } catch {
        res.status(400).json({ message: "Invalid cursor", error: "bad_cursor" });
        return;
      }
    }

    const where: any = {
      status: "active",
      store: { status: "active" },
      ...(category ? { category } : {}),
      ...(campus ? { campus } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(cursorFilter ? cursorFilter : {}),
    };

    const rows = await prisma.listing.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: PUBLIC_LISTING_SELECT,
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(toPublicListing);
    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id }),
        "utf8"
      ).toString("base64url");
    }

    res.status(200).json({
      success: true,
      data: items,
      pagination: {
        nextCursor,
        hasMore,
      },
    });
  } catch (err) {
    console.error("Error listing feed:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
