import jwt from "jsonwebtoken";
import crypto from "crypto";
import { JWT_AUDIENCE, JWT_ISSUER } from "../lib/config.ts";


// Generate strong secrets (store in env variables)
const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET;
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET;

export function hashRefreshToken(rawToken: string): string {
    return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function generateOpaqueRefreshToken(): { token: string; tokenHash: string } {
    // 64 cryptographically random bytes (>= 32 bytes required, > 72 chars in base64url), SHA-256 hashed at rest
    const token = crypto.randomBytes(64).toString("base64url");
    return { token, tokenHash: hashRefreshToken(token) };
}

export function generateAccessToken(userId: string, sessionId: string, tokenVersion = 0): string {
    const accessSecret = process.env.ACCESS_TOKEN_SECRET || ACCESS_SECRET!;
    return jwt.sign(
        {
            sub: userId,
            sessionId,
            tokenVersion,
            tokenType: 'access',
        },
        accessSecret,
        {
            expiresIn: '15m',
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            jwtid: crypto.randomUUID(),
        }
    );
}

export function generateSessionTokens(userId:string, sessionId:string, tokenVersion = 0) {
    const accessToken = generateAccessToken(userId, sessionId, tokenVersion);
    const { token: refreshToken } = generateOpaqueRefreshToken();
    return { accessToken, refreshToken };
};

export async function verifyAccessToken(token:string):Promise<{userId:string, sessionId:string, tokenVersion:number} | null> {
    try {
        const access_secret = process.env.ACCESS_TOKEN_SECRET!;
        const decoded = jwt.verify(token, access_secret, {
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            algorithms: ['HS256'],
        });

        if (typeof decoded === 'string') {
            return null;
        }

        const { sub: userId, sessionId, tokenVersion, tokenType } = decoded as any;

        if (!userId || typeof userId !== 'string') {
            return null;
        }

        if (!sessionId || typeof sessionId !== 'string') {
            return null;
        }

        if (tokenType !== 'access') {
            return null;
        }

        return {
            userId,
            sessionId,
            tokenVersion: typeof tokenVersion === 'number' ? tokenVersion : 0,
        };
    } catch {
        return null;
    }
}