import { getActiveListings, getAllListingsAdmin, createListing, getUserListings } from "../controllers/listing.controller.js";
import { protect } from "../utils/auth.js";

const router = Router();

// Regular marketplace access
router.get("/active", getActiveListings);
router.post("/create", protect, createListing);
router.get("/user/all", protect, getUserListings);

// Admin / Internal access
router.get("/admin/all", protect, getAllListingsAdmin);

export default router;
