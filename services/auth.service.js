import argon2 from "argon2";
import EmailVerification from "../models/EmailVerification.js";
import User from "../models/User.js";
import nodemailer from "nodemailer";
import { PROFILE_CATALOG } from "../data/searchCatalog.js";

export const loginUser = async (req) => {
    const { email, password, isOAuth } = req.body;
    
    if (!email || (!password && !isOAuth)) {
        throw new Error("Email and password are required");
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password");
    if (!user) {
        throw new Error("User not found");
    }

    if (!isOAuth) {
        const isMatch = await argon2.verify(user.password, password);
        if (!isMatch) {
            throw new Error("Invalid email or password");
        }
    }

    // Update last login
    if (user.updateLastLogin) {
        await user.updateLastLogin();
    }

    // Return the user object (toJSON transform will remove sensitive fields)
    return user;
}

export const verifyEmailService = async (email, otp) => {
    const record = await EmailVerification.findOne({ email, verificationCode: otp });
    if (!record) {
        return false;
    }
    if (record.expiresAt < new Date()) {
        return false;
    }
    record.verifiedAt = new Date();
    await record.save();
    return true;
}

export const verifyPhoneService = async (req) => {
    return true;
}

export const doesEmailAndPhoneExists = async (req) => {
    const { email, phone } = req.body;
    const emailExists = await User.findOne({ email });
    const phoneExists = await User.findOne({ phone });

    return { emailExists: !!emailExists, phoneExists: !!phoneExists };
}

export const registerUser = async (data) => {
    const { email, password, profile, address_info, phone, role } = data.body;

    try {
        if (!email || !password || !profile || !profile.displayName) {
            return { message: "Missing required fields (email, password, displayName)", status: 400 };
        }

        const emailExists = await User.findOne({ email: email.trim() });
        if (emailExists) {
            return { message: "Email already in use", status: 409 };
        }

        if (phone) {
            const phoneExists = await User.findOne({ phone: phone.trim() });
            if (phoneExists) {
                return { message: "Phone number already in use", status: 409 };
            }
        }

        const hashedPassword = await argon2.hash(password);

        const newUser = {
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            profile,
            address_info,
            phone: phone ? phone.trim() : undefined,
            isEmailVerified: true, // Auto-verify for now as per current flow
            role,
            agreedToTerms: true // Necessary for model validation
        };

        const savedUser = await User.create(newUser);
        
        // Optional: Create verification record anyway for future use
        const emailVerification = await EmailVerification.create({
            userId: savedUser._id,
            email: savedUser.email,
            verificationCode: Math.floor(1000 + Math.random() * 900000).toString(),
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        });

        return { savedUser: savedUser._id, user: savedUser, message: "User registered successfully", status: 200 };
    } catch (error) {
        console.error("Registration error:", error);
        return { message: error.message || "Internal Server Error", status: 500 };
    }
}

export const logoutUser = (req) => {
    return { message: "User logged out successfully" };
}

export const sendOtpToEmailService = async (req) => {
    const { email } = req.body;
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await EmailVerification.updateOne(
        { email },
        { verificationCode: otp, expiresAt },
        { upsert: true }
    );

    // use nodemailer
    const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: {
            user: "userunitapp@gmail.com",
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    // proper html email with nice UI and styling
    const htmlContent = `<div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2 style="color: #4CAF50;">Runit App - Email Verification</h2>
        <p>Dear User,</p>
        <p>Your verification code is:</p>
        <h1 style="color: #FF5722;">${otp}</h1>
        <p>This code will expire in 10 minutes.</p>
        <p>If you did not request this code, please ignore this email.</p>
        <br/>
        <p>Best regards,<br/>Runit App Team</p>
    </div>`;

    const mailOptions = {
        from: '"Runit App" <userunitapp@gmail.com>',
        to: email,
        subject: "Verify your email",
        html: htmlContent,
    };

    await transporter.sendMail(mailOptions);
    return true;
}

export const updateUserPassword = async (req) => {
    const { userId, password } = req.body;
    const user = await User.findById(userId);
    if (!user) {
        return { message: "User not found", status:404 };
    }

    const hashPassword = await argon2.hash(password);
    user.password = hashPassword;
    await user.save();
    return { message: "User password created successfully", status:200 };
}

export const getProfileByHandleService = async (handle) => {
    const squashedHandle = handle.toLowerCase().replace(/[^a-z0-9]/g, "");

    // 1. Precise Match on handle (New Schema)
    let user = await User.findOne({ "profile.handle": squashedHandle });
    if (user) return user;

    // 2. Fallback: Search by displayName squashed (Legacy Transition)
    const searchChars = squashedHandle.split('').join('\\s*');
    user = await User.findOne({ 
        "profile.displayName": { $regex: new RegExp(`^${searchChars}$`, "i") } 
    });
    if (user) return user;

    // 3. Last Resort Fallback: Match by MongoDB ID (if handle is an ID)
    if (handle.match(/^[0-9a-fA-F]{24}$/)) {
        user = await User.findById(handle);
        if (user) return user;
    }

    // 4. Final Fallback: Check mock catalog
    return PROFILE_CATALOG.find(p => p.handle === handle);
}
