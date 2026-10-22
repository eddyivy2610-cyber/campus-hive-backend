import crypto from "crypto";
import argon2 from "argon2";
import EmailVerification from "../models/EmailVerification.js";
import User from "../models/User.js";
import nodemailer from "nodemailer";
import { PROFILE_CATALOG } from "../data/searchCatalog.js";
import { generateUniqueHandle } from "../utils/user.utils.js";
import Listing from "../models/Listing.js";
import { env } from "../utils/env.js";

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

    if (user.accountStatus === "pending" || (!user.emailVerified && !user.studentVerified)) {
        throw new Error("Please verify your email address before logging in.");
    }

    // Update last login
    if (user.updateLastLogin) {
        await user.updateLastLogin();
    }

    return user;
};

export const verifyPhoneService = async (req) => {
    return true;
};

export const doesEmailAndPhoneExists = async (req) => {
    const { email, phone } = req.body;
    const emailExists = await User.findOne({ email: email?.toLowerCase().trim() });
    const phoneExists = phone ? await User.findOne({ phone: phone?.trim() }) : false;

    return { emailExists: !!emailExists, phoneExists: !!phoneExists };
};

// In-memory sliding window rate limiter per IP for OTP dispatch
export const ipRequestHistory = new Map();
const IP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS_PER_IP = 10; // max 10 requests per 10 minutes per IP

export const checkIpRateLimit = (ip) => {
    if (!ip) return true;
    const now = Date.now();
    const timestamps = (ipRequestHistory.get(ip) || []).filter(t => now - t < IP_WINDOW_MS);
    if (timestamps.length >= MAX_REQUESTS_PER_IP) {
        ipRequestHistory.set(ip, timestamps);
        return false;
    }
    timestamps.push(now);
    ipRequestHistory.set(ip, timestamps);
    return true;
};

export const getOtpPepper = () => {
    return process.env.OTP_PEPPER || env.AUTH_SECRET || "campushive-default-otp-hmac-pepper-32-chars";
};

export const hashOtp = (email, otp) => {
    const pepper = getOtpPepper();
    return crypto
        .createHmac("sha256", pepper)
        .update(email.toLowerCase().trim() + ":" + String(otp).trim())
        .digest("hex");
};

export const verifyEmailService = async (email, otp) => {
    if (!email || !otp) {
        return { success: false, status: 400, message: "Email and verification code are required" };
    }
    const cleanEmail = email.toLowerCase().trim();

    // Atomic attempts reservation: Claim an attempt slot ONLY if attempts < 5
    const record = await EmailVerification.findOneAndUpdate(
        { email: cleanEmail, attempts: { $lt: 5 } },
        { $inc: { attempts: 1 } },
        { returnDocument: "after" }
    );

    if (!record) {
        const existing = await EmailVerification.findOne({ email: cleanEmail });
        if (existing && existing.attempts >= 5) {
            return {
                success: false,
                status: 429,
                message: "Too many failed attempts. This code is locked. Please request a new code.",
            };
        }
        return { success: false, status: 401, message: "Invalid or expired verification code" };
    }

    // Expiry check (10-minute validity)
    if (record.expiresAt < new Date()) {
        return { success: false, status: 401, message: "Verification code has expired. Please request a new one." };
    }

    const providedHash = hashOtp(cleanEmail, otp);
    const expectedHash = record.verificationCode;

    const isMatch =
        typeof expectedHash === "string" &&
        providedHash.length === expectedHash.length &&
        crypto.timingSafeEqual(Buffer.from(providedHash), Buffer.from(expectedHash));

    if (!isMatch) {
        if (record.attempts >= 5) {
            return {
                success: false,
                status: 429,
                message: "Too many failed attempts. This code is locked. Please request a new code.",
            };
        }
        return { success: false, status: 401, message: "Invalid verification code" };
    }

    // Single-use: Delete verification record immediately upon successful verification
    await EmailVerification.deleteOne({ _id: record._id });
    return { success: true, status: 200, message: "Email verified successfully" };
};

