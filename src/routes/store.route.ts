import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import { storeCreateRateLimiter } from "../lib/rateLimit.ts";
import {
  createStore,
  deleteStore,
  getPublicStore,
  listMyStores,
  listPublicStores,
  updateStore,
} from "../controllers/store.controller.ts";

const router = Router();

router.get("/", listPublicStores);
router.get("/me", authenticate, listMyStores);
router.post("/", authenticate, storeCreateRateLimiter, createStore);
router.get("/:slug", getPublicStore);
router.patch("/:id", authenticate, updateStore);
router.delete("/:id", authenticate, deleteStore);

export default router;
