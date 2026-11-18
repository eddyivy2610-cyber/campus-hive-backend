import { Request, Response } from "express";
import prisma from "../prisma.ts";
import { generateNumericOtp } from "../lib/generate.ts";
import { hashOtp, verifyOtp } from "../lib/otp.ts";
import { sendOtpEmailService } from "../services/email.service.ts";
import { generateVerificationToken } from "../services/verification.service.ts";
import { isOlderThanMinutes } from "../lib/date.ts";

export async function requestNewVerificationTokenCode(req: Request, res: Response): Promise<void> {
    try {
        const {token} = req.params;

        if (!token) {
        res.status(400).json({ message: "Invalid token", error:"bad token" });
        return;
        }
        const verificationToken = await prisma.verificationToken.findUnique({
            where:{
                token:token as string
            },
            include:{
                user:true
            }
        })
        if (!verificationToken) {
            res.status(403).json({ message: "Invalid verification token", error:"bad token" });
            return;
        }
        const now = new Date();

        const rawDate = verificationToken.otpHashUpdatedAt || (verificationToken as any).otphashupdatedat;
        const validDate = (rawDate instanceof Date && !isNaN(rawDate.getTime())) ? rawDate : new Date(0);
        const isElligibleToRenew = isOlderThanMinutes(validDate, 1, now);
        if (!isElligibleToRenew) {
            res.status(429).json({ message: "Please wait a minute before requesting a new code", error:"cooldown_active" });
            return;
        }


        const otp = generateNumericOtp(6); // Generate a 6-digit numeric OTP
        const otpHash = hashOtp(otp); // HMAC-SHA256 with server pepper
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Set expiration time to 10 minutes from now
        // Store the OTP and token in the database
        await prisma.verificationToken.update({
            where:{
                id:verificationToken.id
            },
            data: {
                otpHash: otpHash,
                expiresAt,
                otpHashUpdatedAt:now,
                failedAttempts: 0
            },
        });

        let sendEmail = await sendOtpEmailService({otp, email:verificationToken.user.email, purpose:"request-new-otp-code"});
        if (!sendEmail.success) {
            sendEmail  = await sendOtpEmailService({otp, email:verificationToken.user.email, purpose:"request-new-otp-code"});
        }
    
    if (!sendEmail.success) {
        res.status(400).json({message:`Failed to process email address: ${sendEmail.message}`});
        return;
    }

    res.status(200).json({ message: "Otp request successfully", verification:{ token, email:verificationToken.user.email, expiry:{duration:10, parameter:"minutes"} } });
  } catch (error) {
    console.error("Error during signup:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function requestVerificationForForgetPassword(req: Request, res: Response): Promise<void> {
    try {
        const {email} = req.body;

        if (!email) {
            res.status(400).json({ message: "Invalid email", error:"bad parameter" });
            return;
        }
        const user = await prisma.user.findUnique({
            where:{
                email:email
            },
        })
        if (!user) {
            res.status(202).json({ message: "If an account with that email exists, a reset code has been sent." });
            return;
        }


        const otp = generateNumericOtp(6); // Generate a 6-digit numeric OTP
        const otpHash = hashOtp(otp); // HMAC-SHA256 with server pepper
        const token = await generateVerificationToken(); // Generate a unique verification token
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Set expiration time to 10 minutes from now
        // Store the OTP and token in the database
        await prisma.verificationToken.create({
            data: {
                token,
                userId:user.id,
                otpHash: otpHash,
                expiresAt,
                type:"EMAIL_VERIFICATION_PASSWORD_RESET"
            },
        });

        let sendEmail = await sendOtpEmailService({otp, email:user.email, purpose:"password-reset"});
        if (!sendEmail.success) {
            sendEmail  = await sendOtpEmailService({otp, email:user.email, purpose:"password-reset"});
        }
    
    if (!sendEmail.success) {
        res.status(400).json({message:`Failed to process email address: ${sendEmail.message}`});
        return;
    }

    res.status(200).json({ message: "Otp request successfully", verification:{ token, email:user.email, expiry:{duration:10, parameter:"minutes"} } });
  } catch (error) {
    console.error("Error during signup:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function verifyVerificationForForgetPassword(req: Request, res: Response): Promise<void> {
    try {
        const {otp} = req.body;
        const {token} = req.params;

        if (!token) {
        res.status(400).json({ message: "Invalid verification token", error:"bad token" });
        return;
        }
        if (!otp) {
        res.status(400).json({ message: "Invalid otp code", error:"bad otp" });
        return;
        }

        // validate token
        const verificationToken = await prisma.verificationToken.findUnique({
            where:{
                token:token as string
            },
            include:{
                user:true
            }
        });
        if (!verificationToken) {
        res.status(400).json({ message: "Invalid verification token", error:"bad token" });
        return;
        }
        if (verificationToken.type !== "EMAIL_VERIFICATION_PASSWORD_RESET") {
            res.status(400).json({ message: "Invalid token type for password reset", error:"invalid_token_type" });
            return;
        }
        if (verificationToken.consumedAt) {
            res.status(400).json({ message: "Reset token has already been used", error:"token_already_used" });
            return;
        }
        if (verificationToken.failedAttempts >= 5) {
            res.status(429).json({ message: "Too many failed OTP attempts. Please request a new code.", error:"otp_locked" });
            return;
        }
        const expiresAt = verificationToken.expiresAt;
        if (expiresAt < new Date()) {
            res.status(400).json({ message: "Expired token, request a new otp code", error:"bad token" });
            return;
        }

        const storedOtpHash = verificationToken.otpHash;
        const isMatch = verifyOtp(otp, storedOtpHash);
        if (!isMatch) {
            const updatedRows = await prisma.$queryRaw<{ failedAttempts: number }[]>`
                UPDATE "VerificationToken"
                SET "failedAttempts" = "failedAttempts" + 1
                WHERE "id" = ${verificationToken.id}
                  AND "failedAttempts" < 5
                  AND "consumedAt" IS NULL
                RETURNING "failedAttempts"
            `;
            if (updatedRows.length === 0 || updatedRows[0].failedAttempts >= 5) {
                res.status(429).json({ message: "Too many failed OTP attempts. Please request a new code.", error:"otp_locked" });
                return;
            }
            res.status(400).json({ message: "Invalid otp code ", error:"bad token" });
            return;
        }
        const now = new Date();
        await prisma.verificationToken.update({
            where:{id:verificationToken.id},
            data:{
                verified:true,
                verifiedAt:now,
            }
        })

        res.status(200).json({ message: "Otp request successfully", verification:{ token, status:"success", verified:true} });
  } catch (error) {
    console.error("Error during signup:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}