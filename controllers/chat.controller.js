import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";

// Fetch user's conversation list
export const getUserConversations = async (req, res) => {
    try {
        const { userId } = req.params;
        const conversations = await Conversation.find({ participants: userId })
            .populate("participants", "profile.displayName profile.avatar")
            .populate("listingId", "title price image")
            .sort({ updatedAt: -1 });

        res.status(200).json({ success: true, data: conversations });
    } catch (error) {
        console.error("Get conversations error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Fetch messages for a specific conversation
export const getMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const messages = await Message.find({ conversationId })
            .sort({ createdAt: 1 });

        res.status(200).json({ success: true, data: messages });
    } catch (error) {
        console.error("Get messages error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Send a new message
export const sendMessage = async (req, res) => {
    try {
        const { conversationId, senderId, text, type, listingId } = req.body;

        const newMessage = new Message({
            conversationId,
            senderId,
            text,
            type,
            listingId
        });

        await newMessage.save();

        // Update the last message in the conversation
        await Conversation.findByIdAndUpdate(conversationId, {
            lastMessage: {
                text: type === "text" ? text : `Shared a ${type}`,
                senderId,
                time: Date.now()
            },
            $inc: { [`unreadCount.${senderId}`]: 0 } // In a real app, you'd increment for the *other* participant
        });

        res.status(201).json({ success: true, data: newMessage });
    } catch (error) {
        console.error("Send message error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
