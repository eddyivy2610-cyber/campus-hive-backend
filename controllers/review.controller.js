import Review from "../models/Review.js";
import User from "../models/User.js";
import Order from "../models/Order.js";

/**
 * Legacy review creation endpoint.
 * Marked as deprecated; directs consumers to Next.js canonical POST /api/reviews.
 */
export const createReview = async (req, res) => {
    try {
        res.setHeader("X-API-Deprecated", "true");
        res.setHeader("X-API-Replacement", "/api/reviews");
        res.setHeader("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate");

        const reviewerId = req.user?._id || req.user?.id;
        if (!reviewerId) {
            return res.status(401).json({ message: "Authentication required" });
        }

        const { sellerId, rating, comment, listingId, orderId } = req.body;

        if (!rating || !comment) {
            return res.status(400).json({ message: "Rating and comment are required" });
        }

        const numRating = Number(rating);
        if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
            return res.status(400).json({ message: "Rating must be an integer between 1 and 5" });
        }

        // Eligibility verification if orderId is provided
        let targetSellerId = sellerId;
        if (orderId) {
            const order = await Order.findById(orderId);
            if (!order) {
                return res.status(404).json({ message: "Order not found" });
            }
            if (order.buyerId.toString() !== reviewerId.toString()) {
                return res.status(403).json({ message: "Only the buyer can review this order" });
            }
            if (order.status !== "delivered") {
                return res.status(400).json({ message: "Order must be delivered before review" });
            }
            targetSellerId = order.sellerId;

            // Duplicate check
            const existing = await Review.findOne({ reviewerId, orderId });
            if (existing) {
                return res.status(409).json({ message: "You have already reviewed this transaction" });
            }
        }

        if (!targetSellerId) {
            return res.status(400).json({ message: "Seller ID or valid orderId is required" });
        }

        if (targetSellerId.toString() === reviewerId.toString()) {
            return res.status(400).json({ message: "You cannot review yourself" });
        }

        const review = await Review.create({
            sellerId: targetSellerId,
            reviewerId,
            rating: numRating,
            comment: comment.trim(),
            listingId: listingId || undefined,
            orderId: orderId || undefined,
            status: "published",
            schemaVersion: 1,
        });

        res.status(201).json({ message: "Review submitted successfully", data: review });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: "You have already reviewed this transaction" });
        }
        res.status(500).json({ message: error.message });
    }
};

/**
 * Legacy seller reviews retrieval.
 * Marked as deprecated; directs consumers to Next.js canonical GET /api/reviews?sellerId=...
 */
export const getSellerReviews = async (req, res) => {
    try {
        res.setHeader("X-API-Deprecated", "true");
        res.setHeader("X-API-Replacement", "/api/reviews");
        res.setHeader("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate");

        const { sellerId } = req.params;
        const reviews = await Review.find({ sellerId, status: "published" })
            .populate("reviewerId", "profile.displayName profile.avatar name")
            .sort({ createdAt: -1 });

        // Sanitize reviewer PII
        const sanitized = reviews.map((r) => {
            const rev = r.reviewerId;
            return {
                id: r._id,
                sellerId: r.sellerId,
                rating: r.rating,
                comment: r.comment,
                images: r.images,
                createdAt: r.createdAt,
                reviewer: {
                    name: rev?.profile?.displayName || rev?.name || "Campus Buyer",
                    avatar: rev?.profile?.avatar,
                },
            };
        });

        res.status(200).json({ data: sanitized });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
