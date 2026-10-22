import { doesEmailAndPhoneExists, loginUser, sendOtpToEmailService, verifyEmailService, getProfileByHandleService } from "../services/auth.service.js";
import { generateToken } from "../utils/auth.js";

export const login = async (req, res) => {
    try {
        const user = await loginUser(req);
        const token = generateToken(user);
        res.status(200).json({ message: "Login success", user, token });
    } catch (error) {
        res.status(401).json({ message: error.message || "Invalid credentials" });
    }
};

export const verifyEmail = (req, res) => {
    try {
        const result = verifyEmailService(req);
        if (!result) {
            return res.status(401).json({ message: "Invalid or expired verification code" });
        }
        res.status(200).json({ message: "Email verified successfully" });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
};

export const verifyEmailAndOTP = async (req, res) => {
    const { email, otp } = req.body;
    try {
        const result = await verifyEmailService(email, otp);
        if (result === true || (result && result.success)) {
            return res.status(200).json({ 
                success: true,
                message: "Email verified successfully. Please complete your profile."
            });
        }
        const status = result?.status || 401;
        const message = result?.message || "Invalid or expired verification code";
        return res.status(status).json({ success: false, message });
    } catch (error) {
        console.log(error.message);
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
};

export const verifyPhone = (req, res) => {
    try {
        // Placeholder logic for phone verification
        res.status(200).json({ message: "Phone verification endpoint" });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
};

export const register = async (_req, res) => {
    return res.status(405).json({
        success: false,
        error: "METHOD_NOT_ALLOWED",
        message: "User registration is owned exclusively by Next.js API (/api/auth/register).",
    });
};

export const checkEmailAndPhoneExists = async (req, res) => {
    try {
        const result = await doesEmailAndPhoneExists(req);
        res.status(200).json({ message: "Check email and phone existence endpoint", data: result });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
};

export const sendOtpToEmail = async (req, res) => {
    try {
        const clientIp =
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            req.socket?.remoteAddress ||
            req.ip ||
            "127.0.0.1";

        const result = await sendOtpToEmailService(req, clientIp);
        if (result && result.status && result.status !== 200) {
            return res.status(result.status).json({ success: false, message: result.message });
        }
        res.status(200).json({
            success: true,
            message: "If this email is eligible, a verification code has been dispatched.",
        });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
};

export const updateToUserPassword = async (_req, res) => {
    return res.status(405).json({
        success: false,
        error: "METHOD_NOT_ALLOWED",
        message: "Password updates are owned exclusively by Next.js API.",
    });
};

export const getProfileByHandle = async (req, res) => {
    try {
        const { handle } = req.params;
        const profile = await getProfileByHandleService(handle);
        if (!profile) {
            return res.status(404).json({ message: "Profile not found" });
        }
        res.status(200).json({ data: profile });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
};

export const googleLogin = async (_req, res) => {
    return res.status(405).json({
        success: false,
        error: "METHOD_NOT_ALLOWED",
        message: "OAuth user registration is owned exclusively by Next.js API.",
    });
};

/**
 * Refresh current user data and issue a fresh JWT
 */
export const refreshToken = async (req, res) => {
    try {
        // req.user is already populated by 'protect' middleware
        const user = await loginUser({ body: { email: req.user.email, isOAuth: true } });
        const token = generateToken(user);
        res.status(200).json({ message: "Token refreshed", user, token });
    } catch (error) {
        console.error("Refresh token error for user:", req.user ? req.user.email : "unknown");
        console.error(error.stack);
        res.status(500).json({ message: "Failed to refresh token", error: error.message });
    }
};
