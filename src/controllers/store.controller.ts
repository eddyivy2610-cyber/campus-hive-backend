import { Response } from "express";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";
import { MAX_STORES_PER_USER } from "../lib/config.ts";
import { toPublicStore } from "../lib/serializers.ts";

const PUBLIC_STORE_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  category: true,
  campus: true,
  operatingLocation: true,
  logo: true,
  coverImage: true,
  storeType: true,
  isVerified: true,
  verificationType: true,
  vacationMode: true,
  status: true,
  followersCount: true,
  createdAt: true,
} as const;

export async function createStore(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const {
      name,
      slug,
      description,
      category,
      campus,
      operatingLocation,
      logo,
      coverImage,
      storeType,
      sellerType,
      verificationType,
      fullName,
      studentIdImage,
      locationProofDocument,
      contact,
    } = req.body || {};
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ message: "Store name is required", error: "bad_request" });
      return;
    }

    const rawSlug =
      typeof slug === "string" && slug.trim()
        ? slug.trim()
        : `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    const slugLower = rawSlug.toLowerCase();

    const resolvedStoreType =
      storeType === "local_business" || sellerType === "non_student"
        ? "local_business"
        : "student_store";
    const resolvedVerificationType =
      typeof verificationType === "string" && verificationType.trim()
        ? verificationType.trim()
        : sellerType === "non_student"
        ? "location_proof"
        : "student_id";

    const store = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: {
          id: userId,
          storesCount: { lt: MAX_STORES_PER_USER },
        },
        data: {
          storesCount: { increment: 1 },
          ...(typeof fullName === "string" && fullName.trim()
            ? { fullName: fullName.trim(), displayName: fullName.trim() }
            : {}),
        },
      });

      if (updated.count === 0) {
        throw Object.assign(new Error("Store cap reached"), { code: "STORE_CAP_EXCEEDED" });
      }

      const createdStore = await tx.store.create({
        data: {
          ownerId: userId,
          name: name.trim(),
          slug: rawSlug,
          slugLower,
          status: "pending_review",
          description: typeof description === "string" ? description : null,
          category: typeof category === "string" ? category : null,
          campus: typeof campus === "string" ? campus : null,
          operatingLocation: typeof operatingLocation === "string" ? operatingLocation : null,
          logo: typeof logo === "string" ? logo : null,
          coverImage: typeof coverImage === "string" ? coverImage : null,
          storeType: resolvedStoreType,
          verificationType: resolvedVerificationType,
        },
        select: {
          ...PUBLIC_STORE_SELECT,
          ownerId: true,
        },
      });

      const docUrl =
        typeof studentIdImage === "string" && studentIdImage.trim()
          ? studentIdImage.trim()
          : typeof locationProofDocument === "string" && locationProofDocument.trim()
          ? locationProofDocument.trim()
          : null;

      await tx.sellerApplication.create({
        data: {
          userId,
          storeId: createdStore.id,
          businessName: name.trim(),
          category: typeof category === "string" ? category : null,
          campus: typeof campus === "string" ? campus : null,
          operatingLocation: typeof operatingLocation === "string" ? operatingLocation : null,
          studentIdUrl: docUrl,
          notes: contact && typeof contact === "object" ? JSON.stringify({ sellerType, contact }) : null,
          status: "pending",
        },
      });

      return createdStore;
    });

    res.status(201).json({ success: true, data: store });
  } catch (err: any) {
    if (err?.code === "STORE_CAP_EXCEEDED") {
      res.status(409).json({
        message: `Maximum of ${MAX_STORES_PER_USER} store(s) per user reached`,
        error: "store_cap_exceeded",
      });
      return;
    }
    if (err?.code === "P2002") {
      res.status(409).json({ message: "Store slug already exists", error: "slug_conflict" });
      return;
    }
    console.error("Error creating store:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function listMyStores(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const [stores, latestApplication] = await Promise.all([
      prisma.store.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: "desc" },
        select: {
          ...PUBLIC_STORE_SELECT,
          ownerId: true,
        },
      }),
      prisma.sellerApplication.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const formatted = stores.map((s) => toPublicStore(s));
    const activeStores = formatted.filter((s) => s.status === "active");
    const pendingStores = formatted.filter(
      (s) => s.status === "pending_review" || s.status === "pending"
    );
    res.status(200).json({
      success: true,
      data: {
        stores: formatted,
        activeStores,
        store: activeStores[0] || null,
        pendingStore: pendingStores[0] || null,
        businessApplication: latestApplication || null,
        hasStore: activeStores.length > 0,
        hasPendingApplication: pendingStores.length > 0,
        maxStores: MAX_STORES_PER_USER,
        canCreateMore: formatted.length < MAX_STORES_PER_USER,
      },
      stores: formatted,
    });
  } catch (err) {
    console.error("Error listing my stores:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function getPublicStore(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    if (!slug) {
      res.status(404).json({ message: "Store not found", error: "not_found" });
      return;
    }

    const store = await prisma.store.findUnique({
      where: { slugLower: slug },
    });

    if (!store || store.status !== "active") {
      res.status(404).json({ message: "Store not found", error: "not_found" });
      return;
    }

    const reviewAgg = await prisma.review.aggregate({
      where: { sellerId: store.ownerId },
      _count: { _all: true },
      _avg: { rating: true },
    });
    const reviewsCount = Number(reviewAgg._count?._all ?? 0);
    const rating = reviewsCount > 0 ? Number(reviewAgg._avg?.rating ?? 5) : 5;

    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).json({ success: true, data: toPublicStore(store, { rating, reviewsCount }) });
  } catch (err) {
    console.error("Error fetching public store:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function listPublicStores(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit || "20"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;
    const campus = typeof req.query.campus === "string" ? req.query.campus.trim() : "";

    const stores = await prisma.store.findMany({
      where: {
        status: "active",
        ...(campus ? { campus } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const data = stores.map((s) => toPublicStore(s));
    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).json({ success: true, data, stores: data });
  } catch (err) {
    console.error("Error listing public stores:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function updateStore(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const storeId = String(req.params.id || "");
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const existing = await prisma.store.findUnique({ where: { id: storeId } });
    if (!existing) {
      res.status(404).json({ message: "Store not found", error: "not_found" });
      return;
    }
    if (existing.ownerId !== userId) {
      res.status(403).json({ message: "Forbidden: not store owner", error: "forbidden" });
      return;
    }

    const { name, description, category, campus, operatingLocation } = req.body || {};
    const updated = await prisma.store.update({
      where: { id: storeId },
      data: {
        ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}),
        ...(typeof description === "string" ? { description } : {}),
        ...(typeof category === "string" ? { category } : {}),
        ...(typeof campus === "string" ? { campus } : {}),
        ...(typeof operatingLocation === "string" ? { operatingLocation } : {}),
      },
      select: {
        ...PUBLIC_STORE_SELECT,
        ownerId: true,
      },
    });

    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    console.error("Error updating store:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function deleteStore(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const storeId = String(req.params.id || "");
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const existing = await prisma.store.findUnique({ where: { id: storeId } });
    if (!existing) {
      res.status(404).json({ message: "Store not found", error: "not_found" });
      return;
    }
    if (existing.ownerId !== userId) {
      res.status(403).json({ message: "Forbidden: not store owner", error: "forbidden" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.store.deleteMany({
        where: { id: storeId, ownerId: userId },
      });
      if (deleted.count > 0) {
        await tx.user.updateMany({
          where: { id: userId, storesCount: { gt: 0 } },
          data: { storesCount: { decrement: 1 } },
        });
      }
    });

    res.status(200).json({ success: true, message: "Store deleted" });
  } catch (err) {
    console.error("Error deleting store:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
