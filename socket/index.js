import { Server } from "socket.io";
import mongoose from "mongoose";
import User from "../models/User.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import { verifyAuthClaims } from "../utils/auth.js";

let io;
const userSockets = new Map(); // Map userId -> socketId

// Per-socket message rate limiting defaults: 10 messages per 5 seconds
export const SOCKET_MESSAGE_LIMIT = Number(process.env.SOCKET_RATE_LIMIT_MAX) || 10;
export const SOCKET_MESSAGE_WINDOW_MS = Number(process.env.SOCKET_RATE_LIMIT_WINDOW_MS) || 5000;

/**
 * Checks per-socket rate limiting using an in-memory sliding timestamp window
 * attached to the socket connection. Automatically cleaned up when the socket disconnects.
 */
export function checkSocketMessageRateLimit(
    socket,
    maxMessages = SOCKET_MESSAGE_LIMIT,
    windowMs = SOCKET_MESSAGE_WINDOW_MS
) {
    const now = Date.now();
    if (!socket._messageTimestamps) {
        socket._messageTimestamps = [];
    }

    // Purge timestamps outside the sliding window
    socket._messageTimestamps = socket._messageTimestamps.filter(
        (ts) => now - ts < windowMs
    );

    if (socket._messageTimestamps.length >= maxMessages) {
        const oldestTimestamp = socket._messageTimestamps[0];
        const retryAfterMs = Math.max(0, windowMs - (now - oldestTimestamp));
        const retryAfter = Math.ceil(retryAfterMs / 1000);
        return {
            allowed: false,
            retryAfter,
            error: "Rate limit exceeded: Too many messages sent. Please slow down.",
        };
    }

    socket._messageTimestamps.push(now);
    return { allowed: true };
}

