import User from "../models/User.js";
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
 * Set Display Name and other business info
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
 * SIMULATION ONLY: Admin Approve Seller
 */
export const adminApproveSeller = async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        user.sellerStatus = "approved";
        user.sellerApplication.approvedAt = new Date();
        
        // In a real app, this would trigger a notification
        await user.save();
        res.status(200).json({ success: true, message: "Seller approved", user });
    } catch (error) {
        console.error("Admin approve error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * SIMULATION ONLY: Admin Reject Seller
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
        res.status(200).json({ success: true, message: "Seller rejected", user });
    } catch (error) {
        console.error("Admin reject error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
