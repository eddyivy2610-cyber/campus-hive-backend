import Listing from "../models/Listing.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import AdminLog from "../models/AdminLog.js";
import Admin from "../models/Admin.js";

// --- Admin Endpoints ---

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

// Admin: Approve Listing
export const adminApproveListing = async (req, res) => {
    try {
        const { id } = req.params;
        const listing = await Listing.findByIdAndUpdate(
            id,
            { status: "active" },
            { new: true }
        ).populate("sellerId", "email");

        if (!listing) return res.status(404).json({ message: "Listing not found" });

        await AdminLog.create({
            type: "listing_approved",
            message: `Listing '${listing.title}' approved`,
            userId: req.user.id,
            metadata: { listingId: id }
        });

        // Notify Seller
        await Notification.create({
            recipient: listing.sellerId._id,
            type: "system",
            title: "Listing Approved!",
            message: `Your listing '${listing.title}' has been approved and is now live!`,
            link: `/product/${listing.slug}`
        });

        res.status(200).json({ success: true, message: "Listing approved", data: listing });
    } catch (error) {
        console.error("Approve listing error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Admin: Reject Listing
export const adminRejectListing = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const listing = await Listing.findByIdAndUpdate(
            id,
            { status: "rejected" },
            { new: true }
        ).populate("sellerId", "email");

        if (!listing) return res.status(404).json({ message: "Listing not found" });

        await AdminLog.create({
            type: "listing_rejected",
            message: `Listing '${listing.title}' rejected. Reason: ${reason}`,
            userId: req.user.id,
            metadata: { listingId: id, reason }
        });

        // Notify Seller
        await Notification.create({
            recipient: listing.sellerId._id,
            type: "system",
            title: "Listing Rejected",
            message: `Your listing '${listing.title}' was rejected. Reason: ${reason}`,
            link: "/dashboard/products"
        });

        res.status(200).json({ success: true, message: "Listing rejected", data: listing });
    } catch (error) {
        console.error("Reject listing error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// --- General Endpoints ---

// Get active listings for marketplace
export const getActiveListings = async (req, res) => {
    try {
        const { category, search, minPrice, maxPrice } = req.query;
        
        let query = { status: "active" };
        if (category) query.category = category;
        if (search) query.title = { $regex: search, $options: "i" };
        if (minPrice || maxPrice) {
            query.price = {};
            if (minPrice) query.price.$gte = Number(minPrice);
            if (maxPrice) query.price.$lte = Number(maxPrice);
        }

        const listings = await Listing.find(query)
            .populate("sellerId", "profile.displayName profile.avatar")
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: listings });
    } catch (error) {
        console.error("Get listings error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Create a new listing
export const createListing = async (req, res) => {
    try {
        const { title, description, price, category, condition, images, location, ...details } = req.body;
        const sellerId = req.user.id;

        // Verify seller status
        const seller = await User.findById(sellerId).select("role studentStatus profile");
        if (!seller || (seller.role !== "seller" && seller.role !== "pro")) {
            return res.status(403).json({ message: "Only verified sellers can create listings" });
        }
        
        // Use matches existing logic if student verification is enabled
        // Allowing both pro and verified students
        const isStudentVerified = seller.studentStatus?.isVerified || seller.role === "pro";
        if (!isStudentVerified) {
            return res.status(403).json({ message: "Student verification required to create listings. Please check your profile status." });
        }
        
        const slug = title.toLowerCase().split(' ').join('-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now();
        const listingCode = "LST-" + Math.floor(1000 + Math.random() * 9000) + "-CH";

        const newListing = new Listing({
            sellerId,
            title,
            slug,
            description,
            price: Number(price),
            category,
            condition,
            images,
            location,
            listingCode,
            ...details
        });

        await newListing.save();

        // Notify Admins
        const admins = await Admin.find({ status: "active" });
        await Promise.all(admins.map(admin => 
            Notification.create({
                recipient: admin._id,
                type: "verification_pending",
                title: "New Listing Submission",
                message: `New listing '${newListing.title}' submitted for review.`,
                link: `/admin/listings`
            })
        ));

        res.status(201).json({ success: true, data: newListing });
    } catch (error) {
        console.error("Create listing error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Get listings for current authenticated user
export const getUserListings = async (req, res) => {
    try {
        const sellerId = req.user.id;
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

// Get a single listing by ID/Slug
export const getListingById = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Find by ID or Slug
        const listing = await Listing.findOne({ 
            $or: [
                { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }, 
                { slug: id }
            ] 
        }).populate("sellerId", "profile studentStatus email");

        if (!listing) {
            return res.status(404).json({ message: "Listing not found" });
        }

        res.status(200).json({ success: true, data: listing });
    } catch (error) {
        console.error("Get listing error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
