import mongoose, { Schema, model, Types } from "mongoose";
import {
    PRODUCT_CONDITIONS,
    LISTING_STATUSES,
    LISTING_PAUSED_BY_REASONS,
    LISTING_REMOVED_BY_REASONS,
} from "../constants/enums.js";

const ListingSchema = new Schema(
    {
        sellerId: {
            type: Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        slug: {
            type: String,
            lowercase: true,
            trim: true
        },
        description: {
            type: String,
            required: true
        },
        price: {
            type: Number,
            required: true,
            min: 0
        },
        category: {
            type: String,
            required: true
        },
        campus: {
            type: String,
            required: false
        },
        condition: {
            type: String,
            enum: PRODUCT_CONDITIONS,
            required: false
        },
        images: [{
            type: String,
            required: true
        }],
        location: {
            type: String,
            required: true
        },
        status: {
            type: String,
            enum: LISTING_STATUSES,
            default: "pending_review"
        },
        pausedBy: {
            type: String,
            enum: LISTING_PAUSED_BY_REASONS,
            required: false
        },
        removedBy: {
            type: String,
            enum: LISTING_REMOVED_BY_REASONS,
            required: false
        },
        inventory: {
            type: Number,
            default: 1
        },
        negotiable: {
            type: Boolean,
            default: false
        },
        minPrice: {
            type: Number
        },
        tags: [String],
        specs: {
            type: Map,
            of: String
        },
        fulfillment: {
            delivery: { type: Boolean, default: false },
            pickup: { type: Boolean, default: true },
            pickupLocation: String
        },
        paymentMethods: {
            type: [String],
            enum: ["cash", "transfer", "card"],
            default: ["cash"]
        },
        visibility: {
            type: String,
            enum: ["public", "campus-only"],
            default: "public"
        },
        isFeatured: {
            type: Boolean,
            default: false
        },
        views: {
            type: Number,
            default: 0
        },
        listingCode: {
            type: String,
            trim: true
        },
        schemaVersion: {
            type: Number,
            default: 1,
            required: true,
            index: true
        }
    },
    {
        timestamps: true,
        strict: true,
        autoIndex: process.env.NODE_ENV !== "production"
    }
);

// High performance ESR compound indexes matching Next.js with (createdAt, _id) tie-breaker
ListingSchema.index({ status: 1, createdAt: -1, _id: -1 });
ListingSchema.index({ status: 1, campus: 1, createdAt: -1, _id: -1 });
ListingSchema.index({ status: 1, campus: 1, category: 1, createdAt: -1, _id: -1 });
ListingSchema.index({ status: 1, campus: 1, category: 1, listingType: 1, createdAt: -1, _id: -1 });
ListingSchema.index({ status: 1, listingType: 1, createdAt: -1, _id: -1 });

// Catalog and unlinked indexes
ListingSchema.index({ storeId: 1, status: 1 });
ListingSchema.index({ sellerId: 1, status: 1 });
ListingSchema.index({ sellerId: 1, storeId: 1, status: 1 });
ListingSchema.index({ status: 1, title: "text", description: "text" });

// Unique partial indexes matching Next.js
ListingSchema.index(
    { slug: 1 },
    { unique: true, partialFilterExpression: { slug: { $type: "string" } } }
);
ListingSchema.index(
    { listingCode: 1 },
    { unique: true, partialFilterExpression: { listingCode: { $type: "string" } } }
);

// ============================================================
// SINGLE WRITER ENFORCEMENT: EXPRESS IS READ-ONLY ON LISTINGS
// Next.js owns all listing writes (creation, updates, deletes, moderation)
// ============================================================
export const LISTING_READ_ONLY_ERROR = "READ_ONLY_COLLECTION: Express backend is read-only on listings. Write operations are owned exclusively by Next.js.";

ListingSchema.pre("save", function () {
    throw new Error(LISTING_READ_ONLY_ERROR);
});

ListingSchema.pre("insertMany", function () {
    throw new Error(LISTING_READ_ONLY_ERROR);
});

const listingWriteQueryOps = [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "findByIdAndUpdate",
    "replaceOne",
    "findOneAndReplace",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
    "findByIdAndDelete",
];

listingWriteQueryOps.forEach((op) => {
    ListingSchema.pre(op, function () {
        throw new Error(LISTING_READ_ONLY_ERROR);
    });
});

const Listing = mongoose.models.Listing || model("Listing", ListingSchema);
export default Listing;
