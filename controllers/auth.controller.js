import { doesEmailAndPhoneExists, loginUser, registerUser, sendOtpToEmailService, verifyEmailService, updateUserPassword, getProfileByHandleService } from "../services/auth.service.js";
import { generateToken } from "../utils/auth.js";

export const login = async (req, res) => {
    try {
        const user = await loginUser(req);
        const token = generateToken(user);
        res.status(200).json({ message: "Login success", user, token });
    } catch (error) {
        res.status(401).json({ message: error.message || "Invalid credentials" });
    }
}

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
}

export const verifyEmailAndOTP = async (req, res) => {
    const { email, otp } = req.body;
    try {
        const result = await verifyEmailService(email, otp);
        if (!result) {
            return res.status(401).json({ message: "Invalid or expired verification code" });
        }
        res.status(200).json({ 
            success: true,
            message: "Email verified successfully. Please complete your profile."
        });
    } catch (error) {
        console.log(error.message);
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
}

export const verifyPhone = (req, res) => {
    try {
        // Placeholder logic for phone verification
        res.status(200).json({ message: "Phone verification endpoint" });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
}

export const register = async (req, res) => {
    try {
        const user = await registerUser(req);
        if (user.status && user.status !== 200) {
            return res.status(user.status).json({ message: user.message });
        }
        res.status(200).json({ message: "User registration endpoint", data: user });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
}

export const checkEmailAndPhoneExists = async (req, res) => {
    try {
        const result = await doesEmailAndPhoneExists(req);
        res.status(200).json({ message: "Check email and phone existence endpoint", data: result });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
}

export const sendOtpToEmail = async (req, res) => {
    try {
        const hasSent = await sendOtpToEmailService(req);
        if (!hasSent) {
            return res.status(500).json({ message: "Failed to send OTP, something went wrong" });
        }
        res.status(200).json({ message: "OTP sent successfully" });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
}

export const updateToUserPassword = async (req, res) => {
    try {
        const result = await updateUserPassword(req);
        if (result.status && result.status !== 200) {
            return res.status(result.status).json({ message: result.message });
        }
        res.status(200).json({ message: "User password updated successfully" });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
}

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
}

export const googleLogin = async (req, res) => {
    try {
        const { email, name, avatar, providerId } = req.body;
        // This is a simplified OAuth flow. Real implementation should verify the Google ID token.
        const result = await registerUser({
            body: {
                email,
                provider: "google",
                providerId,
                profile: { displayName: name, avatar },
                role: "buyer", // Default role
                agreedToTerms: true
            }
        });

        let user;
        // If user already exists, it might fail with 409, so we log them in instead
        if (result.status === 409) {
            user = await loginUser({ body: { email, isOAuth: true } });
        } else {
            user = result.user;
        }

        const token = generateToken(user);
        res.status(200).json({ message: "Google login successful", user, token });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
}

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
}