export const registerUser = async (data) => {
    const { email, password, fullName, phone } = data.body;

    try {
        if (!email || !password || !fullName) {
            return { message: "Missing required fields (email, password, fullName)", status: 400 };
        }

        const emailExists = await User.findOne({ email: email.toLowerCase().trim() });
        if (emailExists) {
            return { message: "Email already in use", status: 409 };
        }

        const hashedPassword = await argon2.hash(password);
        const handle = await generateUniqueHandle(fullName, email);

        const newUser = {
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            profile: {
                handle,
                displayName: fullName,
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${handle}` // Friendly default avatar
            },
            personalDetails: {
                fullName
            },
            phone: phone ? phone.trim() : undefined,
            emailVerified: true,
            role: "buyer",
            onboardingStep: "profile_completed",
            agreedToTerms: true 
        };

        const savedUser = await User.create(newUser);
        
        return { 
            savedUser: savedUser._id, 
            user: savedUser, 
            message: "User registered successfully", 
            status: 200 
        };
    } catch (error) {
        console.error("Registration error:", error);
        return { message: error.message || "Internal Server Error", status: 500 };
    }
};

export const logoutUser = (req) => {
    return { message: "User logged out successfully" };
};

export const sendOtpToEmailService = async (req, clientIp) => {
    const email = typeof req === "string" ? req : req?.body?.email || req?.email;
    if (!email) {
        throw new Error("Email is required to send verification code");
    }

    const ip = clientIp || req?.ip || req?.headers?.["x-forwarded-for"] || "127.0.0.1";
    if (!checkIpRateLimit(ip)) {
        return {
            status: 429,
            message: "Too many verification requests from this network. Please try again later.",
        };
    }

    const cleanEmail = email.toLowerCase().trim();

    // Rate limit: Enforce 60-second cooldown between OTP dispatches
    const existing = await EmailVerification.findOne({ email: cleanEmail });
    if (existing && existing.lastSentAt && (Date.now() - existing.lastSentAt.getTime() < 60000)) {
        const remainingSeconds = Math.ceil((60000 - (Date.now() - existing.lastSentAt.getTime())) / 1000);
        return {
            status: 429,
            message: `Please wait ${remainingSeconds} seconds before requesting another verification code.`,
        };
    }

    // Generate cryptographically secure standard 6-digit verification code via crypto.randomInt
    const otp = crypto.randomInt(100000, 1000000).toString();
    const hashedOtp = hashOtp(cleanEmail, otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const now = new Date();

    await EmailVerification.updateOne(
        { email: cleanEmail },
        {
            $set: {
                verificationCode: hashedOtp,
                expiresAt,
                lastSentAt: now,
                attempts: 0,
            },
        },
        { upsert: true }
    );

    // Read validated SMTP credentials strictly from environment variables
    const smtpUser = env.SMTP_USER;
    const smtpPass = env.SMTP_PASSWORD;
    const smtpHost = env.SMTP_HOST;
    const smtpPort = env.SMTP_PORT;

    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
    });

    const htmlContent = `<div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2 style="color: #4CAF50;">Campus Hive - Email Verification</h2>
        <p>Dear User,</p>
        <p>Your verification code is:</p>
        <h1 style="color: #FF5722;">${otp}</h1>
        <p>This code will expire in 10 minutes.</p>
        <p>Use this to complete your registration.</p>
        <br/>
        <p>Best regards,<br/>Campus Hive Team</p>
    </div>`;

    const mailOptions = {
        from: `"Campus Hive" <${smtpUser}>`,
        to: cleanEmail,
        subject: "Verify your email",
        html: htmlContent,
    };

    await transporter.sendMail(mailOptions);
    return true;
};

export const updateUserPassword = async (req) => {
    const { userId, password } = req.body;
    const user = await User.findById(userId);
    if (!user) {
        return { message: "User not found", status: 404 };
    }

    const hashPassword = await argon2.hash(password);
    user.password = hashPassword;
    await user.save();
    return { message: "User password created successfully", status: 200 };
};

export const getProfileByHandleService = async (handle) => {
    const squashedHandle = handle.toLowerCase().replace(/[^a-z0-9]/g, "");
    let user = await User.findOne({ "profile.handle": squashedHandle });
    
    if (!user) {
        const searchChars = squashedHandle.split('').join('\\s*');
        user = await User.findOne({ 
            "profile.displayName": { $regex: new RegExp(`^${searchChars}$`, "i") } 
        });
    }

    if (!user && handle.match(/^[0-9a-fA-F]{24}$/)) {
        user = await User.findById(handle);
    }

    if (!user) {
        return PROFILE_CATALOG.find(p => p.handle === handle);
    }

    // Convert to plain object to modify
    const userObj = user.toObject();

    // Dynamically fetch active listings count
    const activeListingsCount = await Listing.countDocuments({ 
        sellerId: user._id, 
        status: "active" 
    });

    // Merge into businessProfile
    userObj.businessProfile = {
        ...userObj.businessProfile,
        activeListingsCount
    };

    return userObj;
};
