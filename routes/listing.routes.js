import { Router } from "express";
import { getActiveListings, getAllListingsAdmin, createListing, getUserListings, getListingById, adminApproveListing, adminRejectListing } from "../controllers/listing.controller.js";
import { protect, adminProtect } from "../utils/auth.js";

const router = Router();

// Regular marketplace access
router.get("/active", getActiveListings);
router.get("/single/:id", getListingById);
router.post("/create", protect, createListing);
router.get("/user/all", protect, getUserListings);

// Admin / Internal access
router.get("/admin/all", adminProtect, getAllListingsAdmin);
router.put("/admin/approve/:id", adminProtect, adminApproveListing);
router.put("/admin/reject/:id", adminProtect, adminRejectListing);

export default router;
