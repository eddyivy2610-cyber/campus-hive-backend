import jwt from "jsonwebtoken";
import crypto from "crypto";
import prisma from "../prisma.ts";


// Generate strong secrets (store in env variables)
const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET;
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET;

export function generateSessionTokens(userId:string, sessionId:string) {
    const accessToken = jwt.sign(
        { 
            sub: userId,
            sessionId,
            tokenType: 'access'
        },
        ACCESS_SECRET!,
        { 
            expiresIn: '15m',      // short-lived
            issuer: 'gatherly',
            audience: 'api.gatherly.com',
            jwtid: crypto.randomUUID() // unique token ID (jti)
        }
    );

    const refreshToken = jwt.sign(
        { 
            sub: userId,
            sessionId,            // bound to same session
            tokenType: 'refresh',  // to distinguish
        },
        REFRESH_SECRET!,
        { 
            expiresIn: '7d',      // longer lifetime
            issuer: 'gatherly',
            audience: 'api.gatherly.com',
            jwtid: crypto.randomUUID()
        }
    );

    return { accessToken, refreshToken };
};

export async function verifyAccessToken(token:string):Promise<{userId:string, sessionId:string} | null> {
    const access_secret = process.env.ACCESS_TOKEN_SECRET!;
        const decoded = jwt.verify(token, access_secret);


        // Guard: if decoded is a string (shouldn't happen with object‑signed tokens), reject
        if (typeof decoded === 'string') {
            return null;
        }

        const { sub: userId, sessionId, exp } = decoded;

        if (!userId || typeof userId !== 'string') {
            return null;
        }

        if (!sessionId || typeof sessionId !== 'string') {
            return null;
        };

        const sessionRecord = await prisma.session.findFirst({where:{id:sessionId}});

        if (!sessionRecord || sessionRecord.expiresAt < new Date()) {
            return null;
        };

        return {userId, sessionId};
}