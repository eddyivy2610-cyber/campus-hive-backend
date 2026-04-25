import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import AdminLog from "../models/AdminLog.js";
import Listing from "../models/Listing.js";

// Fetch user's conversation list
export const getUserConversations = async (req, res) => {
    try {
        const { userId } = req.params;
        const conversations = await Conversation.find({ participants: userId })
            .populate("participants", "profile.displayName profile.avatar personalDetails.fullName email businessProfile.activeListingsCount businessProfile.soldItemsCount createdAt")
            .populate("listingId", "title price images status")
            .sort({ updatedAt: -1 });

        res.status(200).json({ success: true, data: conversations });
    } catch (error) {
        console.error("Get conversations error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

// Fetch messages for a specific conversation
export const getMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const messages = await Message.find({ conversationId })
            .populate("senderId", "profile.displayName profile.avatar")
            .sort({ createdAt: 1 });

        res.status(200).json({ success: true, data: messages });
    } catch (error) {
        console.error("Get messages error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

// Send a new message
export const sendMessage = async (req, res) => {
    try {
        const { conversationId, senderId, text, type, listingId } = req.body;

        if (!conversationId || !senderId || !text) {
            return res.status(400).json({ message: "conversationId, senderId, and text are required" });
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
        const { userId, otherUserId, listingId, initialMessage } = req.body;

        if (!userId || !otherUserId) {
            return res.status(400).json({ message: "userId and otherUserId are required" });
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
        const { conversationId, userId, action } = req.body; // action: 'request_close' or 'cancel'

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return res.status(404).json({ message: "Conversation not found" });

        if (action === "request_close") {
            // Update status to pending closure or similar if needed, 
            // for now we'll just send a system message via socket/frontend
            // but we can track who requested it
            conversation.negotiation.closeRequestedBy = userId;
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

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return res.status(404).json({ message: "Conversation not found" });

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
