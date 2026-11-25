import { Router } from "express";
import authRoute from "./auth.route.ts";
import storeRoute from "./store.route.ts";
import listingRoute from "./listing.route.ts";
import followRoute from "./follow.route.ts";
import orderRoute from "./order.route.ts";
import reviewRoute from "./review.route.ts";
import adminRoute from "./admin.route.ts";
import uploadRoute from "./upload.route.ts";
import messageRoute from "./message.route.ts";
import dashboardRoute from "./dashboard.route.ts";
import realtimeRoute from "./realtime.route.ts";
import { authenticate, AuthenticatedRequest } from "../middlewares/auth.middleware.ts";
import { getMe } from "../controllers/auth.controller.ts";
import { listFollowing } from "../controllers/follow.controller.ts";
import { verifyAccessToken } from "../services/token.service.ts";
import prisma from "../prisma.ts";

const router = Router();

router.use("/auth", authRoute);
router.use("/stores", storeRoute);
router.use("/listings", listingRoute);
router.use("/follow", followRoute);
router.use("/orders", orderRoute);
router.use("/reviews", reviewRoute);
router.use("/admin", adminRoute);
router.use("/upload", uploadRoute);
router.use("/messages", messageRoute);
router.use("/dashboard", dashboardRoute);
router.use("/realtime", realtimeRoute);

// Frontend (campushive) compatibility endpoints
router.get("/users/profile", async (req, res, next) => {
  const rawHandle = typeof req.query.handle === "string" ? req.query.handle.trim().replace(/^@/, "").toLowerCase() : "";
  const rawQuery = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const rawUserId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";

  if (rawQuery || rawUserId || (rawHandle && rawHandle !== "me")) {
    res.setHeader("Cache-Control", "private, no-store, must-revalidate");
    res.status(404).json({
      success: false,
      message: "Public user profiles and handle lookups are disabled. User accounts are private.",
    });
    return;
  }

  return authenticate(req as AuthenticatedRequest, res, () => getMe(req as AuthenticatedRequest, res));
});
router.patch("/users/profile", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }
    const displayName =
      typeof req.body?.displayName === "string"
        ? req.body.displayName.trim()
        : typeof req.body?.name === "string"
        ? req.body.name.trim()
        : undefined;
    const avatar =
      typeof req.body?.avatar === "string"
        ? req.body.avatar.trim()
        : typeof req.body?.profileImage === "string"
        ? req.body.profileImage.trim()
        : undefined;
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(displayName ? { displayName, fullName: displayName } : {}),
        ...(avatar !== undefined ? { profileImage: avatar || null } : {}),
      },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        displayName: true,
        profileImage: true,
        role: true,
        isEmailVerified: true,
        accountStatus: true,
      },
    });
    const formatted = {
      ...updated,
      name: updated.displayName || updated.fullName || updated.username,
      emailVerified: Boolean(updated.isEmailVerified),
      onboardingStep: "profile_completed",
      profile: {
        displayName: updated.displayName || updated.fullName || updated.username,
        handle: updated.username,
        avatar: updated.profileImage || null,
      },
    };
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ success: true, data: formatted, user: formatted });
  } catch (err) {
    console.error("[PATCH /users/profile] Error:", err);
    res.status(500).json({ message: "Failed to update profile" });
  }
});
router.get("/users/check-username", async (req, res) => {
  const username = String(req.query.username || "").trim().toLowerCase();
  if (!username) {
    res.status(400).json({ available: false, message: "username is required" });
    return;
  }
  const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  res.status(200).json({ success: true, available: !existing });
});
router.get("/users/preferences", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const prefs = await prisma.userPreference.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    res.status(200).json({ success: true, data: prefs });
  } catch (err) {
    console.error("[GET /users/preferences] Error:", err);
    res.status(500).json({ message: "Failed to load preferences" });
  }
});
router.patch("/users/preferences", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const body = req.body || {};
    const updateData: Record<string, any> = {};
    if (body.theme === "light" || body.theme === "dark" || body.theme === "system") {
      updateData.theme = body.theme;
    }
    if (
      body.homeFeedPreference === "popular" ||
      body.homeFeedPreference === "recent" ||
      body.homeFeedPreference === "both"
    ) {
      updateData.homeFeedPreference = body.homeFeedPreference;
    }
    if (typeof body.emailNotifications === "boolean") {
      updateData.emailNotifications = body.emailNotifications;
    }
    if (typeof body.pushNotifications === "boolean") {
      updateData.pushNotifications = body.pushNotifications;
    }
    const prefs = await prisma.userPreference.upsert({
      where: { userId },
      update: updateData,
      create: { userId, ...updateData },
    });
    res.status(200).json({ success: true, data: prefs });
  } catch (err) {
    console.error("[PATCH /users/preferences] Error:", err);
    res.status(500).json({ message: "Failed to update preferences" });
  }
});
router.get("/follows/stores", authenticate, listFollowing);
router.get("/banners/active", async (req, res) => {
  try {
    const placement = typeof req.query.placement === "string" ? req.query.placement : "homepage_hero";
    const now = new Date();
    const banners = await prisma.banner.findMany({
      where: {
        placement,
        status: "published",
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gte: now } }] },
        ],
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 10,
    });
    res.status(200).json({ success: true, data: banners, banners });
  } catch (err) {
    console.error("[GET /banners/active] Error:", err);
    res.status(500).json({ message: "Failed to load active banners" });
  }
});
router.get("/notifications", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.notification.count({
        where: { userId, isRead: false },
      }),
    ]);
    res.status(200).json({ success: true, data: notifications, unreadCount });
  } catch (err) {
    console.error("[GET /notifications] Error:", err);
    res.status(500).json({ message: "Failed to load notifications" });
  }
});
router.patch("/notifications/read-all", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    res.status(200).json({ success: true, unreadCount: 0 });
  } catch (err) {
    console.error("[PATCH /notifications/read-all] Error:", err);
    res.status(500).json({ message: "Failed to mark notifications as read" });
  }
});
router.patch("/notifications/:id", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const id = String(req.params.id || "").trim();
    const updated = await prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: new Date() },
    });
    if (updated.count === 0) {
      res.status(404).json({ success: false, message: "Notification not found" });
      return;
    }
    const unreadCount = await prisma.notification.count({ where: { userId, isRead: false } });
    res.status(200).json({ success: true, unreadCount });
  } catch (err) {
    console.error("[PATCH /notifications/:id] Error:", err);
    res.status(500).json({ message: "Failed to update notification" });
  }
});

