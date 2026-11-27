import crypto from "crypto";
import { Request, Response } from "express";
import prisma from "../prisma.ts";
import { hashOtp, verifyOtp } from "../lib/otp.ts";
import { hashPassword, validatePasswordPolicy } from "../lib/password.ts";
import { generateNumericOtp } from "../lib/generate.ts";
import { generateVerificationToken } from "../services/verification.service.ts";
import { sendOtpEmailService } from "../services/email.service.ts";
import { validateEmail } from "../lib/email.ts";
import { isReservedIdentityName, validateDisplayName } from "../lib/nameValidation.ts";
import { recordConfidentialSafetyLocation, resolveOrCreateCampusForUser } from "../lib/campuses.ts";
import { setSessionCookies, startSession } from "../services/session.service.ts";

export async function signup(req: Request, res: Response): Promise<void> {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = req.body?.password;

    // Validate input
    if (!email || !validateEmail(email)) {
      res.status(400).json({ message: "Invalid Email Address: Valid address is required" });
      return;
    }

    const nameCheck = validateDisplayName(req.body?.fullName);
    if (!nameCheck.valid) {
      res.status(400).json({ message: nameCheck.error || "Please enter a valid name." });
      return;
    }
    const fullName = nameCheck.normalized;

    const pwCheck = validatePasswordPolicy(password);
    if (!pwCheck.valid) {
      res.status(400).json({ message: pwCheck.error || "Password does not meet security requirements." });
      return;
    }

    // Hash the password using Argon2id (no 72-byte truncation)
    const hashedPassword = await hashPassword(password);

    // Check if user already exists (normalized lowercase email)
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    let targetUserId: string;

    if (existingUser) {
      // Already verified (or non-pending): return non-enumerating 201 response without leaking account existence
      if (existingUser.isEmailVerified || existingUser.accountStatus !== "PENDING") {
        const dummyToken = await generateVerificationToken();
        res.status(201).json({
          message: "User created successfully",
          verification: { token: dummyToken, email, expiry: { duration: 10, parameter: "minutes" } },
        });
        return;
      }

      // Unverified PENDING account: allow real email owner to re-register and replace pending credentials
      await prisma.$transaction([
        prisma.user.update({
          where: { id: existingUser.id },
          data: {
            passwordHash: hashedPassword,
            fullName,
          },
        }),
        prisma.verificationToken.updateMany({
          where: {
            userId: existingUser.id,
            type: "EMAIL_VERIFICATION_SIGNUP",
            verified: false,
            consumedAt: null,
          },
          data: { consumedAt: new Date() },
        }),
      ]);
      targetUserId = existingUser.id;
    } else {
      // Generate short, natural unique username like john_123 (avoiding reserved prefixes)
      const rawBase =
        String(fullName)
          .trim()
          .split(/\s+/)[0]
          .replace(/[^a-zA-Z0-9]/g, "")
          .toLowerCase()
          .slice(0, 12) || "member";
      const baseName = isReservedIdentityName(rawBase) ? "member" : rawBase;

      let username = `${baseName}_${crypto.randomInt(100, 1000)}`;
      for (let attempt = 0; attempt < 5; attempt++) {
        const taken = await prisma.user.findUnique({
          where: { username },
          select: { id: true },
        });
        if (!taken) break;
        username =
          attempt < 3
            ? `${baseName}_${crypto.randomInt(100, 1000)}`
            : `${baseName}_${crypto.randomInt(1000, 10000)}`;
      }
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
      targetUserId = newUser.id;
    }

    // Attach default/selected campus at sign-up (without touching verified profiles)
    // and record confidential precise coordinates strictly for Admin safety review.
    if (req.body?.campus) {
      const campusId = await resolveOrCreateCampusForUser(req.body.campus, targetUserId).catch(
        () => null
      );
      if (campusId) {
        await prisma.user
          .update({ where: { id: targetUserId }, data: { campusId } })
          .catch(() => {});
      }
    }
    if (req.body?.safetyLocation) {
      await recordConfidentialSafetyLocation(targetUserId, req.body.safetyLocation, "signup");
    }

    const otp = generateNumericOtp(6); // Generate a 6-digit numeric OTP
    const otpHash = hashOtp(otp); // HMAC-SHA256 with server pepper
    const token = await generateVerificationToken(); // Generate a unique verification token
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Set expiration time to 10 minutes from now
    // Store the OTP and token in the database
    const newVerificationToken = await prisma.verificationToken.create({
      data: {
        token,
        otpHash: otpHash,
        userId: targetUserId,
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

        if (!token || typeof token !== "string" || token.length > 128) {
        res.status(400).json({ message: "Invalid verification token", error:"bad token" });
        return;
        }
        const cleanOtp = typeof otp === "string" ? otp.trim() : "";
        if (!/^\d{6}$/.test(cleanOtp)) {
        res.status(400).json({ message: "Verification code must be a valid 6-digit code", error:"bad otp" });
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
        // Atomically consume signup verification token so concurrent requests cannot mint multiple sessions
        const consumedRows = await prisma.$queryRaw<{ id: string }[]>`
            UPDATE "VerificationToken"
            SET "verified" = true,
                "verifiedAt" = ${now},
                "consumedAt" = ${now}
            WHERE "id" = ${verificationToken.id}
              AND "type" = 'EMAIL_VERIFICATION_SIGNUP'
              AND "verified" = false
              AND "consumedAt" IS NULL
              AND "expiresAt" > ${now}
            RETURNING "id"
        `;
        if (consumedRows.length === 0) {
            res.status(409).json({ message: "Verification token already used", error:"token_already_used" });
            return;
        }

        await prisma.user.update({
            where:{id:verificationToken.userId},
            data:{
                isEmailVerified:true,
                accountStatus:"ACTIVE"
            }
        });

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