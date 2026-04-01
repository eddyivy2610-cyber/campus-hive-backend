import { Router } from "express";
import { getActiveListings, getAllListingsAdmin, createListing } from "../controllers/listing.controller.js";

const router = Router();

// Regular marketplace access
router.get("/active", getActiveListings);
router.post("/create", createListing);

// Admin / Internal access
router.get("/admin/all", getAllListingsAdmin);

export default router;
