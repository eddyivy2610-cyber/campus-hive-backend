import { Router } from "express";
import { toggleFollow, checkFollowing } from "../controllers/follow.controller.js";
import { protect } from "../utils/auth.js";

const router = Router();

// Deprecation middleware informing legacy callers to transition to Next.js /api/follow
router.use((req, res, next) => {
  res.setHeader("Deprecation", "@deprecated Use Next.js /api/follow");
  res.setHeader("Link", '</api/follow>; rel="successor-version"');
  next();
});

router.post("/toggle/:followingId", protect, toggleFollow);
router.get("/status/:followingId", protect, checkFollowing);

export default router;
