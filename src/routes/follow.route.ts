import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import {
  followStore,
  listFollowing,
  unfollowStore,
} from "../controllers/follow.controller.ts";

const router = Router();

router.get("/", authenticate, listFollowing);
router.post("/:storeId", authenticate, followStore);
router.delete("/:storeId", authenticate, unfollowStore);

export default router;
