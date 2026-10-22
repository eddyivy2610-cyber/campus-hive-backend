import { Router } from "express";
import { getActiveListings, getAllListingsAdmin, createListing, getUserListings, getListingById, adminApproveListing, adminRejectListing, updateListing } from "../controllers/listing.controller.js";
import { protect, adminProtect } from "../utils/auth.js";

const router = Router();

// Regular marketplace access (READ-ONLY)
router.get("/active", getActiveListings);
router.get("/single/:id", getListingById);
router.get("/user/all", protect, getUserListings);

// Admin / Internal access (READ-ONLY)
router.get("/admin/all", adminProtect, getAllListingsAdmin);

// Write endpoints (Owned exclusively by Next.js API)
router.post("/create", createListing);
router.put("/update/:id", updateListing);
router.put("/admin/approve/:id", adminApproveListing);
router.put("/admin/reject/:id", adminRejectListing);

export default router;
