import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";

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
        const { userId, otherUserId, listingId } = req.body;

        if (!userId || !otherUserId) {
            return res.status(400).json({ message: "userId and otherUserId are required" });
        }

        // Check if a conversation already exists between these two users
        let conversation = await Conversation.findOne({
            participants: { $all: [userId, otherUserId] },
            ...(listingId ? { listingId } : {})
        });

        if (!conversation) {
            conversation = await Conversation.create({
                participants: [userId, otherUserId],
                listingId: listingId || undefined
            });
        }

        await conversation.populate("participants", "profile.displayName profile.avatar personalDetails.fullName email");

        res.status(200).json({ success: true, data: conversation });
    } catch (error) {
        console.error("Get or create conversation error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};
