import crypto from "crypto";
import { Request, Response } from "express";
import prisma from "../prisma.ts";
import { hashOtp, verifyOtp } from "../lib/otp.ts";
import { hashPassword } from "../lib/password.ts";
import { generateNumericOtp } from "../lib/generate.ts";
import { generateVerificationToken } from "../services/verification.service.ts";
import { sendOtpEmailService } from "../services/email.service.ts";
import { validateEmail } from "../lib/email.ts";
import { setSessionCookies, startSession } from "../services/session.service.ts";

export async function signup(req: Request, res: Response): Promise<void> {
  try {
    const { email, password, fullName } = req.body;

    // Validate input
    
    if (!email || !validateEmail(email)) {
      res.status(400).json({ message: "Invalid Email Address: Valid address is required" });
      return;
    }
    if (!password) {
      res.status(400).json({ message: "Password is required" });
      return;
    }
    if (!fullName) {
      res.status(400).json({ message: "Full name is required" });
      return;
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      res.status(409).json({ message: "User already exists" });
      return;
    }

    // Hash the password using Argon2id (no 72-byte truncation)
    const hashedPassword = await hashPassword(password);
    // generate unique username based on fullName and a random hex suffix
    const randomSuffix = crypto.randomBytes(4).toString("hex");
    const username = `${fullName.split(" ")[0].replace(/\s+/g, "").toLowerCase()}${randomSuffix}_hive`;
    // Create new user (explicitly PENDING and BUYER; schema also defaults to PENDING/BUYER)
    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash: hashedPassword,
        fullName,
        username,
        accountStatus: "PENDING",
        role: "BUYER",
      },
    });

    const otp = generateNumericOtp(6); // Generate a 6-digit numeric OTP
    const otpHash = hashOtp(otp); // HMAC-SHA256 with server pepper
    const token = await generateVerificationToken(); // Generate a unique verification token
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Set expiration time to 10 minutes from now
    // Store the OTP and token in the database
    const newVerificationToken = await prisma.verificationToken.create({
      data: {
        token,
        otpHash: otpHash,
        userId: newUser.id,
        expiresAt,
        type:"EMAIL_VERIFICATION_SIGNUP"
      },
    });

    let sendEmail = await sendOtpEmailService({otp, email, purpose:"signup"});
    if (!sendEmail.success) {
        sendEmail  = await sendOtpEmailService({otp, email, purpose:"signup"});
    }
    
    if (!sendEmail.success) {
      // Keep the PENDING account and verification token intact; reset cooldown so resend works immediately
      await prisma.verificationToken.update({
        where: { id: newVerificationToken.id },
        data: { otpHashUpdatedAt: new Date(0) },
      });
      res.status(201).json({
        message: "User created successfully",
        verification: { token, email, expiry: { duration: 10, parameter: "minutes" } },
      });
      return;
    }

    res.status(201).json({ message: "User created successfully", verification:{ token, email, expiry:{duration:10, parameter:"minutes"} } });
  } catch (error) {
    console.error("Error during signup:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function signupVerification(req:Request, res:Response):Promise<void> {
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
        if (verificationToken.type !== "EMAIL_VERIFICATION_SIGNUP") {
            res.status(400).json({ message: "Invalid verification token type", error:"bad token" });
            return;
        }
        if (verificationToken.verified) {
            res.status(409).json({ message: "Verification token already used", error:"token_already_used" });
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
                  AND "verified" = false
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
        await Promise.all([
            prisma.user.update({
                where:{id:verificationToken.userId},
                data:{
                    isEmailVerified:true,
                    accountStatus:"ACTIVE"
                }
            }),
            prisma.verificationToken.update({
                where:{id:verificationToken.id},
                data:{
                    verified:true,
                    verifiedAt:now,
                    consumedAt:now,
                }
            })
        ]);

        let session = await startSession(verificationToken.userId);
        if (!session.success) {
            // retry
            session =  await startSession(verificationToken.userId);
        }
        if (!session.success) {
            res.status(400).json({ message: "Failed to start session", error:session.message });
            return;
        }

        if (session.session) {
            setSessionCookies(req, res, session.session.accessToken, session.session.refreshToken);
        }

        const u = verificationToken.user;
        res.status(200).json({
            success: true,
            token: session.session ? session.session.accessToken : undefined,
            session: session.session ? { accessToken: session.session.accessToken } : null,
            user: {
                id: verificationToken.userId,
                email: u.email,
                name: u.displayName || u.fullName || u.username,
                username: u.username,
                profileImage: u.profileImage || null,
                role: u.role,
                emailVerified: true,
                onboardingStep: "email_verified",
                profile: {
                    displayName: u.displayName || u.fullName || u.username,
                    handle: u.username,
                    avatar: u.profileImage || null,
                },
            },
            message: "Session created successfully",
        });

    } catch (error) {
        console.error("Error during signup verification:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}