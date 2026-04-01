import Listing from "../models/Listing.js";

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
        const { sellerId, title, description, price, category, condition, images, location } = req.body;
        
        const slug = title.toLowerCase().split(' ').join('-') + '-' + Date.now();
        const listingCode = "LST-" + Math.floor(1000 + Math.random() * 9000) + "-CH";

        const newListing = new Listing({
            sellerId,
            title,
            slug,
            description,
            price,
            category,
            condition,
            images,
            location,
            listingCode
        });

        await newListing.save();

        res.status(201).json({ success: true, data: newListing });
    } catch (error) {
        console.error("Create listing error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
