import mongoose, { Schema, model, Types } from "mongoose";

const MessageSchema = new Schema(
    {
        conversationId: {
            type: Types.ObjectId,
            ref: "Conversation",
            required: true,
            index: true
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
        }
    },
    {
        timestamps: true
    }
);

const Message = mongoose.models.Message || model("Message", MessageSchema);
export default Message;
