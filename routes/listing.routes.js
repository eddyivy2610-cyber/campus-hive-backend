import { Router } from "express";
import { getActiveListings, getAllListingsAdmin, createListing, getUserListings, getListingById } from "../controllers/listing.controller.js";
import { protect } from "../utils/auth.js";

const router = Router();

// Regular marketplace access
router.get("/active", getActiveListings);
router.get("/single/:id", getListingById);
router.post("/create", protect, createListing);
router.get("/user/all", protect, getUserListings);

// Admin / Internal access
router.get("/admin/all", protect, getAllListingsAdmin);

export default router;
