import IdentityVerification from "../models/IdentityVerification.js";
import User from "../models/User.js";
import AdminLog from "../models/AdminLog.js";

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

        await AdminLog.create({
            type: "verification_pending",
            message: `Verification submitted for ${role}`,
            userId,
            metadata: { documentType }
        });

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
            .populate("userId", "email profile.displayName personalDetails studentStatus businessProfile")
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: pending });
    } catch (error) {
        console.error("Get pending verifications error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Get All Verifications (optional status filter)
export const getAllVerifications = async (req, res) => {
    try {
        const { status } = req.query;
        const query = status ? { status } : {};
        const results = await IdentityVerification.find(query)
            .populate("userId", "email profile.displayName personalDetails studentStatus businessProfile")
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: results });
    } catch (error) {
        console.error("Get all verifications error:", error);
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
                // If it was a student verification, ensure studentStatus is active
                if (verification.role === "student") {
                    user.studentStatus.isStudent = true;
                    user.studentStatus.isVerified = true;
                }
                await user.save();
            }

            await AdminLog.create({
                type: "verification_approved",
                message: `Verification approved for ${verification.role}`,
                userId: verification.userId,
                metadata: { verificationId: verification._id }
            });
            await AdminLog.create({
                type: "admin_action",
                message: `Admin approved ${verification.role} verification`,
                userId: verification.userId,
                metadata: { verificationId: verification._id, adminId }
            });
        } else if (status === "rejected") {
            await AdminLog.create({
                type: "verification_rejected",
                message: `Verification rejected for ${verification.role}`,
                userId: verification.userId,
                metadata: { verificationId: verification._id, rejectionReason }
            });
            await AdminLog.create({
                type: "admin_action",
                message: `Admin rejected ${verification.role} verification`,
                userId: verification.userId,
                metadata: { verificationId: verification._id, rejectionReason, adminId }
            });
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
