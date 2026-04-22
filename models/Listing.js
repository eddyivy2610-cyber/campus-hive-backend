import mongoose, { Schema, model, Types } from "mongoose";

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
            trim: true,
            index: "text"
        },
        slug: {
            type: String,
            required: true,
            unique: true,
            lowercase: true
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
            required: true,
            index: true
        },
        condition: {
            type: String,
            enum: ["New", "Used - Like New", "Used - Good", "Used - Fair"],
            required: true
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
            enum: ["active", "sold", "paused", "pending", "rejected", "deleted"],
            default: "pending",
            index: true
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
            unique: true
        }
    },
    {
        timestamps: true
    }
);

const Listing = mongoose.models.Listing || model("Listing", ListingSchema);
export default Listing;
