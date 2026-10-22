import mongoose, { Schema, model, Types } from "mongoose";

const ConversationSchema = new Schema(
    {
        participants: [{
            type: Types.ObjectId,
            ref: "User",
            required: true
        }],
        participantIds: [{
            type: String,
            index: true
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
            trackingRef: {
                type: String,
                unique: true,
                sparse: true
            },
            status: {
                type: String,
                enum: ["active", "completed", "ended", "none"],
                default: "none"
            },
            agreedPrice: Number,
            startedAt: Date,
            endedAt: Date
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

export function extractParticipantId(p) {
    if (!p) return "";
    if (typeof p === "string") return p;
    if (typeof p.toHexString === "function") return p.toHexString();
    if (p._id) {
        if (typeof p._id.toHexString === "function") return p._id.toHexString();
        return String(p._id);
    }
    if (typeof p.id === "string") return p.id;
    if (typeof p.toString === "function" && p.toString() !== "[object Object]") return p.toString();
    return String(p);
}

// Synchronize participantIds from participants array for dual-ecosystem query compatibility
ConversationSchema.pre("validate", function (next) {
    if (this.participants && Array.isArray(this.participants)) {
        this.participantIds = this.participants.map(extractParticipantId).filter(Boolean);
    }
    if (typeof next === "function") next();
});

// Enforce required validators and synchronize participantIds on all update operations
ConversationSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate"], function () {
    this.setOptions({ runValidators: true });
    const update = this.getUpdate();
    if (update) {
        const parts = update.participants || update.$set?.participants;
        if (parts && Array.isArray(parts)) {
            const pIds = parts.map(extractParticipantId).filter(Boolean);
            if (update.$set) {
                update.$set.participantIds = pIds;
            } else {
                update.participantIds = pIds;
            }
        }
    }
});

// Index to quickly find a conversation between two users for a specific listing
ConversationSchema.index({ participants: 1, listingId: 1 }, { unique: false });

// ESR compound multikey index for user inbox list sorted by latest message time with _id tie-breaker
ConversationSchema.index({ participants: 1, status: 1, "lastMessage.time": -1, _id: -1 });

// ESR compound index for user inbox list sorted by updatedAt with _id tie-breaker
ConversationSchema.index({ participantIds: 1, status: 1, updatedAt: -1, _id: -1 });

const Conversation = mongoose.models.Conversation || model("Conversation", ConversationSchema);
export default Conversation;
