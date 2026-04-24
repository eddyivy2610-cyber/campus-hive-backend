import { Router } from "express";
import authRoutes from "./auth.routes.js";
import searchRoutes from "./search.routes.js";
import userRoutes from "./user.routes.js";
import verificationRoutes from "./verification.routes.js";
import listingRoutes from "./listing.routes.js";
import orderRoutes from "./order.routes.js";
import chatRoutes from "./chat.routes.js";
import adminAuthRoutes from "./adminAuth.routes.js";
import adminLogsRoutes from "./adminLogs.routes.js";

import uploadRoutes from "./upload.routes.js";
import onboardingRoutes from "./onboarding.routes.js";
import notificationRoutes from "./notification.routes.js";
import dashboardRoutes from "./dashboard.routes.js";
import reviewRoutes from "./review.routes.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

router.use("/auth", authRoutes);
router.use("/onboarding", onboardingRoutes);
router.use("/search", searchRoutes);
router.use("/users", userRoutes);
router.use("/verification", verificationRoutes);
router.use("/listing", listingRoutes);
router.use("/upload", uploadRoutes);
router.use("/order", orderRoutes);
router.use("/chat", chatRoutes);
router.use("/admin/auth", adminAuthRoutes);
router.use("/admin/logs", adminLogsRoutes);
router.use("/notifications", notificationRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/reviews", reviewRoutes);

export default router;
