import { Router } from "express";
import { toggleFollow, checkFollowing } from "../controllers/follow.controller.js";
import { protect } from "../utils/auth.js";

const router = Router();

router.post("/toggle/:followingId", protect, toggleFollow);
router.get("/status/:followingId", protect, checkFollowing);

export default router;
