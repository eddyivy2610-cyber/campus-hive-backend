import { Router } from "express";
import authRoutes from "./auth.routes.js";
import searchRoutes from "./search.routes.js";
import userRoutes from "./user.routes.js";
import verificationRoutes from "./verification.routes.js";
import listingRoutes from "./listing.routes.js";
import orderRoutes from "./order.routes.js";
import chatRoutes from "./chat.routes.js";
import adminLogsRoutes from "./adminLogs.routes.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

router.use("/auth", authRoutes);
router.use("/search", searchRoutes);
router.use("/users", userRoutes);
router.use("/verification", verificationRoutes);
router.use("/listing", listingRoutes);
router.use("/order", orderRoutes);
router.use("/chat", chatRoutes);
router.use("/admin/logs", adminLogsRoutes);

export default router;
