import crypto from "node:crypto";
import argon2 from "argon2";
import bcrypt from "bcrypt";
import { Response } from "express";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";
import { toPublicListing, toPublicStore } from "../lib/serializers.ts";
import { generateAccessToken } from "../services/token.service.ts";
import { getDummyPasswordHash, validatePasswordPolicy, verifyPassword } from "../lib/password.ts";
import { validateEmail } from "../lib/email.ts";
import { MAX_STORES_PER_USER } from "../lib/config.ts";
import { computeCampusDistanceKm } from "../lib/marketplaceValidation.ts";

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
      const dummyHash = await getDummyPasswordHash();
      await verifyPassword(password, dummyHash).catch(() => false);
      res.status(401).json({ success: false, message: "Invalid admin credentials." });
      return;
    }

    const validPassword = await verifyPassword(password, user.passwordHash).catch(() => false);
    if (!validPassword) {
      res.status(401).json({ success: false, message: "Invalid admin credentials." });
      return;
    }

    if (user.accountStatus === "SUSPENDED" || user.accountStatus === "BANNED") {
      res.status(403).json({ success: false, message: "This administrator account is disabled." });
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
      sameSite: "lax",
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

    // Compare fixed-length SHA-256 digests so timing never leaks ADMIN_REGISTRATION_KEY length
    const providedDigest = crypto.createHash("sha256").update(providedKey).digest();
    const configuredDigest = crypto.createHash("sha256").update(configuredKey).digest();
    const keysMatch = providedKey.length > 0 && crypto.timingSafeEqual(providedDigest, configuredDigest);
    if (!keysMatch) {
      res.status(403).json({ success: false, message: "Invalid administrator registration key." });
      return;
    }

    const pwCheck = validatePasswordPolicy(password);
    if (!validateEmail(email) || !/^[a-z][a-z0-9_]{2,23}$/.test(username) || !pwCheck.valid) {
      res.status(400).json({
        success: false,
        message: pwCheck.error || "Valid email, username (3–24 lowercase alphanumeric/underscore), and strong password are required.",
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
    // Ensure any pending_review stores are represented in SellerApplication
    const pendingReviewStores = await prisma.store.findMany({
      where: { status: "pending_review" },
      select: {
        id: true,
        ownerId: true,
        name: true,
        category: true,
        campus: true,
        operatingLocation: true,
        createdAt: true,
      },
    });
    if (pendingReviewStores.length > 0) {
      const existing = await prisma.sellerApplication.findMany({
        where: { storeId: { in: pendingReviewStores.map((s) => s.id) } },
        select: { storeId: true },
      });
      const existingIds = new Set(existing.map((e) => e.storeId).filter(Boolean));
      const missing = pendingReviewStores.filter((s) => !existingIds.has(s.id));
      if (missing.length > 0) {
        await prisma.sellerApplication.createMany({
          data: missing.map((s) => ({
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

    const [
      totalUsers,
      activeUsers,
      totalStores,
      activeStores,
      pendingStores,
      totalListings,
      activeListings,
      pendingListings,
      totalOrders,
      openReports,
      pendingApplications,
      approvedApplications,
      recentAppRows,
      recentListingRows,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { accountStatus: "ACTIVE" } }),
      prisma.store.count(),
      prisma.store.count({ where: { status: "active" } }),
      prisma.store.count({ where: { status: "pending_review" } }),
      prisma.listing.count(),
      prisma.listing.count({ where: { status: "active" } }),
      prisma.listing.count({ where: { status: "pending_review" } }),
      prisma.order.count(),
      prisma.report.count({ where: { status: "open" } }),
      prisma.sellerApplication.count({ where: { status: { in: ["pending", "pending_review"] } } }),
      prisma.sellerApplication.count({ where: { status: "approved" } }),
      prisma.sellerApplication.findMany({
        where: { status: { in: ["pending", "pending_review"] } },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      prisma.listing.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { store: { select: { id: true, name: true } } },
      }),
    ]);

    const recentApplications = recentAppRows.map((app) => ({
      ...app,
      _id: app.id,
      status: app.status === "pending" ? "pending_review" : app.status,
      businessCategory: app.category || "General",
    }));

    const recentListings = recentListingRows.map((l) => ({
      ...l,
      _id: l.id,
      storeName: l.store?.name || "Campus Store",
    }));

    res.status(200).json({
      success: true,
      data: {
        stats: {
          pendingApplications,
          approvedApplications,
          pendingListings,
          activeListings,
          totalListings,
          activeStores,
          totalStores,
          registeredUsers: totalUsers,
        },
        recentApplications,
        recentListings,
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
        campus: { select: { name: true } },
        sessions: {
          where: { lastKnownLat: { not: null }, lastKnownLong: { not: null } },
          orderBy: { latLongUpdatedAt: "desc" },
          take: 1,
          select: { lastKnownLat: true, lastKnownLong: true, latLongUpdatedAt: true },
        },
      },
    });

    const userIds = users.map((u) => u.id);
    const safetyLogs = userIds.length
      ? await prisma.adminLog.findMany({
          where: {
            action: "USER_SAFETY_LOCATION_CAPTURED",
            targetType: "user",
            targetId: { in: userIds },
          },
          orderBy: { createdAt: "desc" },
          select: { targetId: true, details: true, createdAt: true },
        })
      : [];

    const latestSafetyByUser = new Map<string, any>();
    for (const log of safetyLogs) {
      if (!latestSafetyByUser.has(log.targetId) && log.details && typeof log.details === "object") {
        latestSafetyByUser.set(log.targetId, log.details);
      }
    }

    const enriched = users.map((u) => {
      const fromLog = latestSafetyByUser.get(u.id);
      const fromSession = u.sessions?.[0];
      const safetyLocation =
        fromLog ||
        (fromSession && fromSession.lastKnownLat !== null && fromSession.lastKnownLong !== null
          ? {
              lat: fromSession.lastKnownLat,
              lng: fromSession.lastKnownLong,
              accuracyMeters: null,
              source: "session",
              capturedAt: fromSession.latLongUpdatedAt?.toISOString() || null,
            }
          : null);
      const { sessions: _sessions, campus: campusObj, ...rest } = u;
      return {
        ...rest,
        _id: u.id,
        campus: campusObj?.name || null,
        safetyLocation,
      };
    });

    res.status(200).json({ success: true, data: enriched });
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

    const statusFilter =
      !status || status === "all"
        ? {}
        : status === "pending_review" || status === "pending"
        ? { status: { in: ["pending", "pending_review"] } }
        : { status };

    const applications = await prisma.sellerApplication.findMany({
      where: {
        ...statusFilter,
        ...(campus && campus !== "all" ? { campus } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const userIds = Array.from(new Set(applications.map((a) => a.userId)));
    const [users, safetyLogs] = await Promise.all([
      userIds.length
        ? prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true, fullName: true, displayName: true },
          })
        : Promise.resolve([]),
      userIds.length
        ? prisma.adminLog.findMany({
            where: {
              action: "USER_SAFETY_LOCATION_CAPTURED",
              targetId: { in: userIds },
            },
            orderBy: { createdAt: "desc" },
            select: { targetId: true, details: true },
          })
        : Promise.resolve([]),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const fallbackSafetyMap = new Map<string, any>();
    for (const log of safetyLogs) {
      if (log.targetId && !fallbackSafetyMap.has(log.targetId) && log.details) {
        fallbackSafetyMap.set(log.targetId, log.details);
      }
    }

    const formatted = applications.map((app) => {
      const owner = userMap.get(app.userId);
      let parsedNotes: any = {};
      let readableNotes: string | undefined = undefined;
      if (app.notes) {
        try {
          parsedNotes = JSON.parse(app.notes);
        } catch {
          readableNotes = app.notes;
        }
      }
      const sellerType = parsedNotes?.sellerType === "non_student" ? "non_student" : "student";
      const docs = app.studentIdUrl ? [app.studentIdUrl] : [];
      const safetyLocation =
        parsedNotes?.safetyLocation || fallbackSafetyMap.get(app.userId) || null;
      const distanceToCampusKm = computeCampusDistanceKm(app.campus, safetyLocation);
      return {
        ...app,
        _id: app.id,
        applicantId: app.userId,
        businessCategory: app.category || "General",
        registeredBusinessName: owner?.displayName || owner?.fullName || app.businessName,
        cacNumber: sellerType === "student" ? "Student ID Card" : "Location Proof",
        supportingDocuments: docs,
        notes: readableNotes,
        status: app.status === "pending" ? "pending_review" : app.status,
        contactEmail: parsedNotes?.contact?.email || owner?.email || "",
        contactPhone: parsedNotes?.contact?.phone || "",
        applicantName: owner?.displayName || owner?.fullName || app.businessName,
        sellerType,
        studentIdImage: app.studentIdUrl || undefined,
        locationProofDocument: app.studentIdUrl || undefined,
        safetyLocation,
        distanceToCampusKm,
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

    let parsedNotes: any = {};
    if (appDoc.notes) {
      try {
        parsedNotes = JSON.parse(appDoc.notes);
      } catch {}
    }
    const isNonStudent = parsedNotes?.sellerType === "non_student";
    const resolvedVerificationType =
      parsedNotes?.storePayload?.verificationType ||
      (isNonStudent ? "location_proof" : "student_id");

    const nextStatus =
      action === "approve" ? "approved" : action === "reject" ? "rejected" : "changes_requested";

    const updated = await prisma.$transaction(async (tx) => {
      // Atomic idempotent transition guard: only process if currently pending / pending_review / changes_requested
      const claimed = await tx.sellerApplication.updateMany({
        where: {
          id,
          status: { in: ["pending", "pending_review", "changes_requested", "more_info_needed"] },
        },
        data: {
          status: nextStatus,
          reviewNote: resolvedNote,
          reviewedBy: req.auth?.userId || null,
          reviewedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        throw Object.assign(
          new Error("Application has already been reviewed or is no longer in a reviewable state."),
          { code: "APPLICATION_ALREADY_PROCESSED" }
        );
      }

      if (action === "approve") {
        await tx.user.updateMany({
          where: { id: appDoc.userId, role: "BUYER" },
          data: { role: "SELLER" },
        });
        if (appDoc.storeId) {
          await tx.store.update({
            where: { id: appDoc.storeId },
            data: {
              status: "active",
              isVerified: true,
              storeType: isNonStudent ? "local_business" : "student_store",
              verificationType: resolvedVerificationType,
            },
          });
        } else {
          const activeStoreCount = await tx.store.count({
            where: { ownerId: appDoc.userId, status: "active" },
          });
          if (activeStoreCount >= MAX_STORES_PER_USER) {
            throw Object.assign(
              new Error(`Applicant already owns the maximum of ${MAX_STORES_PER_USER} active store(s).`),
              { code: "STORE_CAP_EXCEEDED" }
            );
          }

          const sp = parsedNotes?.storePayload || {};
          const storeName = (sp.name || appDoc.businessName || "Campus Store").trim();
          let rawSlug =
            typeof sp.slug === "string" && sp.slug.trim()
              ? sp.slug.trim().toLowerCase()
              : `${storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
          const slugCollision = await tx.store.findUnique({
            where: { slugLower: rawSlug },
            select: { id: true },
          });
          if (slugCollision) {
            rawSlug = `${rawSlug}-${crypto.randomBytes(2).toString("hex")}`;
          }
          const createdStore = await tx.store.create({
            data: {
              ownerId: appDoc.userId,
              name: storeName,
              slug: rawSlug,
              slugLower: rawSlug.toLowerCase(),
              status: "active",
              isVerified: true,
              description: sp.description ?? null,
              category: sp.category ?? appDoc.category ?? null,
              campus: sp.campus ?? appDoc.campus ?? null,
              operatingLocation: sp.operatingLocation ?? appDoc.operatingLocation ?? null,
              logo: sp.logo ?? null,
              coverImage: sp.coverImage ?? null,
              storeType:
                sp.storeType === "local_business" || isNonStudent
                  ? "local_business"
                  : "student_store",
              verificationType: resolvedVerificationType,
            },
          });
          await tx.sellerApplication.update({
            where: { id },
            data: { storeId: createdStore.id },
          });
          const totalStores = await tx.store.count({ where: { ownerId: appDoc.userId } });
          await tx.user.update({
            where: { id: appDoc.userId },
            data: { storesCount: totalStores },
          });
        }
      } else if (action === "reject" && appDoc.storeId) {
        await tx.store.deleteMany({
          where: {
            id: appDoc.storeId,
            status: { in: ["pending_review", "pending", "rejected"] },
          },
        });
        const remainingStores = await tx.store.count({
          where: { ownerId: appDoc.userId },
        });
        await tx.user.update({
          where: { id: appDoc.userId },
          data: { storesCount: remainingStores },
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
      return tx.sellerApplication.findUnique({ where: { id } });
    });

    await writeAdminLog({
      adminId: req.auth?.userId || "admin",
      action: `${action}_application`,
      targetType: "seller_application",
      targetId: id,
      details: { reviewNote },
    });

    res.status(200).json({ success: true, data: updated });
  } catch (err: any) {
    if (err?.code === "APPLICATION_ALREADY_PROCESSED" || err?.code === "STORE_CAP_EXCEEDED") {
      res.status(409).json({
        success: false,
        message: err.message,
        error: err.code.toLowerCase(),
      });
      return;
    }
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
    const status = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "";
    const targetType = typeof req.query.targetType === "string" ? req.query.targetType.trim().toLowerCase() : "";

    const statusFilter =
      !status || status === "all"
        ? {}
        : status === "pending" || status === "open"
        ? { status: { in: ["open", "pending"] } }
        : { status };

    const reports = await prisma.report.findMany({
      where: {
        ...statusFilter,
        ...(targetType && targetType !== "all" ? { targetType } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const reporterIds = Array.from(
      new Set(reports.map((r) => r.reporterId).filter((id) => id && id !== "guest"))
    );
    const users = reporterIds.length
      ? await prisma.user.findMany({
          where: { id: { in: reporterIds } },
          select: { id: true, email: true, fullName: true, displayName: true, username: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const formatted = reports.map((r) => {
      const user = userMap.get(r.reporterId);
      let supportMeta: any = null;
      if (r.targetType === "support" && r.details) {
        try {
          supportMeta = JSON.parse(r.details);
        } catch {}
      }

      const displayStatus =
        r.status === "open" || r.status === "pending"
          ? "Pending"
          : r.status === "in_review"
          ? "In Review"
          : r.status === "resolved"
          ? "Resolved"
          : "Dismissed";

      const priority =
        ["scam", "harassment", "prohibited_item"].includes(r.reason)
          ? "High"
          : r.targetType === "support"
          ? "Medium"
          : "Medium";

      return {
        ...r,
        _id: r.id,
        category: r.targetType === "support" ? `Support: ${r.reason}` : r.reason,
        details: supportMeta?.message || r.details || r.reason,
        status: displayStatus,
        priority,
        reporter: {
          id: r.reporterId,
          name:
            supportMeta?.name ||
            user?.displayName ||
            user?.fullName ||
            user?.username ||
            "Campus User",
          email: supportMeta?.email || user?.email || "",
        },
        against: {
          id: r.targetId,
          name:
            r.targetType === "support"
              ? `Help & Support (${r.reason})`
              : `${r.targetType} #${r.targetId.slice(0, 8)}`,
          type: r.targetType,
        },
      };
    });

    res.status(200).json({ success: true, data: formatted });
  } catch (err) {
    console.error("[adminListReports] Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export async function adminUpdateReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || "");
    const { status, resolutionNote, resolution, notes } = req.body || {};

    let nextStatus = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (!nextStatus && typeof resolution === "string") {
      nextStatus = resolution === "none" ? "dismissed" : "resolved";
    }

    if (!["open", "in_review", "resolved", "dismissed"].includes(nextStatus)) {
      res.status(400).json({ success: false, message: "Invalid report status or resolution" });
      return;
    }

    const effectiveNote =
      typeof notes === "string" && notes.trim()
        ? notes.trim()
        : typeof resolutionNote === "string" && resolutionNote.trim()
        ? resolutionNote.trim()
        : null;

    const existing = await prisma.report.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, message: "Report not found" });
      return;
    }

    // Apply moderation side-effect if requested
    if (resolution === "remove_listing" && existing.targetType === "listing") {
      await prisma.listing
        .update({ where: { id: existing.targetId }, data: { status: "removed" } })
        .catch(() => {});
    } else if (resolution === "suspend_store" && existing.targetType === "store") {
      await prisma.store
        .update({
          where: { id: existing.targetId },
          data: { status: "suspended", suspensionReason: effectiveNote || "Policy violation" },
        })
        .catch(() => {});
    } else if (
      (resolution === "suspend_user" || resolution === "ban_user") &&
      existing.targetType === "user"
    ) {
      await prisma.user
        .update({
          where: { id: existing.targetId },
          data: { accountStatus: resolution === "ban_user" ? "BANNED" : "SUSPENDED" },
        })
        .catch(() => {});
    }

    const updated = await prisma.report.update({
      where: { id },
      data: {
        status: nextStatus,
        resolutionNote: effectiveNote,
        resolvedBy: nextStatus === "open" ? null : req.auth?.userId || null,
        resolvedAt: nextStatus === "open" ? null : new Date(),
      },
    });
    await writeAdminLog({
      adminId: req.auth?.userId || "admin",
      action: "update_report",
      targetType: "report",
      targetId: id,
      details: { status: nextStatus, resolution, resolutionNote: effectiveNote },
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

    if (!imageUrl) {
      res.status(400).json({ success: false, message: "imageUrl is required" });
      return;
    }

    const parsedStartAt = startAt ? new Date(startAt) : null;
    const parsedEndAt = endAt ? new Date(endAt) : null;

    const banner = await prisma.banner.create({
      data: {
        placement: typeof placement === "string" && placement ? placement : "homepage_hero",
        headline: typeof headline === "string" && headline.trim() ? headline.trim() : "Promotional Banner",
        description: typeof description === "string" && description.trim() ? description.trim() : null,
        ctaLabel: typeof ctaLabel === "string" && ctaLabel.trim() ? ctaLabel.trim() : null,
        ctaUrl: typeof ctaUrl === "string" && ctaUrl.trim() ? ctaUrl.trim() : null,
        imageUrl: String(imageUrl),
        mobileImageUrl: typeof mobileImageUrl === "string" ? mobileImageUrl : null,
        imageAlt: typeof imageAlt === "string" ? imageAlt : null,
        targetCategory: typeof targetCategory === "string" ? targetCategory : null,
        status: typeof status === "string" && status ? status : "published",
        priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
        startAt: parsedStartAt && !Number.isNaN(parsedStartAt.getTime()) ? parsedStartAt : null,
        endAt: parsedEndAt && !Number.isNaN(parsedEndAt.getTime()) ? parsedEndAt : null,
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
        ...(body.startAt !== undefined
          ? { startAt: body.startAt ? new Date(body.startAt) : null }
          : {}),
        ...(body.endAt !== undefined
          ? { endAt: body.endAt ? new Date(body.endAt) : null }
          : {}),
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
