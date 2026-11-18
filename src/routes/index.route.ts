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
import { authenticate } from "../middlewares/auth.middleware.ts";
import { getMe } from "../controllers/auth.controller.ts";
import { listFollowing } from "../controllers/follow.controller.ts";

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
router.get("/users/profile", authenticate, getMe);
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