import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import {
  createListing,
  deleteListing,
  listFeed,
  updateListing,
} from "../controllers/listing.controller.ts";

const router = Router();

router.get("/", listFeed);
router.post("/", authenticate, createListing);
router.patch("/:id", authenticate, updateListing);
router.delete("/:id", authenticate, deleteListing);

export default router;
