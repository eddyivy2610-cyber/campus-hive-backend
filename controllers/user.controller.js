import { registerUserService, getUserByIdService, updateUserService } from "../services/user.service.js";
import User from "../models/User.js";
import { generateToken } from "../utils/auth.js";

export const register = async (req, res) => {
    try {
        const result = await registerUserService(req);
        
        if (!result.success) {
            return res.status(result.status).json({ 
                message: result.message,
                ...(result.errors && { errors: result.errors }),
                ...(result.error && { error: result.error })
            });
        }
        
        const token = generateToken(result.data);
        res.status(201).json({ 
            message: result.message, 
            data: result.data,
            token
        });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ 
            message: "Internal Server Error", 
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
};

export const getUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await getUserByIdService(userId);
        
        if (!result.success) {
            return res.status(result.status).json({ message: result.message });
        }
        
        res.status(200).json({ 
            message: result.message, 
            data: result.data 
        });
    } catch (error) {
        console.error("Get user error:", error);
        res.status(500).json({ 
            message: "Internal Server Error",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
};

export const updateUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await updateUserService(userId, req.body, req.user?._id);
        
        if (!result.success) {
            return res.status(result.status).json({ message: result.message });
        }
        
        res.status(200).json({ 
            message: result.message, 
            data: result.data 
        });
    } catch (error) {
        console.error("Update user error:", error);
        res.status(500).json({ 
            message: "Internal Server Error",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
};

export const getAllUsers = async (req, res) => {
    try {
        const users = await User.find()
            .select("-password -emailVerificationToken -passwordResetToken -twoFactorSecret")
            .sort({ createdAt: -1 });
        
        res.status(200).json({ 
            success: true,
            count: users.length,
            data: users 
        });
    } catch (error) {
        console.error("Get all users error:", error);
        res.status(500).json({ 
            message: "Internal Server Error",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
};