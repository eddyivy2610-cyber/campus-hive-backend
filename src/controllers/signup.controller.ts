import { Request, Response } from "express";
import prisma from "../prisma.ts";
import bcrypt from "bcrypt";
import { randomString } from "../lib/generate.ts";
import { generateVerificationToken } from "../services/verification.service.ts";
import { sendOtpEmailService } from "../services/email.service.ts";
import { validateEmail } from "../lib/email.ts";
import { startSession } from "../services/session.service.ts";

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

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    // generate unique username based on fullName and a random number
    const randomNum = Math.floor(Math.random() * 10000);
    const username = `${fullName.split(" ")[0].replace(/\s+/g, "").toLowerCase()}${randomNum}_hive`;
    // Create new user
    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash: hashedPassword,
        fullName,
        username,
      },
    });

    const otp = randomString(6); // Generate a 6-character OTP
    const otpHash = await bcrypt.hash(otp, 10); // Hash the OTP before storing
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
        Promise.all([
            prisma.user.delete({where:{id:newUser.id}}),
            prisma.verificationToken.delete({where:{id:newVerificationToken.id}})
        ]);
        res.status(400).json({message:`Failed to process email address: ${sendEmail.message}`});
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
        Promise.all([
            await prisma.user.update({
                where:{id:verificationToken.userId},
                data:{
                    isEmailVerified:true
                }
            }),
            await prisma.verificationToken.update({
                where:{id:verificationToken.id},
                data:{
                    verified:true,
                    verifiedAt:now,
                }
            })
        ])

        let session = await startSession(verificationToken.userId);
        if (!session.success) {
            // retry
            session =  await startSession(verificationToken.userId);
        }
        if (!session.success) {
            res.status(400).json({ message: "Failed to start session", error:session.message });
            return;
        }

        res.status(200).json({
            success:true, 
            session, 
            user:{
                id:verificationToken.userId, 
                username:verificationToken.user.username, 
                profileImage:verificationToken.user.profileImage || null, 
                role:verificationToken.user.role
            }, 
            message:"Session created successfully"
        });

    } catch (error) {
        console.error("Error during signup verification:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}