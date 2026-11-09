import { Request, Response } from "express";
import prisma from "../prisma.ts";
import bcrypt from "bcrypt";
import { generateSessionTokens } from "../services/token.service.ts";
import jwt from "jsonwebtoken";

export async function processVerificationForForgetPassword(req: Request, res: Response): Promise<void> {
    try {
        const {newPassword} = req.body;
        const {token} = req.params;

        if (!token) {
        res.status(400).json({ message: "Invalid verification token", error:"bad token" });
        return;
        }
        if (!newPassword) {
        res.status(400).json({ message: "Invalid password", error:"bad parameter" });
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
        if (!verificationToken.verified) {
            res.status(403).json({ message: "Unverified request token", error:"unauthorised" });
            return;
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const now = new Date();
        await prisma.user.update({
            where:{id:verificationToken.userId},
            data:{
                passwordHash:hashedPassword,
                passwordUpdatedAt:now
            }
        })

        res.status(200).json({ message: "Password updated successfully", success:true });
  } catch (error) {
    console.error("Error during signup:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function refreshToken(req:Request, res:Response) {
    try {
        console.log("Refreshing token 🔁");
        const {token:refresh} = req.params;

        if (!refresh) {
            return res.status(401).json({ success:false, message:"Refresh token required"});
        }

        const refresh_secret = process.env.REFRESH_TOKEN_SECRET!;
        console.log("Decoding...")
        const decoded = jwt.verify(refresh as string, refresh_secret);
        // Guard: if decoded is a string (shouldn't happen with object‑signed tokens), reject
        if (typeof decoded === 'string') {
            return res.status(401).json({ message: "Invalid token format", error: "Unauthorized" });
        }
        const { sessionId, exp } = decoded;
        console.log("Success Decoding ✅")
    
        const session = await prisma.session.findFirst({
            where:{
                id:sessionId,
                expiresAt:{ gt:new Date()}
            },
            include: {
                user:true
            }
        });
        if (!session || session.expiresAt < new Date()) {
            console.log("Invalid or expired token")
            return res.status(401).json({ message: "Missing or expired session", error: "Unauthorized" });
        };
        console.log("Session valid ✅");

        const user = session.user;
        console.log("Generating & hashing new token");
        const {accessToken, refreshToken} = generateSessionTokens(user.id, session.id);
        const newRefreshTokenHash = await bcrypt.hash(refreshToken, 10);
        await prisma.session.update(
            {
                where:{id:session.id},
                data:{refreshTokenHash:newRefreshTokenHash}
            }
        );

        console.log("Token refresh successfull ✅")

        res.status(200).json({success:true, session:{accessToken,refreshToken}});
    } catch (error:any) {
        console.error("Refresh failed");
        console.error("Process error:", error?.message || error || "Unknown error");
        res.status(500).json({ message: "Internal server error" });
    }
}