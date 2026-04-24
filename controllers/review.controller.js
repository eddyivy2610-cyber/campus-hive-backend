import Review from "../models/Review.js";
import User from "../models/User.js";

export const createReview = async (req, res) => {
    try {
        const { sellerId, rating, comment, listingId, orderId } = req.body;
        const reviewerId = req.user._id;

        if (!sellerId || !rating || !comment) {
            return res.status(400).json({ message: "Seller ID, rating, and comment are required" });
        }

        if (sellerId.toString() === reviewerId.toString()) {
            return res.status(400).json({ message: "You cannot review yourself" });
        }

        const review = await Review.create({
            sellerId,
            reviewerId,
            rating,
            comment,
            listingId,
            orderId
        });

        res.status(201).json({ message: "Review submitted successfully", data: review });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getSellerReviews = async (req, res) => {
    try {
        const { sellerId } = req.params;
        const reviews = await Review.find({ sellerId, status: "published" })
            .populate("reviewerId", "profile.displayName profile.avatar")
            .sort({ createdAt: -1 });

        res.status(200).json({ data: reviews });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
