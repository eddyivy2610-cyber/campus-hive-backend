import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import prisma from "../prisma.ts";

export interface reqWithUser extends Request {
    user:{
        userId:string,
        sessionId:string,
    }
}

export async function authorizeUser(req: Request, res: Response, next: NextFunction) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ message: "Authorization header missing or malformed", error: "Unauthorized" });
        }

        const token = authHeader.split(" ")[1];
        if (!token) {
            return res.status(401).json({ message: "Token missing", error: "Unauthorized" });
        }

        // Verify token
        const access_secret = process.env.ACCESS_TOKEN_SECRET!;
        const decoded = jwt.verify(token, access_secret);


        // Guard: if decoded is a string (shouldn't happen with object‑signed tokens), reject
        if (typeof decoded === 'string') {
            return res.status(401).json({ message: "Invalid token format", error: "Unauthorized" });
        }

        const { sub: userId, sessionId, exp } = decoded;

        if (!userId || typeof userId !== 'string') {
            return res.status(401).json({ message: "Missing or invalid user ID in token", error: "Unauthorized" });
        }

        if (!sessionId || typeof sessionId !== 'string') {
            return res.status(401).json({ message: "Missing or invalid session ID in token", error: "Unauthorized" });
        };

        const sessionRecord = await prisma.session.findFirst({where:{id:sessionId}});

        if (!sessionRecord || sessionRecord.expiresAt < new Date()) {
            return res.status(401).json({ message: "Missing or expired session", error: "Unauthorized" });
        };

        // Attach user info to request object
        (req as reqWithUser).user = { userId, sessionId };

        // Continue to the route handler
        next();
    } catch (err: any) {
        console.error("Authorization failed:", err?.message || err);
        return res.status(401).json({ message: "Invalid or expired token", error: "Unauthorized" });
    }
}