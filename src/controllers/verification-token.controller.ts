import { Request, Response } from "express";
import prisma from "../prisma.ts";
import { randomString } from "../lib/generate.ts";
import bcrypt from "bcrypt";
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

        const isElligibleToRenew = isOlderThanMinutes(verificationToken.otpHashUpdatedAt, 1, now);
        if (!isElligibleToRenew) {
            res.status(400).json({ message: "Please wait a minute before request new code", error:"bad timing" });
            return;
        }


        const otp = randomString(6).toUpperCase(); // Generate a 6-character OTP
        const otpHash = await bcrypt.hash(otp, 10); // Hash the OTP before storing
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Set expiration time to 10 minutes from now
        // Store the OTP and token in the database
        await prisma.verificationToken.update({
            where:{
                id:verificationToken.id
            },
            data: {
                otpHash: otpHash,
                expiresAt,
                otpHashUpdatedAt:now
            },
        });

        let sendEmail = await sendOtpEmailService({otp, email:verificationToken.user.email, purpose:"request-new-otp-code"});
        if (!sendEmail.success) {
            sendEmail  = await sendOtpEmailService({otp, email:verificationToken.user.email, purpose:"request-new-otp-code"});
        }
    
    if (!sendEmail.success) {
        res.status(400).json({message:`Failed to process email address: ${sendEmail.message}`});
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
            res.status(404).json({ message: "Account does not exists", error:"bad request" });
            return;
        }


        const otp = randomString(6).toUpperCase(); // Generate a 6-character OTP
        const otpHash = await bcrypt.hash(otp, 10); // Hash the OTP before storing
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
        const expiresAt = verificationToken.expiresAt;
        if (expiresAt < new Date()) {
            res.status(400).json({ message: "Expired token, request a new otp code", error:"bad token" });
            return;
        }

        const storedOtpHash = verificationToken.otpHash;
        const isMatch = await bcrypt.compare(otp, storedOtpHash);
        if (!isMatch) {
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