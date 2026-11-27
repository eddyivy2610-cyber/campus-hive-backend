import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import { followWriteRateLimiter } from "../lib/rateLimit.ts";
import {
  followStore,
  getFollowCounts,
  getFollowStatus,
  listFollowing,
  toggleFollow,
  unfollowStore,
} from "../controllers/follow.controller.ts";

const router = Router();

router.get("/", authenticate, listFollowing);
router.get("/status/:targetId", getFollowStatus);
router.get("/counts/:targetId", getFollowCounts);
router.post("/toggle/:targetId", authenticate, followWriteRateLimiter, toggleFollow);
router.get("/:targetId", getFollowStatus);
router.post("/:storeId", authenticate, followWriteRateLimiter, followStore);
router.delete("/:storeId", authenticate, followWriteRateLimiter, unfollowStore);

export default router;
