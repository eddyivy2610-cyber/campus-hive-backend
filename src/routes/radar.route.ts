import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import { radarReplyRateLimiter } from "../lib/rateLimit.ts";
import {
  createRadarPost,
  deleteRadarPost,
  getRadarPost,
  listRadarPosts,
  replyRadarPost,
} from "../controllers/radar.controller.ts";

const router = Router();

router.get("/", listRadarPosts);
router.post("/", authenticate, radarReplyRateLimiter, createRadarPost);
router.get("/:id", getRadarPost);
router.delete("/:id", authenticate, deleteRadarPost);
router.post("/:id/replies", authenticate, radarReplyRateLimiter, replyRadarPost);

export default router;
