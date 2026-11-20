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
import { authenticate, AuthenticatedRequest } from "../middlewares/auth.middleware.ts";
import { getMe } from "../controllers/auth.controller.ts";
import { listFollowing } from "../controllers/follow.controller.ts";
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

// Frontend (campushive) compatibility endpoints
router.get("/users/profile", async (req, res, next) => {
  const rawHandle = typeof req.query.handle === "string" ? req.query.handle.trim().replace(/^@/, "").toLowerCase() : "";
  if (!rawHandle) {
    return authenticate(req as AuthenticatedRequest, res, () => getMe(req as AuthenticatedRequest, res));
  }
  try {
    const user = await prisma.user.findUnique({
      where: { username: rawHandle },
      select: {
        id: true,
        username: true,
        fullName: true,
        displayName: true,
        profileImage: true,
        role: true,
        createdAt: true,
        stores: {
          where: { status: "active" },
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            category: true,
            campus: true,
            operatingLocation: true,
            status: true,
            followersCount: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }
    const activeStores = (user.stores || []).map((s) => ({ ...s, _id: s.id }));
    const formatted = {
      ...user,
      _id: user.id,
      name: user.displayName || user.fullName || user.username,
      profile: {
        displayName: user.displayName || user.fullName || user.username,
        handle: user.username,
        avatar: user.profileImage || null,
      },
      stores: activeStores,
      store: activeStores[0] || null,
      storeId: activeStores[0]?.id || null,
    };
    res.status(200).json({ success: true, data: formatted, user: formatted });
  } catch (err) {
    next(err);
  }
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
router.get("/users/preferences", authenticate, (_req, res) => {
  res.status(200).json({ success: true, data: { emailNotifications: true, pushNotifications: true } });
});
router.patch("/users/preferences", authenticate, (req, res) => {
  res.status(200).json({ success: true, data: req.body || {} });
});
router.get("/follows/stores", authenticate, listFollowing);
router.get("/banners/active", (_req, res) => {
  res.status(200).json({ success: true, data: [], banners: [] });
});
router.get("/notifications", authenticate, (_req, res) => {
  res.status(200).json({ success: true, data: [], unreadCount: 0 });
});
router.patch("/notifications/read-all", authenticate, (_req, res) => {
  res.status(200).json({ success: true });
});

export default router;