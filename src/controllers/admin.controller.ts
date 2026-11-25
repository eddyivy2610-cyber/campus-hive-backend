import crypto from "node:crypto";
import argon2 from "argon2";
import bcrypt from "bcrypt";
import { Response } from "express";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";
import { toPublicListing, toPublicStore } from "../lib/serializers.ts";
import { generateAccessToken } from "../services/token.service.ts";

async function writeAdminLog(params: {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: Record<string, any>;
}) {
  try {
    await prisma.adminLog.create({
      data: {
        adminId: params.adminId,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        details: params.details ?? undefined,
      },
    });
  } catch (err) {
    console.warn("[AdminLog] Failed to write audit log:", err);
  }
}

export async function adminSignIn(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const rawIdentity =
      typeof req.body?.identity === "string"
        ? req.body.identity.trim().toLowerCase()
        : typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!rawIdentity || !password) {
      res.status(400).json({ success: false, message: "Username/email and password are required." });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        role: "ADMIN",
        OR: [{ email: rawIdentity }, { username: rawIdentity }],
      },
    });

    if (!user) {
      res.status(401).json({ success: false, message: "Invalid admin credentials." });
      return;
    }

    if (user.accountStatus === "SUSPENDED" || user.accountStatus === "BANNED") {
      res.status(403).json({ success: false, message: "This administrator account is disabled." });
      return;
    }

    let validPassword = false;
    try {
      if (user.passwordHash.startsWith("$2")) {
        validPassword = await bcrypt.compare(password, user.passwordHash);
      } else {
        validPassword = await argon2.verify(user.passwordHash, password);
      }
    } catch {
      validPassword = false;
    }

    if (!validPassword) {
      res.status(401).json({ success: false, message: "Invalid admin credentials." });
      return;
    }

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const token = generateAccessToken(user.id, session.id, user.tokenVersion);
    const isProd = process.env.NODE_ENV === "production";
    res.cookie("accessToken", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: 15 * 60 * 1000,
    });

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("[adminSignIn] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminSignUp(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const providedKey =
      typeof req.body?.adminKey === "string"
        ? req.body.adminKey.trim()
        : typeof req.body?.key === "string"
        ? req.body.key.trim()
        : "";

    const configuredKey = process.env.ADMIN_REGISTRATION_KEY?.trim();
    if (!configuredKey) {
      res.status(503).json({
        success: false,
        message: "Admin registration is not configured on the server.",
      });
      return;
    }

    const keysMatch =
      providedKey.length === configuredKey.length &&
      crypto.timingSafeEqual(Buffer.from(providedKey), Buffer.from(configuredKey));
    if (!keysMatch) {
      res.status(403).json({ success: false, message: "Invalid administrator registration key." });
      return;
    }

    if (!email || !email.includes("@") || !username || password.length < 8) {
      res.status(400).json({
        success: false,
        message: "Valid email, username, and password (min 8 characters) are required.",
      });
      return;
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
      select: { id: true },
    });
    if (existing) {
      res.status(409).json({ success: false, message: "Email or username already exists." });
      return;
    }

    const passwordHash = await argon2.hash(password);
    const admin = await prisma.user.create({
      data: {
        email,
        username,
        fullName: username,
        displayName: username,
        passwordHash,
        role: "ADMIN",
        accountStatus: "ACTIVE",
        isEmailVerified: true,
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
      },
    });

    res.status(201).json({ success: true, admin, user: admin });
  } catch (err) {
    console.error("[adminSignUp] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminAuthMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
    const admin = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        displayName: true,
        role: true,
        accountStatus: true,
        createdAt: true,
      },
    });
    if (!admin || admin.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Admin access required" });
      return;
    }
    res.status(200).json({ success: true, admin, user: admin });
  } catch (err) {
    console.error("[adminAuthMe] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminOverview(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const [
      totalUsers,
      activeUsers,
      totalStores,
      activeStores,
      pendingStores,
      totalListings,
      activeListings,
      totalOrders,
      openReports,
      pendingApplications,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { accountStatus: "ACTIVE" } }),
      prisma.store.count(),
      prisma.store.count({ where: { status: "active" } }),
      prisma.store.count({ where: { status: "pending_review" } }),
      prisma.listing.count(),
      prisma.listing.count({ where: { status: "active" } }),
      prisma.order.count(),
      prisma.report.count({ where: { status: "open" } }),
      prisma.sellerApplication.count({ where: { status: "pending" } }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        totalStores,
        activeStores,
        pendingStores,
        totalListings,
        activeListings,
        totalOrders,
        openReports,
        pendingApplications,
      },
    });
  } catch (err) {
    console.error("[adminOverview] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminAnalytics(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const [storesByStatus, listingsByStatus, ordersByStatus, topViewedListings] = await Promise.all([
      prisma.store.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.listing.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.listing.findMany({
        where: { status: "active" },
        orderBy: { views: "desc" },
        take: 10,
        select: { id: true, title: true, views: true, price: true, category: true },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        storesByStatus,
        listingsByStatus,
        ordersByStatus,
        topViewedListings,
      },
    });
  } catch (err) {
    console.error("[adminAnalytics] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminListLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
    const logs = await prisma.adminLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    res.status(200).json({ success: true, data: logs });
  } catch (err) {
    console.error("[adminListLogs] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminListUsers(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "";
    const users = await prisma.user.findMany({
      where: {
        ...(status ? { accountStatus: status as any } : {}),
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: "insensitive" } },
                { username: { contains: q, mode: "insensitive" } },
                { fullName: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        displayName: true,
        profileImage: true,
        role: true,
        accountStatus: true,
        isEmailVerified: true,
        storesCount: true,
        createdAt: true,
      },
    });
    res.status(200).json({ success: true, data: users });
  } catch (err) {
    console.error("[adminListUsers] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminUpdateUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = String(req.params.id || "");
    const { accountStatus, role, reason } = req.body || {};
    const updateData: Record<string, any> = {};
    if (["PENDING", "ACTIVE", "SUSPENDED", "BANNED"].includes(String(accountStatus || "").toUpperCase())) {
      updateData.accountStatus = String(accountStatus).toUpperCase();
    }
    if (["BUYER", "SELLER", "ADMIN"].includes(String(role || "").toUpperCase())) {
      updateData.role = String(role).toUpperCase();
    }
    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ success: false, message: "No valid user fields provided" });
      return;
    }
    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        role: true,
        accountStatus: true,
      },
    });
    await writeAdminLog({
      adminId: req.auth?.userId || "admin",
      action: "update_user",
      targetType: "user",
      targetId: userId,
      details: { ...updateData, reason },
    });
    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    console.error("[adminUpdateUser] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminListStores(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const campus = typeof req.query.campus === "string" ? req.query.campus.trim() : "";
    const stores = await prisma.store.findMany({
      where: {
        ...(status && status !== "all" ? { status } : {}),
        ...(campus && campus !== "all" ? { campus } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        owner: { select: { id: true, email: true, fullName: true, username: true } },
        _count: { select: { listings: true } },
      },
    });
    res.status(200).json({ success: true, data: stores });
  } catch (err) {
    console.error("[adminListStores] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminUpdateStoreStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const storeId = String(req.params.id || "");
    const { action, reason } = req.body || {};
    if (action !== "suspend" && action !== "restore" && action !== "approve") {
      res.status(400).json({ message: "Invalid action; expected 'suspend', 'restore', or 'approve'", error: "bad_request" });
      return;
    }

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
      res.status(404).json({ message: "Store not found", error: "not_found" });
      return;
    }

    if (action === "suspend") {
      const effectiveReason = typeof reason === "string" && reason.trim() ? reason.trim() : "Policy violation";
      const updated = await prisma.$transaction(async (tx) => {
        const s = await tx.store.update({
          where: { id: storeId },
          data: { status: "suspended", suspensionReason: effectiveReason },
        });
        await tx.listing.updateMany({
          where: { storeId, status: "active" },
          data: { status: "paused", pausedBy: "store_suspension" },
        });
        return s;
      });
      await writeAdminLog({
        adminId: req.auth?.userId || "admin",
        action: "suspend_store",
        targetType: "store",
        targetId: storeId,
        details: { reason: effectiveReason },
      });
      res.status(200).json({ success: true, data: toPublicStore(updated) });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.store.update({
        where: { id: storeId },
        data: { status: "active", isVerified: true, suspensionReason: null },
      });
      await tx.listing.updateMany({
        where: { storeId, status: "paused", pausedBy: "store_suspension" },
        data: { status: "active", pausedBy: null },
      });
      return s;
    });
    await writeAdminLog({
      adminId: req.auth?.userId || "admin",
      action: `${action}_store`,
      targetType: "store",
      targetId: storeId,
    });
    res.status(200).json({ success: true, data: toPublicStore(updated) });
  } catch (err) {
    console.error("Admin store update error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function adminListBusinessApplications(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const campus = typeof req.query.campus === "string" ? req.query.campus.trim() : "";

    // Backfill any pending_review Store that was created before SellerApplication linking
    const pendingStores = await prisma.store.findMany({
      where: { status: "pending_review" },
      select: {
        id: true,
        ownerId: true,
        name: true,
        category: true,
        campus: true,
        operatingLocation: true,
        storeType: true,
        createdAt: true,
      },
    });
    if (pendingStores.length > 0) {
      const existingApps = await prisma.sellerApplication.findMany({
        where: { storeId: { in: pendingStores.map((s) => s.id) } },
        select: { storeId: true },
      });
      const existingStoreIds = new Set(existingApps.map((a) => a.storeId).filter(Boolean));
      const missingStores = pendingStores.filter((s) => !existingStoreIds.has(s.id));
      if (missingStores.length > 0) {
        await prisma.sellerApplication.createMany({
          data: missingStores.map((s) => ({
            userId: s.ownerId,
            storeId: s.id,
            businessName: s.name,
            category: s.category,
            campus: s.campus,
            operatingLocation: s.operatingLocation,
            status: "pending",
            createdAt: s.createdAt,
          })),
        });
      }
    }

    const applications = await prisma.sellerApplication.findMany({
      where: {
        ...(status && status !== "all" ? { status } : {}),
        ...(campus && campus !== "all" ? { campus } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const userIds = Array.from(new Set(applications.map((a) => a.userId)));
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, fullName: true, displayName: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const formatted = applications.map((app) => {
      const owner = userMap.get(app.userId);
      let parsedNotes: any = {};
      if (app.notes) {
        try {
          parsedNotes = JSON.parse(app.notes);
        } catch {}
      }
      return {
        ...app,
        _id: app.id,
        contactEmail: parsedNotes?.contact?.email || owner?.email || "",
        contactPhone: parsedNotes?.contact?.phone || "",
        applicantName: owner?.displayName || owner?.fullName || app.businessName,
        sellerType: parsedNotes?.sellerType || "student",
        studentIdImage: app.studentIdUrl || undefined,
        locationProofDocument: app.studentIdUrl || undefined,
        submittedAt: app.createdAt.toISOString(),
      };
    });

    res.status(200).json({ success: true, data: formatted });
  } catch (err) {
    console.error("[adminListBusinessApplications] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminReviewBusinessApplication(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || "");
    const { action, reviewNote, reason, adminNotes } = req.body || {};
    if (action !== "approve" && action !== "reject" && action !== "request_changes") {
      res.status(400).json({ success: false, message: "action must be 'approve', 'reject', or 'request_changes'" });
      return;
    }
    const resolvedNote =
      typeof reason === "string" && reason.trim()
        ? reason.trim()
        : typeof reviewNote === "string" && reviewNote.trim()
        ? reviewNote.trim()
        : typeof adminNotes === "string" && adminNotes.trim()
        ? adminNotes.trim()
        : null;

    const appDoc = await prisma.sellerApplication.findUnique({ where: { id } });
    if (!appDoc) {
      res.status(404).json({ success: false, message: "Application not found" });
      return;
    }

    const nextStatus =
      action === "approve" ? "approved" : action === "reject" ? "rejected" : "changes_requested";
    const updated = await prisma.$transaction(async (tx) => {
      const appRow = await tx.sellerApplication.update({
        where: { id },
        data: {
          status: nextStatus,
          reviewNote: resolvedNote,
          reviewedBy: req.auth?.userId || null,
          reviewedAt: new Date(),
        },
      });
      if (action === "approve") {
        await tx.user.updateMany({
          where: { id: appDoc.userId, role: "BUYER" },
          data: { role: "SELLER" },
        });
        if (appDoc.storeId) {
          await tx.store.update({
            where: { id: appDoc.storeId },
            data: { status: "active", isVerified: true, verificationType: "student" },
          });
        }
      } else if (action === "reject" && appDoc.storeId) {
        await tx.store.update({
          where: { id: appDoc.storeId },
          data: { status: "rejected", suspensionReason: resolvedNote },
        });
      }
      await tx.notification.create({
        data: {
          userId: appDoc.userId,
          type: "verification",
          title:
            action === "approve"
              ? "Storefront verification approved"
              : "Storefront verification update",
          message:
            action === "approve"
              ? `Your storefront "${appDoc.businessName}" has been approved.`
              : `Your application for "${appDoc.businessName}" was ${
                  action === "reject" ? "not approved" : "returned for changes"
                }${resolvedNote ? `: ${resolvedNote}` : "."}`,
          link: action === "approve" ? "/stores" : "/onboarding/seller?retry=true",
        },
      });
      return appRow;
    });

    await writeAdminLog({
      adminId: req.auth?.userId || "admin",
      action: `${action}_application`,
      targetType: "seller_application",
      targetId: id,
      details: { reviewNote },
    });

    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    console.error("[adminReviewBusinessApplication] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminListListings(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const listings = await prisma.listing.findMany({
      where: status && status !== "all" ? { status } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { store: { select: { id: true, name: true, slug: true } } },
    });
    res.status(200).json({
      success: true,
      data: listings.map((l) => ({ ...toPublicListing(l), store: l.store })),
    });
  } catch (err) {
    console.error("[adminListListings] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminUpdateListing(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || "");
    const { status } = req.body || {};
    if (!["active", "paused", "removed", "draft"].includes(String(status || ""))) {
      res.status(400).json({ success: false, message: "Invalid listing status" });
      return;
    }
    const updated = await prisma.listing.update({
      where: { id },
      data: { status: String(status), pausedBy: status === "paused" ? "admin" : null },
    });
    await writeAdminLog({
      adminId: req.auth?.userId || "admin",
      action: "update_listing_status",
      targetType: "listing",
      targetId: id,
      details: { status },
    });
    res.status(200).json({ success: true, data: toPublicListing(updated) });
  } catch (err) {
    console.error("[adminUpdateListing] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminDeleteListing(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || "");
    await prisma.listing.delete({ where: { id } });
    await writeAdminLog({
      adminId: req.auth?.userId || "admin",
      action: "delete_listing",
      targetType: "listing",
      targetId: id,
    });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("[adminDeleteListing] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminListReports(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const reports = await prisma.report.findMany({
      where: status && status !== "all" ? { status } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.status(200).json({ success: true, data: reports });
  } catch (err) {
    console.error("[adminListReports] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminUpdateReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || "");
    const { status, resolutionNote } = req.body || {};
    if (!["open", "resolved", "dismissed"].includes(String(status || ""))) {
      res.status(400).json({ success: false, message: "Invalid report status" });
      return;
    }
    const updated = await prisma.report.update({
      where: { id },
      data: {
        status: String(status),
        resolutionNote: typeof resolutionNote === "string" ? resolutionNote : null,
        resolvedBy: status === "open" ? null : req.auth?.userId || null,
        resolvedAt: status === "open" ? null : new Date(),
      },
    });
    await writeAdminLog({
      adminId: req.auth?.userId || "admin",
      action: "update_report",
      targetType: "report",
      targetId: id,
      details: { status, resolutionNote },
    });
    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    console.error("[adminUpdateReport] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminListReviews(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const reviews = await prisma.review.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { reviewer: { select: { id: true, fullName: true, username: true } } },
    });
    res.status(200).json({ success: true, data: reviews });
  } catch (err) {
    console.error("[adminListReviews] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminDeleteReview(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || "");
    await prisma.review.delete({ where: { id } });
    await writeAdminLog({
      adminId: req.auth?.userId || "admin",
      action: "delete_review",
      targetType: "review",
      targetId: id,
    });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("[adminDeleteReview] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminListBanners(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const banners = await prisma.banner.findMany({
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    });
    res.status(200).json({ success: true, data: banners });
  } catch (err) {
    console.error("[adminListBanners] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminCreateBanner(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const {
      placement,
      headline,
      description,
      ctaLabel,
      ctaUrl,
      imageUrl,
      mobileImageUrl,
      imageAlt,
      targetCategory,
      status,
      priority,
      startAt,
      endAt,
    } = req.body || {};

    if (!headline || !imageUrl) {
      res.status(400).json({ success: false, message: "headline and imageUrl are required" });
      return;
    }

    const banner = await prisma.banner.create({
      data: {
        placement: typeof placement === "string" && placement ? placement : "homepage_hero",
        headline: String(headline),
        description: typeof description === "string" ? description : null,
        ctaLabel: typeof ctaLabel === "string" ? ctaLabel : null,
        ctaUrl: typeof ctaUrl === "string" ? ctaUrl : null,
        imageUrl: String(imageUrl),
        mobileImageUrl: typeof mobileImageUrl === "string" ? mobileImageUrl : null,
        imageAlt: typeof imageAlt === "string" ? imageAlt : null,
        targetCategory: typeof targetCategory === "string" ? targetCategory : null,
        status: typeof status === "string" && status ? status : "published",
        priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
        startAt: startAt ? new Date(startAt) : null,
        endAt: endAt ? new Date(endAt) : null,
      },
    });
    res.status(201).json({ success: true, data: banner });
  } catch (err) {
    console.error("[adminCreateBanner] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminUpdateBanner(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || "");
    const body = req.body || {};
    const banner = await prisma.banner.update({
      where: { id },
      data: {
        ...(body.placement !== undefined ? { placement: String(body.placement) } : {}),
        ...(body.headline !== undefined ? { headline: String(body.headline) } : {}),
        ...(body.description !== undefined ? { description: body.description ? String(body.description) : null } : {}),
        ...(body.ctaLabel !== undefined ? { ctaLabel: body.ctaLabel ? String(body.ctaLabel) : null } : {}),
        ...(body.ctaUrl !== undefined ? { ctaUrl: body.ctaUrl ? String(body.ctaUrl) : null } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: String(body.imageUrl) } : {}),
        ...(body.mobileImageUrl !== undefined ? { mobileImageUrl: body.mobileImageUrl ? String(body.mobileImageUrl) : null } : {}),
        ...(body.imageAlt !== undefined ? { imageAlt: body.imageAlt ? String(body.imageAlt) : null } : {}),
        ...(body.targetCategory !== undefined ? { targetCategory: body.targetCategory ? String(body.targetCategory) : null } : {}),
        ...(body.status !== undefined ? { status: String(body.status) } : {}),
        ...(body.priority !== undefined ? { priority: Number(body.priority) || 0 } : {}),
      },
    });
    res.status(200).json({ success: true, data: banner });
  } catch (err) {
    console.error("[adminUpdateBanner] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminDeleteBanner(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || "");
    await prisma.banner.delete({ where: { id } });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("[adminDeleteBanner] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminSetBannerStatus(
  status: "published" | "draft" | "archived",
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const id = String(req.params.id || "");
    const banner = await prisma.banner.update({
      where: { id },
      data: { status },
    });
    res.status(200).json({ success: true, data: banner });
  } catch (err) {
    console.error("[adminSetBannerStatus] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminDuplicateBanner(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || "");
    const src = await prisma.banner.findUnique({ where: { id } });
    if (!src) {
      res.status(404).json({ success: false, message: "Banner not found" });
      return;
    }
    const copy = await prisma.banner.create({
      data: {
        placement: src.placement,
        headline: `${src.headline} (Copy)`,
        description: src.description,
        ctaLabel: src.ctaLabel,
        ctaUrl: src.ctaUrl,
        imageUrl: src.imageUrl,
        mobileImageUrl: src.mobileImageUrl,
        imageAlt: src.imageAlt,
        targetCategory: src.targetCategory,
        status: "draft",
        priority: src.priority,
        startAt: src.startAt,
        endAt: src.endAt,
      },
    });
    res.status(201).json({ success: true, data: copy });
  } catch (err) {
    console.error("[adminDuplicateBanner] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}
