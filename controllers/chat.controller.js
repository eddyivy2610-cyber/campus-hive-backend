import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import AdminLog from "../models/AdminLog.js";
import Listing from "../models/Listing.js";

// Fetch user's conversation list (Caller can only fetch their own conversations)
export const getUserConversations = async (req, res) => {
    try {
        const { userId } = req.params;
        const authenticatedUserId = String(req.user?._id || req.user?.id || "");

        // Enforce: Requested userId MUST equal authenticated caller's identity
        if (!authenticatedUserId || String(userId) !== authenticatedUserId) {
            return res.status(403).json({ message: "Forbidden: Cannot access another user's conversations" });
        }

        const { cursor, limit: limitParam } = req.query;
        const limit = Math.min(50, Math.max(1, parseInt(limitParam || "30", 10)));
        const convFilter = {
            participants: authenticatedUserId,
            status: "active",
        };

        if (cursor) {
            try {
                const raw = Buffer.from(cursor, "base64url").toString("utf-8");
                const [timeStr, idStr] = raw.split("::");
                const time = new Date(timeStr);
                if (isNaN(time.getTime()) || !mongoose.isValidObjectId(idStr)) {
                    return res.status(400).json({ message: "Invalid cursor parameter" });
                }
                const parsedId = new mongoose.Types.ObjectId(idStr);
                convFilter.$or = [
                    { "lastMessage.time": { $lt: time } },
                    { "lastMessage.time": time, _id: { $lt: parsedId } }
                ];
            } catch {
                return res.status(400).json({ message: "Invalid cursor parameter" });
            }
        }

        const conversations = await Conversation.find(convFilter)
            .populate("participants", "profile.displayName profile.avatar personalDetails.fullName email businessProfile.activeListingsCount businessProfile.soldItemsCount createdAt")
            .populate("listingId", "title price images status")
            .sort({ "lastMessage.time": -1, _id: -1 })
            .limit(limit);

        const nextCursor = conversations.length === limit
            ? Buffer.from(`${(conversations[conversations.length - 1].lastMessage?.time || new Date()).toISOString()}::${conversations[conversations.length - 1]._id}`).toString("base64url")
            : null;

        res.status(200).json({ success: true, data: conversations, nextCursor });
    } catch (error) {
        console.error("Get conversations error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

// Fetch messages for a specific conversation (Checks participant membership with keyset pagination)
export const getMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const authenticatedUserId = String(req.user?._id || req.user?.id || "");

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        // Enforce membership check: Non-members get 404 Not Found to prevent enumeration
        const isParticipant = (conversation.participants || []).some(
            (p) => String(p._id || p) === authenticatedUserId
        );
        if (!isParticipant) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        const { cursor, limit: limitParam } = req.query;
        const limit = Math.min(100, Math.max(1, parseInt(limitParam || "50", 10)));
        const messageFilter = { conversationId };

        if (cursor) {
            try {
                const raw = Buffer.from(cursor, "base64url").toString("utf-8");
                const [timeStr, idStr] = raw.split("::");
                const time = new Date(timeStr);
                if (isNaN(time.getTime()) || !mongoose.isValidObjectId(idStr)) {
                    return res.status(400).json({ message: "Invalid cursor parameter" });
                }
                const parsedId = new mongoose.Types.ObjectId(idStr);
                messageFilter.$or = [
                    { createdAt: { $lt: time } },
                    { createdAt: time, _id: { $lt: parsedId } }
                ];
            } catch {
                return res.status(400).json({ message: "Invalid cursor parameter" });
            }
        }

        const messages = await Message.find(messageFilter)
            .populate("senderId", "profile.displayName profile.avatar")
            .sort({ createdAt: -1, _id: -1 })
            .limit(limit);

        const nextCursor = messages.length === limit
            ? Buffer.from(`${messages[messages.length - 1].createdAt.toISOString()}::${messages[messages.length - 1]._id}`).toString("base64url")
            : null;

        res.status(200).json({ success: true, data: messages.reverse(), nextCursor });
    } catch (error) {
        console.error("Get messages error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

// Send a new message (Derives senderId from authenticated session, ignores body senderId, checks membership)
export const sendMessage = async (req, res) => {
    try {
        const { conversationId, text, type, listingId } = req.body;
        // Strictly derive senderId from authenticated user; ignore any body senderId
        const senderId = req.user?._id || req.user?.id;
        const authenticatedUserId = String(senderId || "");

        if (!conversationId || !text) {
            return res.status(400).json({ message: "conversationId and text are required" });
        }

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        // Enforce membership check: Only legitimate participants can post messages
        const isParticipant = (conversation.participants || []).some(
            (p) => String(p._id || p) === authenticatedUserId
        );
        if (!isParticipant) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        const newMessage = new Message({
            conversationId,
            senderId,
            text,
            type: type || "text",
            listingId: listingId || undefined
        });

        await newMessage.save();

        // Update the last message in the conversation
        await Conversation.findByIdAndUpdate(conversationId, {
            lastMessage: {
                text: type === "text" ? text : `Shared a ${type}`,
                senderId,
                time: Date.now()
            }
        });

        // Populate sender for return value
        await newMessage.populate("senderId", "profile.displayName profile.avatar");

        res.status(201).json({ success: true, data: newMessage });
    } catch (error) {
        console.error("Send message error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

// Find or create a conversation between two users (for "Message Seller" button)
export const getOrCreateConversation = async (req, res) => {
    try {
        const { otherUserId, listingId, initialMessage } = req.body;
        // Strictly derive authenticated user identity from session
        const userId = req.user?._id || req.user?.id;

        if (!userId || !otherUserId) {
            return res.status(400).json({ message: "otherUserId is required" });
        }

        // Check if a conversation already exists between these two users
        let conversation = await Conversation.findOne({
            participants: { $all: [userId, otherUserId] },
            ...(listingId ? { listingId } : {})
        });

        const isNew = !conversation;

        if (isNew) {
            let negotiation = { status: "none" };

            // If it's a listing inquiry, initialize negotiation tracking
            if (listingId) {
                const trackingRef = `TRK-${Math.floor(100000 + Math.random() * 900000)}-CH`;
                const listing = await Listing.findById(listingId);
                
                negotiation = {
                    trackingRef,
                    status: "active",
                    startedAt: new Date(),
                    agreedPrice: listing?.price || 0
                };

                // Create Admin Log for the new inquiry
                await AdminLog.create({
                    type: "listing",
                    message: `New Listing Inquiry [Ref: ${trackingRef}]`,
                    userId: userId,
                    metadata: {
                        trackingRef,
                        listingId,
                        listingTitle: listing?.title,
                        buyerId: userId,
                        sellerId: otherUserId,
                        initialMessage: initialMessage || "N/A"
                    }
                });
            }

            conversation = await Conversation.create({
                participants: [userId, otherUserId],
                listingId: listingId || undefined,
                negotiation
            });
        }

        await conversation.populate("participants", "profile.displayName profile.avatar personalDetails.fullName email");

        res.status(200).json({ success: true, data: conversation });
    } catch (error) {
        console.error("Get or create conversation error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

// Request to end a negotiation
export const endNegotiation = async (req, res) => {
    try {
        const { conversationId, action } = req.body; // action: 'request_close' or 'cancel'
        const authenticatedUserId = String(req.user?._id || req.user?.id || "");

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return res.status(404).json({ message: "Conversation not found" });

        const isParticipant = (conversation.participants || []).some(
            (p) => String(p._id || p) === authenticatedUserId
        );
        if (!isParticipant) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        if (action === "request_close") {
            conversation.negotiation.closeRequestedBy = authenticatedUserId;
            await conversation.save();
        }

        res.status(200).json({ success: true, data: conversation });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
};

// Finalize negotiation closure
export const confirmEndNegotiation = async (req, res) => {
    try {
        const { conversationId, status } = req.body; // status: 'completed' or 'ended'
        const authenticatedUserId = String(req.user?._id || req.user?.id || "");

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return res.status(404).json({ message: "Conversation not found" });

        const isParticipant = (conversation.participants || []).some(
            (p) => String(p._id || p) === authenticatedUserId
        );
        if (!isParticipant) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        conversation.negotiation.status = status;
        conversation.negotiation.endedAt = new Date();
        await conversation.save();

        // Log closure to Admin
        await AdminLog.create({
            type: "listing",
            message: `Order Session ${status.toUpperCase()} [Ref: ${conversation.negotiation.trackingRef}]`,
            userId: conversation.negotiation.closeRequestedBy,
            metadata: {
                trackingRef: conversation.negotiation.trackingRef,
                conversationId,
                status
            }
        });

        res.status(200).json({ success: true, data: conversation });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
};