router.post("/reports", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
    const rawType = String(req.body?.targetType || req.body?.reportType || "listing").toLowerCase();
    const targetType = rawType === "profile" ? "store" : rawType;
    const targetId = String(req.body?.targetId || "").trim();
    const reason = String(req.body?.reason || "other").trim().toLowerCase();
    const details = typeof req.body?.details === "string" ? req.body.details.trim().slice(0, 1000) : "";

    if (!targetId) {
      res.status(400).json({ success: false, message: "targetId is required" });
      return;
    }
    if (!details && reason === "other") {
      res.status(400).json({ success: false, message: "Please provide details for the report." });
      return;
    }

    const report = await prisma.report.create({
      data: {
        reporterId: userId,
        targetType,
        targetId,
        reason,
        details: details || reason,
        status: "open",
      },
    });
    res.status(201).json({ success: true, data: report });
  } catch (err) {
    console.error("[POST /reports] Error:", err);
    res.status(500).json({ success: false, message: "Failed to submit report." });
  }
});

router.post("/support", async (req, res) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const category = typeof req.body?.category === "string" ? req.body.category.trim() : "general";
    const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 2000) : "";

    if (!name || !email || !message) {
      res.status(400).json({ success: false, message: "Name, email, and message are required." });
      return;
    }

    let reporterId = "guest";
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    const cookieToken = (req as any).cookies?.accessToken || null;
    const token = bearer || cookieToken;
    if (token) {
      const decoded = await verifyAccessToken(token).catch(() => null);
      if (decoded?.userId) reporterId = decoded.userId;
    }

    const report = await prisma.report.create({
      data: {
        reporterId,
        targetType: "support",
        targetId: category,
        reason: category,
        details: JSON.stringify({ name, email, category, message }),
        status: "open",
      },
    });
    res.status(201).json({ success: true, data: report });
  } catch (err) {
    console.error("[POST /support] Error:", err);
    res.status(500).json({ success: false, message: "Failed to submit support request." });
  }
});

export default router;