import Listing from "../models/Listing.js";

// ============================================================
// READ-ONLY LISTING CONTROLLERS
// Express is read-only on listings. Next.js owns all listing writes.
// ============================================================

// --- Admin Endpoints (Read-Only) ---

// Get all listings for admin dashboard
export const getAllListingsAdmin = async (req, res) => {
    try {
        const { status } = req.query;
        let query = {};
        if (status) query.status = status;

        const listings = await Listing.find(query)
            .populate("sellerId", "profile.displayName email")
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: listings.length,
            data: listings
        });
    } catch (error) {
        console.error("Get all listings admin error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Admin: Approve Listing (Disallowed in Express — owned by Next.js)
export const adminApproveListing = async (_req, res) => {
    return res.status(405).json({
        success: false,
        error: "METHOD_NOT_ALLOWED",
        message: "Listing moderation is owned exclusively by Next.js API (/api/admin/listings/[id]).",
    });
};

// Admin: Reject Listing (Disallowed in Express — owned by Next.js)
export const adminRejectListing = async (_req, res) => {
    return res.status(405).json({
        success: false,
        error: "METHOD_NOT_ALLOWED",
        message: "Listing moderation is owned exclusively by Next.js API (/api/admin/listings/[id]).",
    });
};

// --- General Endpoints (Read-Only) ---

// Get active listings for marketplace
export const getActiveListings = async (req, res) => {
    try {
        const { category, search, minPrice, maxPrice, sellerId } = req.query;
        
        let query = { status: "active" };
        if (category) query.category = category;
        if (sellerId) query.sellerId = sellerId;
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: "i" } },
                { description: { $regex: search, $options: "i" } }
            ];
        }
        if (minPrice || maxPrice) {
            query.price = {};
            if (minPrice) query.price.$gte = Number(minPrice);
            if (maxPrice) query.price.$lte = Number(maxPrice);
        }

        const listings = await Listing.find(query)
            .populate("sellerId", "profile.displayName profile.avatar profile.handle businessProfile personalDetails studentStatus")
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: listings });
    } catch (error) {
        console.error("Get listings error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Create a new listing (Disallowed in Express — owned by Next.js)
export const createListing = async (_req, res) => {
    return res.status(405).json({
        success: false,
        error: "METHOD_NOT_ALLOWED",
        message: "Listing creation is owned exclusively by Next.js API (/api/listings).",
    });
};

// Get listings for current authenticated user (Read-Only)
export const getUserListings = async (req, res) => {
    try {
        const sellerId = req.user.id || req.user._id;
        const listings = await Listing.find({ sellerId }).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: listings.length,
            data: listings
        });
    } catch (error) {
        console.error("Get user listings error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Get a single listing by ID/Slug (Read-Only)
export const getListingById = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Find by ID or Slug, strictly whitelisting active listings for public marketplace
        const isObjectId = Boolean(id && /^[0-9a-fA-F]{24}$/.test(id));
        const query = {
            status: "active",
            $or: isObjectId ? [{ _id: id }, { slug: id }] : [{ slug: id }],
        };

        const listing = await Listing.findOne(query).populate("sellerId", "profile studentStatus businessProfile personalDetails email");

        if (!listing) {
            return res.status(404).json({ message: "Listing not found" });
        }

        res.status(200).json({ success: true, data: listing });
    } catch (error) {
        console.error("Get listing error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Update a listing (Disallowed in Express — owned by Next.js)
export const updateListing = async (_req, res) => {
    return res.status(405).json({
        success: false,
        error: "METHOD_NOT_ALLOWED",
        message: "Listing update is owned exclusively by Next.js API (/api/listings/[id]).",
    });
};
