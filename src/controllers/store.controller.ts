import { Response } from "express";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";
import { MAX_STORES_PER_USER } from "../lib/config.ts";
import { toPublicStore } from "../lib/serializers.ts";
import { validateDisplayName } from "../lib/nameValidation.ts";
import {
  STORE_DESCRIPTION_MAX_LENGTH,
  STORE_LOCATION_MAX_LENGTH,
  validateAndResolveStoreSlug,
  validatePhoneInput,
  validatePublicImageUrl,
  validateStoreName,
  validateVerificationDocumentUrl,
} from "../lib/marketplaceValidation.ts";

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
    const storeNameCheck = validateStoreName(name);
    if (!storeNameCheck.valid) {
      res.status(400).json({
        message: storeNameCheck.error || "Invalid store name.",
        error: "bad_request",
      });
      return;
    }
    const cleanStoreName = storeNameCheck.normalized;

    const slugCheck = validateAndResolveStoreSlug(slug, cleanStoreName, true);
    if (!slugCheck.valid) {
      res.status(400).json({
        message: slugCheck.error || "Invalid store slug.",
        error: "bad_request",
      });
      return;
    }
    const rawSlug = slugCheck.slug;
    const slugLower = rawSlug.toLowerCase();

    let validatedFullName: string | undefined = undefined;
    if (typeof fullName === "string" && fullName.trim()) {
      const fnCheck = validateDisplayName(fullName);
      if (!fnCheck.valid) {
        res.status(400).json({
          message: fnCheck.error || "Invalid full name.",
          error: "bad_request",
        });
        return;
      }
      validatedFullName = fnCheck.normalized;
    }

    const cleanDescription =
      typeof description === "string"
        ? description.trim().slice(0, STORE_DESCRIPTION_MAX_LENGTH) || null
        : null;
    const cleanCategory =
      typeof category === "string" ? category.trim().slice(0, 60) || null : null;
    const cleanCampus =
      typeof campus === "string" ? campus.trim().slice(0, 120) || null : null;
    const cleanOperatingLocation =
      typeof operatingLocation === "string"
        ? operatingLocation.trim().slice(0, STORE_LOCATION_MAX_LENGTH) || null
        : null;

    let cleanLogo: string | null = null;
    if (typeof logo === "string" && logo.trim()) {
      const logoCheck = validatePublicImageUrl(logo, userId, [
        "store_logo",
        "stores",
        "avatar",
        "profile_avatar",
        "users",
      ]);
      if (!logoCheck.valid) {
        res.status(400).json({
          message: logoCheck.error || "Invalid store logo URL.",
          error: "bad_request",
        });
        return;
      }
      cleanLogo = logoCheck.url;
    }

    let sanitizedContact: Record<string, string> | undefined = undefined;
    if (contact && typeof contact === "object") {
      const rawPhone = (contact as any).phone || (contact as any).whatsapp;
      if (rawPhone) {
        const phoneCheck = validatePhoneInput(rawPhone);
        if (!phoneCheck.valid) {
          res.status(400).json({
            message: phoneCheck.error || "Invalid phone number.",
            error: "bad_request",
          });
          return;
        }
        const rawWhatsapp = (contact as any).whatsapp
          ? validatePhoneInput((contact as any).whatsapp)
          : phoneCheck;
        if (!rawWhatsapp.valid) {
          res.status(400).json({
            message: rawWhatsapp.error || "Invalid WhatsApp number.",
            error: "bad_request",
          });
          return;
        }
        sanitizedContact = {
          phone: phoneCheck.phone,
          whatsapp: rawWhatsapp.phone,
          ...(typeof (contact as any).email === "string" && (contact as any).email.trim()
            ? { email: (contact as any).email.trim().toLowerCase().slice(0, 120) }
            : {}),
        };
      }
    } else if (sellerType && process.env.NODE_ENV !== "test") {
      res.status(400).json({
        message: "A valid contact phone or WhatsApp number is required for seller registration.",
        error: "bad_request",
      });
      return;
    }

    const rawDocCandidate =
      typeof studentIdImage === "string" && studentIdImage.trim()
        ? studentIdImage.trim()
        : typeof locationProofDocument === "string" && locationProofDocument.trim()
        ? locationProofDocument.trim()
        : null;

    let validatedDocUrl: string | null = null;
    if (rawDocCandidate) {
      const docCheck = validateVerificationDocumentUrl(rawDocCandidate, userId);
      if (!docCheck.valid) {
        res.status(400).json({
          message: docCheck.error || "Invalid verification document.",
          error: "bad_request",
        });
        return;
      }
      validatedDocUrl = docCheck.url;
    } else if (sellerType && process.env.NODE_ENV !== "test") {
      res.status(400).json({
        message:
          sellerType === "non_student"
            ? "Location proof document is required for seller verification."
            : "Student ID card upload is required for student seller verification.",
        error: "verification_document_required",
      });
      return;
    }

    const resolvedStoreType =
      storeType === "local_business" || sellerType === "non_student"
        ? "local_business"
        : "student_store";
    const resolvedVerificationType =
      typeof verificationType === "string" && verificationType.trim()
        ? verificationType.trim().slice(0, 40)
        : sellerType === "non_student"
        ? "location_proof"
        : "student_id";

    const { parseSafetyLocationPayload, recordConfidentialSafetyLocation } = await import(
      "../lib/campuses.ts"
    );
    const parsedSafetyLoc = parseSafetyLocationPayload(
      req.body?.safetyLocation,
      "seller_registration"
    );
    if (sellerType && !parsedSafetyLoc && process.env.NODE_ENV !== "test") {
      res.status(400).json({
        message: "Location access is required to register as a seller for community safety.",
        error: "seller_location_required",
      });
      return;
    }

    const application = await prisma.$transaction(async (tx) => {
      const [existingPendingApp, existingPendingStore, activeStoreCount, existingSlug] =
        await Promise.all([
          tx.sellerApplication.findFirst({
            where: {
              userId,
              status: { in: ["pending", "pending_review", "changes_requested"] },
            },
            select: { id: true },
          }),
          tx.store.findFirst({
            where: {
              ownerId: userId,
              status: { in: ["pending_review", "pending"] },
            },
            select: { id: true },
          }),
          tx.store.count({
            where: {
              ownerId: userId,
              status: "active",
            },
          }),
          tx.store.findUnique({
            where: { slugLower },
            select: { id: true },
          }),
        ]);

      if (existingSlug) {
        throw Object.assign(new Error("Store slug already exists"), { code: "P2002" });
      }

      if (existingPendingApp || existingPendingStore) {
        throw Object.assign(
          new Error("You already have a store verification request pending admin review."),
          { code: "PENDING_APPLICATION_EXISTS" }
        );
      }

      if (activeStoreCount >= MAX_STORES_PER_USER) {
        throw Object.assign(new Error("Store cap reached"), { code: "STORE_CAP_EXCEEDED" });
      }

      if (validatedFullName) {
        const currentUser = await tx.user.findUnique({
          where: { id: userId },
          select: { displayName: true },
        });
        await tx.user.update({
          where: { id: userId },
          data: {
            fullName: validatedFullName,
            ...(!currentUser?.displayName ? { displayName: validatedFullName } : {}),
          },
        });
      }

      return tx.sellerApplication.create({
        data: {
          userId,
          storeId: null,
          businessName: cleanStoreName,
          category: cleanCategory,
          campus: cleanCampus,
          operatingLocation: cleanOperatingLocation,
          studentIdUrl: validatedDocUrl,
          notes: JSON.stringify({
            sellerType: sellerType === "non_student" ? "non_student" : "student",
            contact: sanitizedContact,
            ...(parsedSafetyLoc ? { safetyLocation: parsedSafetyLoc } : {}),
            storePayload: {
              name: cleanStoreName,
              slug: rawSlug,
              slugLower,
              description: cleanDescription,
              category: cleanCategory,
              campus: cleanCampus,
              operatingLocation: cleanOperatingLocation,
              logo: cleanLogo,
              // Cover photo is never part of onboarding; always starts empty until set in Profile Settings
              coverImage: null,
              storeType: resolvedStoreType,
              verificationType: resolvedVerificationType,
            },
          }),
          status: "pending",
        },
      });
    });

    if (parsedSafetyLoc) {
      await recordConfidentialSafetyLocation(
        userId,
        req.body?.safetyLocation,
        "seller_registration"
      );
    }

    res.status(201).json({
      success: true,
      data: {
        application,
        status: "pending_review",
      },
    });
  } catch (err: any) {
    if (err?.code === "PENDING_APPLICATION_EXISTS") {
      res.status(409).json({
        message: "You already have a store verification request pending admin review.",
        error: "pending_application_exists",
      });
      return;
    }
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
    const pendingFromApp =
      latestApplication &&
      (latestApplication.status === "pending" || latestApplication.status === "pending_review")
        ? {
            id: latestApplication.id,
            name: latestApplication.businessName,
            category: latestApplication.category,
            campus: latestApplication.campus,
            operatingLocation: latestApplication.operatingLocation,
            status: "pending_review",
            createdAt: latestApplication.createdAt,
          }
        : null;

    res.status(200).json({
      success: true,
      data: {
        stores: formatted,
        activeStores,
        store: activeStores[0] || null,
        pendingStore: pendingStores[0] || pendingFromApp,
        businessApplication: latestApplication || null,
        hasStore: activeStores.length > 0,
        hasPendingApplication: pendingStores.length > 0 || Boolean(pendingFromApp),
        maxStores: MAX_STORES_PER_USER,
        canCreateMore: activeStores.length < MAX_STORES_PER_USER && !pendingFromApp,
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
    const rawSlug = String(req.params.slug || "").trim();
    const slug = rawSlug.toLowerCase();
    if (!slug) {
      res.status(404).json({ message: "Store not found", error: "not_found" });
      return;
    }

    const store = await prisma.store.findFirst({
      where: {
        OR: [{ slugLower: slug }, { id: rawSlug }],
      },
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

    const { name, description, category, campus, operatingLocation, logo, coverImage } = req.body || {};

    let cleanName: string | undefined = undefined;
    if (typeof name === "string" && name.trim()) {
      const nameCheck = validateStoreName(name);
      if (!nameCheck.valid) {
        res.status(400).json({ message: nameCheck.error || "Invalid store name.", error: "bad_request" });
        return;
      }
      cleanName = nameCheck.normalized;
    }

    let cleanLogo: string | null | undefined = undefined;
    if (typeof logo === "string") {
      if (!logo.trim()) {
        cleanLogo = null;
      } else {
        const lc = validatePublicImageUrl(logo, userId, [
          "store_logo",
          "stores",
          "avatar",
          "profile_avatar",
          "users",
        ]);
        if (!lc.valid) {
          res.status(400).json({ message: lc.error || "Invalid store logo URL.", error: "bad_request" });
          return;
        }
        cleanLogo = lc.url;
      }
    }

    let cleanCoverImage: string | null | undefined = undefined;
    if (coverImage === null) {
      cleanCoverImage = null;
    } else if (typeof coverImage === "string") {
      if (!coverImage.trim()) {
        cleanCoverImage = null;
      } else {
        const cc = validatePublicImageUrl(coverImage, userId, [
          "store_cover",
          "store_banner",
          "cover_image",
          "stores",
          "users",
        ]);
        if (!cc.valid) {
          res.status(400).json({ message: cc.error || "Invalid cover image URL.", error: "bad_request" });
          return;
        }
        cleanCoverImage = cc.url;
      }
    }

    const updated = await prisma.store.update({
      where: { id: storeId },
      data: {
        ...(cleanName !== undefined ? { name: cleanName } : {}),
        ...(typeof description === "string"
          ? { description: description.trim().slice(0, STORE_DESCRIPTION_MAX_LENGTH) }
          : {}),
        ...(typeof category === "string" ? { category: category.trim().slice(0, 60) } : {}),
        ...(typeof campus === "string" ? { campus: campus.trim().slice(0, 120) } : {}),
        ...(typeof operatingLocation === "string"
          ? { operatingLocation: operatingLocation.trim().slice(0, STORE_LOCATION_MAX_LENGTH) }
          : {}),
        ...(cleanLogo !== undefined ? { logo: cleanLogo } : {}),
        ...(cleanCoverImage !== undefined ? { coverImage: cleanCoverImage } : {}),
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
