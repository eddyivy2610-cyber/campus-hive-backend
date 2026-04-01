import mongoose, { Schema, model, Types } from "mongoose";

const ConversationSchema = new Schema(
    {
        participants: [{
            type: Types.ObjectId,
            ref: "User",
            required: true
        }],
        listingId: {
            type: Types.ObjectId,
            ref: "Listing",
            index: true
        },
        lastMessage: {
            text: String,
            senderId: {
                type: Types.ObjectId,
                ref: "User"
            },
            time: {
                type: Date,
                default: Date.now
            }
        },
        unreadCount: {
            type: Map,
            of: Number,
            default: {}
        },
        status: {
            type: String,
            enum: ["active", "archived", "deleted"],
            default: "active"
        },
        negotiation: {
            id: String,
            status: {
                type: String,
                enum: ["active", "completed", "ended", "none"],
                default: "none"
            },
            agreedPrice: Number,
            startedAt: Date,
            endedAt: Date
        }
    },
    {
        timestamps: true
    }
);

// Index to quickly find a conversation between two users for a specific listing
ConversationSchema.index({ participants: 1, listingId: 1 }, { unique: false });

const Conversation = mongoose.models.Conversation || model("Conversation", ConversationSchema);
export default Conversation;
