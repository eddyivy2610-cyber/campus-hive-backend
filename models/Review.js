import mongoose, { Schema, model, Types } from "mongoose";

const ReviewSchema = new Schema(
    {
        sellerId: {
            type: Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        reviewerId: {
            type: Types.ObjectId,
            ref: "User",
            required: true,
        },
        orderId: {
            type: Types.ObjectId,
            ref: "Order",
            required: false,
        },
        listingId: {
            type: Types.ObjectId,
            ref: "Listing",
            index: true,
            required: false,
        },
        rating: {
            type: Number,
            required: true,
            min: 1,
            max: 5,
        },
        comment: {
            type: String,
            required: true,
            trim: true,
            maxlength: 1000,
        },
        images: [String],
        status: {
            type: String,
            enum: ["published", "hidden", "flagged"],
            default: "published",
        },
        schemaVersion: {
            type: Number,
            default: 1,
            required: true,
            index: true,
        },
    },
    {
        timestamps: true,
        strict: true,
    }
);

ReviewSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate"], function () {
    this.setOptions({ runValidators: true });
});

// Update user rating aggregate on review save (gracefully handles read-only User collection in Express)
ReviewSchema.post("save", async function() {
    try {
        const Review = this.constructor;
        const stats = await Review.aggregate([
            { $match: { sellerId: this.sellerId, status: "published" } },
            {
                $group: {
                    _id: "$sellerId",
                    avgRating: { $avg: "$rating" },
                    nRatings: { $sum: 1 },
                },
            },
        ]);

        if (stats.length > 0) {
            await mongoose.model("User").findByIdAndUpdate(this.sellerId, {
                "rating.average": Math.round(stats[0].avgRating * 10) / 10,
                "rating.count": stats[0].nRatings,
            });
        }
    } catch {
        // Express backend is read-only on users; user rating mutations are owned by Next.js
    }
});

const Review = mongoose.models.Review || model("Review", ReviewSchema);
export default Review;
