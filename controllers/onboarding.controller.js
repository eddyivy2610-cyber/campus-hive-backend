import User from "../models/User.js";
import AdminLog from "../models/AdminLog.js";
import Notification from "../models/Notification.js";
import { uploadToCloudinary } from "../utils/cloudinary.js";

/**
 * Update user onboarding choice (Buy vs Sell)
 */
export const updateOnboardingChoice = async (req, res) => {
    try {
        const { choice } = req.body; // 'buy' or 'sell'
        const userId = req.user.id;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        if (choice === "sell") {
            user.onboardingStep = "onboarding_choice";
            // They will move to the terms/ID upload next
        } else {
            user.onboardingStep = "completed";
        }

        await user.save();
        res.status(200).json({ success: true, onboardingStep: user.onboardingStep });
    } catch (error) {
        console.error("Onboarding choice error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * Submit Seller Application (ID Upload)
 */
export const applyAsSeller = async (req, res) => {
    try {
        const userId = req.user.id;
        if (!req.file) {
            return res.status(400).json({ message: "ID image is required" });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        // Upload ID to Cloudinary
        const result = await uploadToCloudinary(req.file.buffer, "campus-market/verification");

        user.sellerStatus = "pending";
        user.onboardingStep = "seller_pending";
        user.sellerApplication = {
            idImage: result.secure_url,
            appliedAt: new Date()
        };
        
        // Also update studentStatus for compatibility if needed
        user.studentStatus.idCardImage = result.secure_url;

        await user.save();

        // Create Admin Log for initial tracking
        await AdminLog.create({
            type: "verification_pending",
            message: `New seller application from ${user.email}`,
            userId: user._id,
            metadata: { 
                action: "seller_application_submitted",
                email: user.email 
            }
        });

        // Notify all admins
        const admins = await User.find({ role: "admin" });
        await Promise.all(admins.map(admin => 
            Notification.create({
                recipient: admin._id,
                sender: user._id,
                type: "verification_pending",
                title: "New Seller Application",
                message: `${user.profile.displayName || user.email} has submitted a seller verification request.`,
                link: "/admin/users/pending"
            })
        ));

        res.status(200).json({ 
            success: true, 
            message: "Application submitted successfully",
            onboardingStep: user.onboardingStep 
        });
    } catch (error) {
        console.error("Seller application error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * Finalize Seller Profile (After Approval)
 */
export const finalizeSellerProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { displayName, bio, category, description } = req.body;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        if (user.sellerStatus !== "approved") {
            return res.status(403).json({ message: "Seller application not yet approved" });
        }

        // Update profile
        if (displayName) user.profile.displayName = displayName;
        if (bio) user.profile.bio = bio;
        
        // Update business profile
        if (category) user.businessProfile.category = category;
        if (description) user.businessProfile.description = description;
        
        user.role = "seller"; // Officially promote to seller
        user.onboardingStep = "completed";

        await user.save();
        res.status(200).json({ success: true, user });
    } catch (error) {
        console.error("Finalize seller profile error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * Admin: Approve Seller
 */
export const adminApproveSeller = async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        user.sellerStatus = "approved";
        user.role = "seller";
        user.studentStatus.isVerified = true;
        user.onboardingStep = "completed";
        user.sellerApplication.approvedAt = new Date();
        
        await user.save();

        // Cleanup: Mark corresponding pending notifications as read for all admins
        await Notification.updateMany(
            { sender: userId, type: "verification_pending" },
            { read: true }
        );

        await AdminLog.create({
            type: "verification_approved",
            message: `Seller application approved for ${user.email}`,
            userId: user._id,
            metadata: { action: "seller_approved" }
        });

        // Notify User
        await Notification.create({
            recipient: user._id,
            type: "verification_approved",
            title: "Application Approved!",
            message: "Your seller application has been approved. You can now start listing your products on Campus Hive.",
            link: "/onboarding/seller/finalize"
        });

        res.status(200).json({ success: true, message: "Seller approved", user });
    } catch (error) {
        console.error("Admin approve error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * Admin: Reject Seller
 */
export const adminRejectSeller = async (req, res) => {
    try {
        const { userId } = req.params;
        const { reason } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        user.sellerStatus = "rejected";
        user.onboardingStep = "onboarding_choice"; // Let them try again
        user.sellerApplication.rejectedReason = reason || "Incomplete ID information";

        await user.save();

        // Cleanup: Mark corresponding pending notifications as read for all admins
        await Notification.updateMany(
            { sender: userId, type: "verification_pending" },
            { read: true }
        );

        await AdminLog.create({
            type: "verification_rejected",
            message: `Seller application rejected for ${user.email}`,
            userId: user._id,
            metadata: { action: "seller_rejected", reason }
        });

        // Notify User
        await Notification.create({
            recipient: user._id,
            type: "verification_rejected",
            title: "Application Rejected",
            message: `Your seller application was rejected. Reason: ${reason || "Incomplete ID information"}. Please try again with valid identification.`,
            link: "/onboarding/seller"
        });

        res.status(200).json({ success: true, message: "Seller rejected", user });
    } catch (error) {
        console.error("Admin reject error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
