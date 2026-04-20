import Listing from "../models/Listing.js";
import User from "../models/User.js";

// --- Admin Endpoints ---

// Get all listings for admin dashboard
export const getAllListingsAdmin = async (req, res) => {
    try {
        const listings = await Listing.find()
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
