import mongoose, { Schema, model, Types } from "mongoose";

const OrderSchema = new Schema(
    {
        orderId: {
            type: String,
            required: true,
            unique: true
        },
        buyerId: {
            type: Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        sellerId: {
            type: Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        items: [{
            listingId: {
                type: Types.ObjectId,
                ref: "Listing",
                required: true
            },
            title: String,
            price: Number,
            image: String,
            quantity: {
                type: Number,
                default: 1
            }
        }],
        totalAmount: {
            type: Number,
            required: true
        },
        status: {
            type: String,
            enum: ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "disputed"],
            default: "pending",
            index: true
        },
        paymentStatus: {
            type: String,
            enum: ["unpaid", "pending", "paid", "refunded"],
            default: "unpaid"
        },
        paymentMethod: {
            type: String,
            enum: ["cash", "transfer", "card"],
            required: true
        },
        fulfillmentMethod: {
            type: String,
            enum: ["pickup", "delivery"],
            required: true
        },
        shippingAddress: {
            street: String,
            city: String,
            state: String,
            phone: String
        },
        notes: String,
        history: [{
            status: String,
            updatedBy: String,
            updatedAt: {
                type: Date,
                default: Date.now
            },
            comment: String
        }]
    },
    {
        timestamps: true
    }
);

const Order = mongoose.models.Order || model("Order", OrderSchema);
export default Order;
