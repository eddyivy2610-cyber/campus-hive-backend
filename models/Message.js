import mongoose, { Schema, model, Types } from "mongoose";

const MessageSchema = new Schema(
    {
        conversationId: {
            type: Types.ObjectId,
            ref: "Conversation",
            required: true
        },
        senderId: {
            type: Types.ObjectId,
            ref: "User",
            required: true
        },
        type: {
            type: String,
            enum: ["text", "listing-card", "system", "image"],
            default: "text"
        },
        text: String,
        listingId: {
            type: Types.ObjectId,
            ref: "Listing"
        },
        imageUrl: String,
        read: {
            type: Boolean,
            default: false
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
        strict: true
    }
);

// Enforce required validators on all update operations
MessageSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate"], function () {
    this.setOptions({ runValidators: true });
});

// Single compound index serving both forward and reverse keyset pagination with tie-breaker
MessageSchema.index({ conversationId: 1, createdAt: 1, _id: 1 });

const Message = mongoose.models.Message || model("Message", MessageSchema);
export default Message;
