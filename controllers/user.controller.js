import { registerUserService, getUserByIdService, updateUserService } from "../services/user.service.js";

export const register = async (req, res) => {
    try {
        const result = await registerUserService(req);
        
        if (!result.success) {
            return res.status(result.status).json({ 
                message: result.message,
                ...(result.errors && { errors: result.errors })
            });
        }
        
        res.status(201).json({ 
            message: result.message, 
            data: result.data 
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