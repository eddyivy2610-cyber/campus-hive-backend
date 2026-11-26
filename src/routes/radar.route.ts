import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import {
  createRadarPost,
  deleteRadarPost,
  getRadarPost,
  listRadarPosts,
  replyRadarPost,
} from "../controllers/radar.controller.ts";

const router = Router();

router.get("/", listRadarPosts);
router.post("/", authenticate, createRadarPost);
router.get("/:id", getRadarPost);
router.delete("/:id", authenticate, deleteRadarPost);
router.post("/:id/replies", authenticate, replyRadarPost);

export default router;
