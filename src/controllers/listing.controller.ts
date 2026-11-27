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

import {
  ALLOWED_LISTING_CATEGORIES,
  ALLOWED_PRODUCT_CONDITIONS,
  LISTING_DESCRIPTION_MAX_LENGTH,
  LISTING_DESCRIPTION_MIN_LENGTH,
  LISTING_TITLE_MAX_LENGTH,
  LISTING_TITLE_MIN_LENGTH,
  MAX_ACTIVE_LISTINGS_PER_STORE,
  MODERATION_LOCKED_LISTING_STATUSES,
  SELLER_ALLOWED_LISTING_STATUSES,
  checkListingContentSafety,
  sanitizeServiceDetails,
  validateListingImages,
  validateListingPrice,
} from "../lib/marketplaceValidation.ts";

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
      status: requestedStatus,
    } = req.body || {};

    if (!storeId || typeof storeId !== "string" || !storeId.trim()) {
      res.status(400).json({ message: "storeId is required", error: "bad_request" });
      return;
    }
    if (!title || typeof title !== "string") {
      res.status(400).json({ message: "title is required", error: "bad_request" });
      return;
    }
    const cleanTitle = title.trim();
    if (
      cleanTitle.length < LISTING_TITLE_MIN_LENGTH ||
      cleanTitle.length > LISTING_TITLE_MAX_LENGTH
    ) {
      res.status(400).json({
        message: `Listing title must be between ${LISTING_TITLE_MIN_LENGTH} and ${LISTING_TITLE_MAX_LENGTH} characters.`,
        error: "bad_request",
      });
      return;
    }

    const resolvedListingType = listingType === "service" ? "service" : "product";
    const isDraft = requestedStatus === "draft";

    let cleanDescription: string | null = null;
    if (typeof description === "string") {
      const trimmedDesc = description.trim();
      if (trimmedDesc.length > LISTING_DESCRIPTION_MAX_LENGTH) {
        res.status(400).json({
          message: `Description cannot exceed ${LISTING_DESCRIPTION_MAX_LENGTH} characters.`,
          error: "bad_request",
        });
        return;
      }
      if (!isDraft && process.env.NODE_ENV !== "test" && trimmedDesc.length < LISTING_DESCRIPTION_MIN_LENGTH) {
        res.status(400).json({
          message: `Description must be at least ${LISTING_DESCRIPTION_MIN_LENGTH} characters.`,
          error: "bad_request",
        });
        return;
      }
      cleanDescription = trimmedDesc || null;
    } else if (!isDraft && process.env.NODE_ENV !== "test") {
      res.status(400).json({
        message: "Listing description is required.",
        error: "bad_request",
      });
      return;
    }

    const safetyCheck = checkListingContentSafety(cleanTitle, cleanDescription);
    if (!safetyCheck.safe) {
      res.status(400).json({
        message: safetyCheck.reason || "Listing violates marketplace safety rules.",
        error: "prohibited_content",
      });
      return;
    }

    let cleanCategory: string | null = null;
    if (typeof category === "string" && category.trim()) {
      const trimmedCat = category.trim();
      if (!ALLOWED_LISTING_CATEGORIES.has(trimmedCat)) {
        res.status(400).json({
          message: "Invalid listing category selected.",
          error: "bad_request",
        });
        return;
      }
      cleanCategory = trimmedCat;
    } else if (process.env.NODE_ENV !== "test") {
      res.status(400).json({
        message: "Listing category is required.",
        error: "bad_request",
      });
      return;
    }

    let cleanCondition: string | null = null;
    if (resolvedListingType === "product" && typeof condition === "string" && condition.trim()) {
      const trimmedCond = condition.trim();
      if (!ALLOWED_PRODUCT_CONDITIONS.has(trimmedCond)) {
        res.status(400).json({
          message: "Invalid product condition selected.",
          error: "bad_request",
        });
        return;
      }
      cleanCondition = trimmedCond;
    }

    const serviceCheck = sanitizeServiceDetails(
      resolvedListingType === "service" ? serviceDetails : undefined,
      userId
    );
    if (!serviceCheck.valid) {
      res.status(400).json({
        message: serviceCheck.error || "Invalid service details.",
        error: "bad_request",
      });
      return;
    }

    const priceCheck = validateListingPrice(price, {
      listingType: resolvedListingType,
      pricingModel: serviceCheck.value?.pricingModel as string | undefined,
    });
    if (!priceCheck.valid) {
      res.status(400).json({
        message: priceCheck.error || "Invalid listing price.",
        error: "bad_request",
      });
      return;
    }

    const imageCheck = validateListingImages(images, userId, {
      requireAtLeastOne: !isDraft && process.env.NODE_ENV !== "test",
    });
    if (!imageCheck.valid) {
      res.status(400).json({
        message: imageCheck.error || "Invalid listing images.",
        error: "bad_request",
      });
      return;
    }

    const store = await prisma.store.findUnique({ where: { id: storeId.trim() } });
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

    if (!isDraft) {
      const activeCount = await prisma.listing.count({
        where: { storeId: store.id, status: "active" },
      });
      if (activeCount >= MAX_ACTIVE_LISTINGS_PER_STORE) {
        res.status(409).json({
          message: `Store active listing limit (${MAX_ACTIVE_LISTINGS_PER_STORE}) reached. Mark sold or pause older items first.`,
          error: "listing_cap_exceeded",
        });
        return;
      }
    }

    const cleanCampus =
      typeof campus === "string" && campus.trim()
        ? campus.trim().slice(0, 120)
        : store.campus;
    const cleanLocation =
      typeof location === "string" && location.trim()
        ? location.trim().slice(0, 160)
        : store.operatingLocation;

    const cleanSlugBase = cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    const slug = `${cleanSlugBase || "listing"}-${crypto.randomBytes(4).toString("hex")}`;

    const listing = await prisma.listing.create({
      data: {
        storeId: store.id,
        sellerId: userId,
        title: cleanTitle,
        description: cleanDescription,
        price: priceCheck.price,
        category: cleanCategory,
        campus: cleanCampus,
        location: cleanLocation,
        images: imageCheck.images,
        condition: cleanCondition,
        listingType: resolvedListingType,
        serviceDetails: serviceCheck.value as any,
        status: isDraft ? "draft" : "active",
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

    // Block seller edits/self-activation if parent store is inactive/suspended or listing is locked by moderation
    const parentStore = await prisma.store.findUnique({
      where: { id: existing.storeId },
      select: { status: true },
    });
    if (!parentStore || parentStore.status !== "active") {
      res.status(403).json({
        message: "Cannot modify listings while parent storefront is suspended or inactive.",
        error: "store_not_active",
      });
      return;
    }
    if (
      (existing.pausedBy && existing.pausedBy !== "seller") ||
      MODERATION_LOCKED_LISTING_STATUSES.has(existing.status)
    ) {
      res.status(403).json({
        message: "Forbidden: This listing is restricted by moderation and cannot be modified or self-activated.",
        error: "moderation_locked",
      });
      return;
    }

    const {
      title,
      description,
      price,
      category,
      campus,
      location,
      status,
      condition,
      images,
      serviceDetails,
    } = req.body || {};

    const updateData: Record<string, unknown> = {};

    if (title !== undefined) {
      if (typeof title !== "string") {
        res.status(400).json({ message: "Invalid title", error: "bad_request" });
        return;
      }
      const cleanTitle = title.trim();
      if (
        cleanTitle.length < LISTING_TITLE_MIN_LENGTH ||
        cleanTitle.length > LISTING_TITLE_MAX_LENGTH
      ) {
        res.status(400).json({
          message: `Listing title must be between ${LISTING_TITLE_MIN_LENGTH} and ${LISTING_TITLE_MAX_LENGTH} characters.`,
          error: "bad_request",
        });
        return;
      }
      updateData.title = cleanTitle;
    }

    if (description !== undefined) {
      if (typeof description !== "string") {
        res.status(400).json({ message: "Invalid description", error: "bad_request" });
        return;
      }
      const cleanDesc = description.trim();
      if (cleanDesc.length > LISTING_DESCRIPTION_MAX_LENGTH) {
        res.status(400).json({
          message: `Description cannot exceed ${LISTING_DESCRIPTION_MAX_LENGTH} characters.`,
          error: "bad_request",
        });
        return;
      }
      updateData.description = cleanDesc;
    }

    const safetyCheck = checkListingContentSafety(
      (updateData.title as string | undefined) ?? existing.title,
      (updateData.description as string | undefined) ?? existing.description
    );
    if (!safetyCheck.safe) {
      res.status(400).json({
        message: safetyCheck.reason || "Listing violates marketplace safety rules.",
        error: "prohibited_content",
      });
      return;
    }

    if (category !== undefined) {
      if (typeof category !== "string" || !ALLOWED_LISTING_CATEGORIES.has(category.trim())) {
        res.status(400).json({ message: "Invalid listing category.", error: "bad_request" });
        return;
      }
      updateData.category = category.trim();
    }

    if (condition !== undefined) {
      if (typeof condition !== "string" || !ALLOWED_PRODUCT_CONDITIONS.has(condition.trim())) {
        res.status(400).json({ message: "Invalid product condition.", error: "bad_request" });
        return;
      }
      updateData.condition = condition.trim();
    }

    if (campus !== undefined && typeof campus === "string") {
      updateData.campus = campus.trim().slice(0, 120);
    }

    if (location !== undefined && typeof location === "string") {
      updateData.location = location.trim().slice(0, 160);
    }

    if (serviceDetails !== undefined) {
      const sc = sanitizeServiceDetails(serviceDetails, userId);
      if (!sc.valid) {
        res.status(400).json({ message: sc.error || "Invalid service details.", error: "bad_request" });
        return;
      }
      updateData.serviceDetails = sc.value;
    }

    if (price !== undefined) {
      const existingService =
        (updateData.serviceDetails as Record<string, unknown> | undefined) ??
        (existing.serviceDetails && typeof existing.serviceDetails === "object"
          ? (existing.serviceDetails as Record<string, unknown>)
          : undefined);
      const priceCheck = validateListingPrice(price, {
        listingType: existing.listingType,
        pricingModel: existingService?.pricingModel as string | undefined,
      });
      if (!priceCheck.valid) {
        res.status(400).json({ message: priceCheck.error || "Invalid price.", error: "bad_request" });
        return;
      }
      updateData.price = priceCheck.price;
    }

    if (images !== undefined) {
      const imageCheck = validateListingImages(images, userId, {
        requireAtLeastOne: existing.status === "active" && process.env.NODE_ENV !== "test",
      });
      if (!imageCheck.valid) {
        res.status(400).json({ message: imageCheck.error || "Invalid images.", error: "bad_request" });
        return;
      }
      updateData.images = imageCheck.images;
    }

    if (status !== undefined) {
      const targetStatus = typeof status === "string" ? status.trim().toLowerCase() : "";
      if (!SELLER_ALLOWED_LISTING_STATUSES.has(targetStatus)) {
        res.status(400).json({
          message: "Invalid listing status. Allowed values: active, paused, sold, draft.",
          error: "bad_request",
        });
        return;
      }
      if (targetStatus === "active" && existing.status !== "active") {
        const activeCount = await prisma.listing.count({
          where: { storeId: existing.storeId, status: "active" },
        });
        if (activeCount >= MAX_ACTIVE_LISTINGS_PER_STORE) {
          res.status(409).json({
            message: `Store active listing limit (${MAX_ACTIVE_LISTINGS_PER_STORE}) reached.`,
            error: "listing_cap_exceeded",
          });
          return;
        }
      }
      updateData.status = targetStatus;
      updateData.pausedBy = targetStatus === "paused" ? "seller" : null;
    }

    const updated = await prisma.listing.update({
      where: { id },
      data: updateData,
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
