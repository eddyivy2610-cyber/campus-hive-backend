import { doesEmailAndPhoneExists, loginUser, registerUser, sendOtpToEmailService, verifyEmailService, updateUserPassword } from "../services/auth.service.js";

export const login = (req, res) => {
    try {
        const user = loginUser(req);
        res.status(200).json({ message: "Login endpoint", user });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
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

export const verifyEmailAndCreateTempData = async (req, res) => {
    const { email, otp, userData } = req.body;
    try {
        const result = await verifyEmailService(email, otp );
        if (!result) {
            return res.status(401).json({ message: "Invalid or expired verification code" });
        }
        const user = await registerUser({ body: userData });
        if (user.status && user.status !== 200) {
            return res.status(user.status).json({ message: user.message });
        }

        res.status(200).json({ message: "Email verified successfully", tempUserId: user.savedUser });
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