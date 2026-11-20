import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import {
  createListing,
  deleteListing,
  getListingById,
  listFeed,
  trackListingView,
  updateListing,
} from "../controllers/listing.controller.ts";

const router = Router();

router.get("/", listFeed);
router.get("/:id", getListingById);
router.post("/:id/view", trackListingView);
router.post("/", authenticate, createListing);
router.patch("/:id", authenticate, updateListing);
router.delete("/:id", authenticate, deleteListing);

export default router;
