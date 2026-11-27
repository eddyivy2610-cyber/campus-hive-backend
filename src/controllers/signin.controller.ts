import { Request, Response } from "express";
import prisma from "../prisma.ts";
import { getDummyPasswordHash, verifyPassword } from "../lib/password.ts";
import { isDatabaseUnavailable } from "../lib/databaseErrors.ts";
import { validateEmail } from "../lib/email.ts";
import { setSessionCookies, startSession } from "../services/session.service.ts";


export async function signin(req:Request, res:Response):Promise<void> {
    try {
        const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
        const password = typeof req.body?.password === "string" ? req.body.password : "";

        if (!email || !validateEmail(email)) {
        res.status(400).json({ message: "Invalid Email Address: Valid address is required" });
        return;
        }
        if (!password) {
        res.status(400).json({ message: "Password is required" });
        return;
        }

        // validate token
        const user = await prisma.user.findUnique({
            where:{
                email:email
            },
        });
        if (!user) {
            // Equalize timing for unknown emails via dummy Argon2 verification
            const dummyHash = await getDummyPasswordHash();
            await verifyPassword(password, dummyHash).catch(() => false);
            res.status(401).json({ message: "Invalid email or password", error:"bad credentials" });
            return;
        }
        
        const isPasswordMatch = await verifyPassword(password, user.passwordHash);

        if (!isPasswordMatch) {
            res.status(401).json({ message: "Invalid email or password", error:"bad credentials" });
            return;
        }

        if (!user.isEmailVerified) {
            res.status(403).json({ message: "Please verify your email before signing in", error:"email_not_verified" });
            return;
        }

        if (user.accountStatus === "SUSPENDED" || user.accountStatus === "BANNED") {
            res.status(403).json({ message: "Account is suspended", error:"account_suspended" });
            return;
        }
        if (user.accountStatus !== "ACTIVE") {
            res.status(403).json({ message: "Please verify your email before signing in", error:"account_pending" });
            return;
        }

        let session = await startSession(user.id);
        if (!session.success) {
            // retry
            session =  await startSession(user.id);
        }
        if (!session.success) {
            res.status(400).json({ message: "Failed to start session", error:session.message });
            return;
        }

        if (session.session) {
            setSessionCookies(req, res, session.session.accessToken, session.session.refreshToken);
        }

        res.status(200).json({
            success: true,
            token: session.session ? session.session.accessToken : undefined,
            session: session.session ? { accessToken: session.session.accessToken } : null,
            user: {
                id: user.id,
                email: user.email,
                name: user.displayName || user.fullName || user.username,
                username: user.username,
                profileImage: user.profileImage || null,
                role: user.role,
                emailVerified: Boolean(user.isEmailVerified),
                profile: {
                    displayName: user.displayName || user.fullName || user.username,
                    handle: user.username,
                    avatar: user.profileImage || null,
                },
            },
            message: "Session created successfully",
        });

    } catch (error) {
        if (isDatabaseUnavailable(error)) {
            res.status(503).json({
                success: false,
                error: "Database temporarily unavailable. Please try again shortly.",
            });
            return;
        }
        console.error("Error during signin:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}