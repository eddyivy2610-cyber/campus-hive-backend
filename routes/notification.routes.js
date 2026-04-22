import { Router } from "express";
import Notification from "../models/Notification.js";
import { unifiedAuth } from "../utils/auth.js";

const router = Router();

/**
 * Get all notifications for current user
 */
router.get("/", unifiedAuth, async (req, res) => {
    try {
        const notifications = await Notification.find({ recipient: req.user._id })
            .sort({ createdAt: -1 })
            .limit(50);
        
        const unreadCount = await Notification.countDocuments({ 
            recipient: req.user._id, 
            read: false 
        });

        res.status(200).json({ 
            success: true, 
            data: notifications,
            unreadCount
        });
    } catch (error) {
        console.error("Fetch notifications error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

/**
 * Mark all as read
 */
router.patch("/read-all", unifiedAuth, async (req, res) => {
    try {
        await Notification.updateMany(
            { recipient: req.user._id, read: false },
            { $set: { read: true } }
        );
        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Mark read error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

/**
 * Mark single as read
 */
router.patch("/:id/read", unifiedAuth, async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, recipient: req.user._id },
            { $set: { read: true } },
            { new: true }
        );
        res.status(200).json({ success: true, data: notification });
    } catch (error) {
        console.error("Mark single read error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

export default router;
