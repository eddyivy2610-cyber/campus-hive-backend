import crypto from "node:crypto";
import { Request, Response } from "express";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";
import { toPublicListing } from "../lib/serializers.ts";

const VIEW_DEDUP_WINDOW_SECONDS = 24 * 60 * 60;
const devMemoryViewCache = new Map<string, number>();

async function acquireViewDedupLock(key: string): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      const response = await fetch(`${url}/pipeline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          ["SET", key, "1", "EX", String(VIEW_DEDUP_WINDOW_SECONDS), "NX"],
        ]),
      });
      if (response.ok) {
        const data = (await response.json()) as Array<{ result?: string | null }>;
        return data?.[0]?.result === "OK";
      }
    } catch {
      return false;
    }
  }
  const now = Date.now();
  const expiresAt = devMemoryViewCache.get(key);
  if (expiresAt && expiresAt > now) return false;
  devMemoryViewCache.set(key, now + VIEW_DEDUP_WINDOW_SECONDS * 1000);
  if (devMemoryViewCache.size > 5000) {
    const firstKey = devMemoryViewCache.keys().next().value;
    if (firstKey) devMemoryViewCache.delete(firstKey);
  }
  return true;
}

const PUBLIC_LISTING_SELECT = {
  id: true,
  storeId: true,
  title: true,
  description: true,
  price: true,
  category: true,
  campus: true,
  location: true,
  images: true,
  condition: true,
  listingType: true,
  serviceDetails: true,
  slug: true,
  status: true,
  views: true,
  createdAt: true,
} as const;

export async function createListing(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const {
      storeId,
      title,
      description,
      price,
      category,
      campus,
      location,
      images,
      condition,
      listingType,
      serviceDetails,
    } = req.body || {};
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

    const cleanSlugBase = title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    const slug = `${cleanSlugBase || "listing"}-${crypto.randomBytes(4).toString("hex")}`;

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
        images: Array.isArray(images) ? images.filter((u): u is string => typeof u === "string") : [],
        condition: typeof condition === "string" ? condition : null,
        listingType: listingType === "service" ? "service" : "product",
        serviceDetails: serviceDetails && typeof serviceDetails === "object" ? serviceDetails : undefined,
        slug,
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
      const createdAtIso =
        last.createdAt instanceof Date
          ? last.createdAt.toISOString()
          : String(last.createdAt);
      nextCursor = Buffer.from(
        JSON.stringify({ createdAt: createdAtIso, id: last.id }),
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

export async function getListingById(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ success: false, message: "Listing ID is required" });
      return;
    }

    const row = await prisma.listing.findFirst({
      where: {
        OR: [{ id }, { slug: id.toLowerCase() }],
        status: "active",
        store: { status: "active" },
      },
      select: PUBLIC_LISTING_SELECT,
    });

    if (!row) {
      res.status(404).json({ success: false, message: "Listing not found" });
      return;
    }

    res.status(200).json({
      success: true,
      data: toPublicListing(row),
    });
  } catch (err) {
    console.error("Error fetching listing detail:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function trackListingView(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ success: false, message: "Listing ID is required" });
      return;
    }

    const listing = await prisma.listing.findUnique({
      where: { id },
      select: { id: true, status: true, views: true },
    });

    if (!listing || listing.status !== "active") {
      res.status(404).json({ success: false, message: "Listing not found" });
      return;
    }

    const viewerId = (req as AuthenticatedRequest).auth?.userId;
    const rawIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      "unknown";
    const ua = String(req.headers["user-agent"] || "");
    const fingerprint = viewerId
      ? `u:${viewerId}`
      : `a:${crypto.createHash("sha256").update(`${rawIp}|${ua}`).digest("hex").slice(0, 24)}`;

    const shouldIncrement = await acquireViewDedupLock(`listing:view:${listing.id}:${fingerprint}`);
    let updatedViews = listing.views;
    if (shouldIncrement) {
      const updated = await prisma.listing.update({
        where: { id: listing.id },
        data: { views: { increment: 1 } },
        select: { views: true },
      });
      updatedViews = updated.views;
    }

    res.status(200).json({
      success: true,
      views: updatedViews,
      counted: shouldIncrement,
    });
  } catch (err) {
    console.error("Error tracking listing view:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
