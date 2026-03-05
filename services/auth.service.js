import EmailVerification from "../models/EmailVerification.js";
import User from "../models/User.js";
import nodemailer from "nodemailer";
import bcrypt from "bcrypt";

const SALT_ROUNDS = 10;

export const loginUser = (req) => {
    return { id: "u637r3t7y7", username: "alimam", message:"This is a generic user" };
}

export const verifyEmailService = async (email, otp) => {
    console.log(email, otp);
    // const { email, otp } = data;
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
    // Placeholder logic for phone verification
    return true;
}

export const doesEmailAndPhoneExists = async (req) => {
    const { email, phone } = req.body;
    const emailExists = await User.findOne({ email });
    const phoneExists = await User.findOne({ phone });

    return { emailExists: !!emailExists, phoneExists: !!phoneExists };
}

export const registerUser = async (data) => {

    const { email, profile, address_info, phone, role } = data.body;

    const newUser = { 
        email:email.trim(), 
        profile, 
        address_info, 
        phone:phone.trim(), 
        isEmailVerified: true,
        role
    };

    try {
        newUser.profile.firstName = newUser.profile.firstName.trim();
        newUser.profile.lastName = newUser.profile.lastName.trim();
    
        
        if (!email || !profile || !profile.firstName || !profile.lastName) {
            return { message: "Missing required fields", status:400 };
        }

        const emailExists = await User.findOne({ email:email.trim() });
        if (emailExists) {
            return { message: "Email already in use", status:409 };
        }

        const phoneExists = await User.findOne({ phone:phone.trim() });
        if (phoneExists) {
            return { message: "Phone number already in use", status:409 };
        }

        const savedUser = await User.create(newUser);
        const emailVerification = await EmailVerification.create({
            userId: savedUser._id,
            email: savedUser.email,
            verificationCode: Math.floor(1000 + Math.random() * 900000).toString(),
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        });
        await emailVerification.save();
        await savedUser.save();
        return { savedUser: savedUser._id, message:"User registered successfully", status:200 };
    } catch (error) {
        return { message: "Internal Server Error", status:500 };
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

    const hashPassword = await bcrypt.hash(password, SALT_ROUNDS);
    user.password = hashPassword;
    await user.save();
    return { message: "User password created successfully", status:200 };
}
