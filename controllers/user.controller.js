import User from "../models/User.js";
import { getUserByIdService } from "../services/user.service.js";

// ============================================================
// READ-ONLY USER CONTROLLERS
// Express is read-only on users. Next.js owns all user writes.
// ============================================================

export const register = async (_req, res) => {
    return res.status(405).json({
        success: false,
        error: "METHOD_NOT_ALLOWED",
        message: "User registration is owned exclusively by Next.js API (/api/auth/register).",
    });
};

export const getUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await getUserByIdService(userId);
        
        if (!result.success) {
            return res.status(result.status).json({ message: result.message, error: result.error, stack: result.stack });
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

export const updateUser = async (_req, res) => {
    return res.status(405).json({
        success: false,
        error: "METHOD_NOT_ALLOWED",
        message: "User write operations are owned exclusively by Next.js API.",
    });
};

export const getAllUsers = async (req, res) => {
    try {
        const { 
            role, 
            sellerStatus, 
            accountStatus, 
            search, 
            page = 1, 
            limit = 50 
        } = req.query;

        const query = {};

        // Filters
        if (role) query.role = role;
        if (sellerStatus) query.sellerStatus = sellerStatus;
        if (accountStatus) query.accountStatus = accountStatus;

        // Search (Email or Name)
        if (search) {
            query.$or = [
                { email: { $regex: search, $options: "i" } },
                { "profile.displayName": { $regex: search, $options: "i" } },
                { "personalDetails.fullName": { $regex: search, $options: "i" } }
            ];
        }

        const users = await User.find(query)
            .select("-password -emailVerificationToken -passwordResetToken -twoFactorSecret")
            .sort({ createdAt: -1 })
            .limit(Number(limit))
            .skip((Number(page) - 1) * Number(limit));

        const total = await User.countDocuments(query);

        res.status(200).json({ 
            success: true,
            count: users.length,
            total,
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
