import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

let io;
const userSockets = new Map(); // Map userId -> socketId

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

    // Authentication middleware for Socket.io
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error("Authentication error: No token provided"));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id).select("-password");
            
            if (!user) {
                return next(new Error("Authentication error: User not found"));
            }

            socket.user = user;
            next();
        } catch (error) {
            next(new Error("Authentication error: Invalid token"));
        }
    });

    io.on("connection", (socket) => {
        const userId = socket.user._id.toString();
        
        // Track user socket
        userSockets.set(userId, socket.id);
        
        // Join personal room for private messaging
        socket.join(userId);
        
        // Broadcast online status
        io.emit("user_online", { userId });

        socket.on("send_message", (data) => {
            // data should include { receiverId, message, conversationId }
            if (data.receiverId) {
                // Emit to receiver's room
                io.to(data.receiverId).emit("receive_message", {
                    ...data,
                    senderId: userId
                });
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
