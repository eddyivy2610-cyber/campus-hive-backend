import IdentityVerification from "../models/IdentityVerification.js";
import User from "../models/User.js";

// --- For Regular Users ---

// Submit Identity Verification Request
export const submitIdentityVerification = async (req, res) => {
    try {
        const { userId, role, documentType, frontImageUrl, backImageUrl, selfieImageUrl } = req.body;

        const newVerification = new IdentityVerification({
            userId,
            role,
            document: {
                type: documentType,
                frontImageUrl,
                backImageUrl,
                selfieImageUrl
            }
        });

        await newVerification.save();

        res.status(201).json({ 
            success: true, 
            message: "Verification request submitted successfully" 
        });
    } catch (error) {
        console.error("Submit verification error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// --- For Admin ---

// Get All Pending Verifications
export const getPendingVerifications = async (req, res) => {
    try {
        const pending = await IdentityVerification.find({ status: "pending" })
            .populate("userId", "email profile.displayName personalDetails")
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: pending });
    } catch (error) {
        console.error("Get pending verifications error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Review (Approve/Reject) Verification
export const reviewVerification = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, rejectionReason, adminId } = req.body;

        const verification = await IdentityVerification.findById(id);
        if (!verification) {
            return res.status(404).json({ message: "Verification request not found" });
        }

        verification.status = status;
        verification.review = {
            reviewedBy: adminId,
            reviewedAt: Date.now(),
            rejectionReason: status === "rejected" ? rejectionReason : undefined
        };

        await verification.save();

        // Update User Model if approved
        if (status === "approved") {
            const user = await User.findById(verification.userId);
            if (user) {
                user.isVerified = true;
                // If it was a student verification, ensure studentStatus is active
                if (verification.role === "student") {
                    user.studentStatus.isStudent = true;
                }
                await user.save();
            }
        }

        res.status(200).json({ 
            success: true, 
            message: `Verification ${status} successfully` 
        });
    } catch (error) {
        console.error("Review verification error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