export const initSocket = (httpServer, allowedOrigins) => {
    io = new Server(httpServer, {
        cors: {
            origin: (origin, callback) => {
                if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
                    callback(null, true);
                } else {
                    callback(new Error('Not allowed by CORS'));
                }
            },
            methods: ["GET", "POST"]
        }
    });

    // Authentication middleware for Socket.io: Verifies token itself on handshake
    io.use(async (socket, next) => {
        try {
            let token = socket.handshake.auth?.token;
            if (!token && socket.handshake.headers?.authorization) {
                const authHeader = socket.handshake.headers.authorization;
                if (authHeader.startsWith("Bearer ") || authHeader.startsWith("bearer ")) {
                    token = authHeader.substring(7).trim();
                } else {
                    token = authHeader.trim();
                }
            }
            if (!token && socket.handshake.query?.token) {
                token = socket.handshake.query.token;
            }

            if (!token) {
                return next(new Error("Authentication error: No token provided"));
            }

            // Cryptographically verify token claims: signature, alg, iss, aud, exp, and tokenType
            const decoded = verifyAuthClaims(token);
            const userId = decoded.sub;

            if (!userId) {
                return next(new Error("Authentication error: Invalid token claims"));
            }

            const user = await User.findById(userId).select("-password");
            
            if (!user) {
                return next(new Error("Authentication error: User not found"));
            }

            if (user.accountStatus && user.accountStatus !== "active") {
                return next(new Error(`Authentication error: Account is ${user.accountStatus}`));
            }

            socket.user = user;
            socket.userId = String(user._id);
            next();
        } catch (error) {
            console.error("Socket authentication error:", error.message);
            next(new Error(`Authentication error: ${error.message}`));
        }
    });

    io.on("connection", (socket) => {
        const userId = socket.user._id.toString();
        const userRoom = `user:${userId}`;
        
        // Track user socket
        userSockets.set(userId, socket.id);
        
        // Server-side room joining: automatically join user:<id> room and legacy <id> room
        socket.join(userRoom);
        socket.join(userId);
        
        // Broadcast online status
        io.emit("user_online", { userId });

        socket.on("send_message", async (data, ack) => {
            // Per-socket message rate limit check
            const rateLimit = checkSocketMessageRateLimit(socket);
            if (!rateLimit.allowed) {
                socket._rateLimitViolations = (socket._rateLimitViolations || 0) + 1;
                socket.emit("rate_limit_exceeded", {
                    error: rateLimit.error,
                    retryAfter: rateLimit.retryAfter,
                });
                socket.emit("error", rateLimit.error);

                if (typeof ack === "function") {
                    ack({
                        error: rateLimit.error,
                        retryAfter: rateLimit.retryAfter,
                    });
                }

                // If socket continues flooding excessively (> 50 attempts past limit), forcibly disconnect
                if (socket._rateLimitViolations > 50) {
                    console.warn(`[Socket] Disconnecting abusive socket ${socket.id} for excessive message flooding.`);
                    socket.disconnect(true);
                }
                return;
            }

            if (!data || !data.conversationId) {
                if (typeof ack === "function") ack({ error: "conversationId is required" });
                return;
            }

            const text = data.text || data.message;
            if (!text || typeof text !== "string" || !text.trim()) {
                if (typeof ack === "function") ack({ error: "Message text is required" });
                return;
            }

            try {
                if (!mongoose.isValidObjectId(data.conversationId)) {
                    if (typeof ack === "function") ack({ error: "Invalid conversationId" });
                    return;
                }

                // 1. Verify conversation existence and participant membership
                const conv = await Conversation.findById(data.conversationId);
                if (!conv) {
                    if (typeof ack === "function") ack({ error: "Conversation not found" });
                    return;
                }

                const participantStrings = (conv.participants || []).map((p) => p.toString());
                if (!participantStrings.includes(userId)) {
                    if (typeof ack === "function") {
                        ack({ error: "Forbidden: Sender is not a conversation participant" });
                    }
                    return;
                }

                // 2. Take recipient directly from the conversation (ignoring untrusted client data)
                const recipients = (conv.participants || []).filter((p) => p.toString() !== userId);
                if (recipients.length === 0) {
                    if (typeof ack === "function") ack({ error: "No recipient found in conversation" });
                    return;
                }
                const primaryRecipientId = recipients[0].toString();

                const cleanText = text.trim();
                const messageType = data.type || "text";

                // 3. Persist message first in MongoDB
                const newMessage = new Message({
                    conversationId: conv._id,
                    senderId: socket.user._id,
                    text: cleanText,
                    type: messageType,
                    listingId: data.listingId || conv.listingId || undefined,
                });
                await newMessage.save();

                // Update conversation's lastMessage metadata
                conv.lastMessage = {
                    text: messageType === "text" ? cleanText : `Shared a ${messageType}`,
                    senderId: socket.user._id,
                    time: new Date(),
                };
                await conv.save();

                const messagePayload = {
                    _id: newMessage._id.toString(),
                    id: newMessage._id.toString(),
                    conversationId: conv._id.toString(),
                    senderId: userId,
                    receiverId: primaryRecipientId,
                    text: cleanText,
                    message: cleanText,
                    type: messageType,
                    createdAt: newMessage.createdAt,
                };

                // 4. Then emit to the recipient's server-side user:<id> room and legacy <id> room
                for (const rec of recipients) {
                    const recId = rec.toString();
                    io.to(`user:${recId}`).to(recId).emit("receive_message", messagePayload);
                }

                // 5. Respond with ack callback confirming persistence and delivery
                if (typeof ack === "function") {
                    ack({ success: true, data: messagePayload });
                }
            } catch (err) {
                console.error("Socket send_message error:", err.message);
                if (typeof ack === "function") ack({ error: "Failed to send message: " + err.message });
            }
        });

        // Negotiation Events
        socket.on("negotiation_event", async (data, ack) => {
            const rateLimit = checkSocketMessageRateLimit(socket, 15, 5000);
            if (!rateLimit.allowed) {
                socket._rateLimitViolations = (socket._rateLimitViolations || 0) + 1;
                socket.emit("rate_limit_exceeded", {
                    error: rateLimit.error,
                    retryAfter: rateLimit.retryAfter,
                });
                socket.emit("error", rateLimit.error);

                if (typeof ack === "function") {
                    ack({
                        error: rateLimit.error,
                        retryAfter: rateLimit.retryAfter,
                    });
                }
                return;
            }

            if (!data || !data.conversationId) {
                if (typeof ack === "function") ack({ error: "conversationId is required" });
                return;
            }

            try {
                if (!mongoose.isValidObjectId(data.conversationId)) {
                    if (typeof ack === "function") ack({ error: "Invalid conversationId" });
                    return;
                }

                const conv = await Conversation.findById(data.conversationId).select("participants").lean();
                if (!conv) {
                    if (typeof ack === "function") ack({ error: "Conversation not found" });
                    return;
                }

                const participantStrings = (conv.participants || []).map((p) => p.toString());
                if (!participantStrings.includes(userId)) {
                    if (typeof ack === "function") {
                        ack({ error: "Forbidden: Sender is not a conversation participant" });
                    }
                    return;
                }

                // Take recipient(s) directly from the conversation
                const recipients = (conv.participants || []).filter((p) => p.toString() !== userId);
                const primaryRecipientId = recipients[0]?.toString();

                for (const rec of recipients) {
                    const recId = rec.toString();
                    io.to(`user:${recId}`).to(recId).emit("negotiation_update", {
                        ...data,
                        senderId: userId,
                        receiverId: primaryRecipientId || recId,
                    });
                }

                if (typeof ack === "function") ack({ success: true });
            } catch (err) {
                console.error("Socket negotiation_event authorization check failed:", err.message);
                if (typeof ack === "function") ack({ error: "Failed to send negotiation event" });
            }
        });

        socket.on("disconnect", () => {
            userSockets.delete(userId);
            io.emit("user_offline", { userId });
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error("Socket.io not initialized!");
    }
    return io;
};
