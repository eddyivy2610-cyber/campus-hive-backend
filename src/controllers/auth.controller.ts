import { Request, Response } from "express";
import prisma from "../prisma.ts";
import { hashPassword } from "../lib/password.ts";
import { generateAccessToken, generateOpaqueRefreshToken, hashRefreshToken } from "../services/token.service.ts";
import { setSessionCookies } from "../services/session.service.ts";
import jwt from "jsonwebtoken";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";

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
        if (verificationToken.type !== "EMAIL_VERIFICATION_PASSWORD_RESET") {
            res.status(400).json({ message: "Invalid token type for password reset", error:"invalid_token_type" });
            return;
        }
        if (verificationToken.consumedAt) {
            res.status(400).json({ message: "Reset token has already been used", error:"token_already_used" });
            return;
        }
        if (verificationToken.expiresAt < new Date()) {
            res.status(400).json({ message: "Expired reset token", error:"bad token" });
            return;
        }
        if (!verificationToken.verified) {
            res.status(403).json({ message: "Unverified request token", error:"unauthorised" });
            return;
        }

        const now = new Date();
        // Atomically consume reset token in one conditional UPDATE ... RETURNING
        const consumedRows = await prisma.$queryRaw<{ id: string }[]>`
            UPDATE "VerificationToken"
            SET "consumedAt" = ${now}
            WHERE "id" = ${verificationToken.id}
              AND "type" = 'EMAIL_VERIFICATION_PASSWORD_RESET'
              AND "verified" = true
              AND "consumedAt" IS NULL
              AND "expiresAt" > ${now}
            RETURNING "id"
        `;
        if (consumedRows.length === 0) {
            res.status(400).json({ message: "Reset token has already been used or expired", error:"token_already_used" });
            return;
        }

        const hashedPassword = await hashPassword(newPassword);

        await prisma.$transaction([
            prisma.user.update({
                where:{id:verificationToken.userId},
                data:{
                    passwordHash:hashedPassword,
                    passwordUpdatedAt:now,
                    tokenVersion: { increment: 1 }
                }
            }),
            prisma.session.updateMany({
                where:{ userId: verificationToken.userId, status: "ACTIVE" },
                data:{ status: "REVOKED" }
            }),
            prisma.refreshToken.updateMany({
                where:{ session: { userId: verificationToken.userId }, revokedAt: null },
                data:{ revokedAt: now }
            })
        ]);

        res.status(200).json({ message: "Password updated successfully", success:true });
    } catch (error) {
        console.error("Error during password reset:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

async function revokeSessionFamily(familyId: string, now: Date): Promise<void> {
    await prisma.$transaction([
        prisma.session.updateMany({
            where: { familyId, status: "ACTIVE" },
            data: { status: "REVOKED" }
        }),
        prisma.refreshToken.updateMany({
            where: { familyId, revokedAt: null },
            data: { revokedAt: now }
        })
    ]);
}

function getCookieClearOptions(req: Request, path = "/") {
    const isSecure = Boolean(
        req.secure ||
        process.env.NODE_ENV === "production"
    );
    return {
        httpOnly: true,
        secure: isSecure,
        sameSite: "lax" as const,
        path
    };
}

function formatAuthUser(user: {
    id: string;
    email: string;
    username: string;
    fullName: string | null;
    displayName: string | null;
    profileImage: string | null;
    role: string;
    isEmailVerified: boolean;
    accountStatus: string;
    createdAt?: Date;
}) {
    return {
        ...user,
        name: user.displayName || user.fullName || user.username,
        emailVerified: Boolean(user.isEmailVerified),
        profile: {
            displayName: user.displayName || user.fullName || user.username,
            handle: user.username,
            avatar: user.profileImage || null,
        },
    };
}

export async function refreshToken(req:Request, res:Response) {
    try {
        const rawRefresh = req.cookies?.refreshToken;

        if (!rawRefresh || typeof rawRefresh !== "string") {
            return res.status(401).json({ success:false, message:"Refresh token required"});
        }

        const tokenHash = hashRefreshToken(rawRefresh);
        const now = new Date();
        const storedToken = await prisma.refreshToken.findUnique({
            where: { tokenHash },
            include: {
                session: {
                    include: {
                        user: true
                    }
                }
            }
        });

        if (!storedToken) {
            return res.status(401).json({ message: "Invalid or expired refresh token", error: "Unauthorized" });
        }

        const { session } = storedToken;
        if (storedToken.usedAt !== null || storedToken.revokedAt !== null || session.status !== "ACTIVE") {
            await revokeSessionFamily(storedToken.familyId, now);
            return res.status(401).json({ message: "Refresh token reuse detected; session family revoked", error: "token_reused" });
        }

        if (storedToken.expiresAt <= now || session.expiresAt <= now) {
            // Cleanup-on-lookup guard: purge expired refresh token(s) immediately even without background timers
            await prisma.refreshToken.deleteMany({
                where: {
                    OR: [
                        { id: storedToken.id },
                        { sessionId: session.id, expiresAt: { lte: now } },
                    ],
                },
            });
            return res.status(401).json({ message: "Missing or expired session", error: "Unauthorized" });
        }

        const user = session.user;
        if (user.accountStatus === "SUSPENDED" || user.accountStatus === "BANNED") {
            return res.status(403).json({ message: "Account is suspended", error: "account_suspended" });
        }
        if (user.accountStatus !== "ACTIVE") {
            return res.status(403).json({ message: "Account is not active", error: "account_not_active" });
        }

        // Atomically consume this refresh token in one conditional UPDATE ... RETURNING;
        // concurrent reuse triggers family revocation
        const consumedRows = await prisma.$queryRaw<{ id: string }[]>`
            UPDATE "RefreshToken"
            SET "usedAt" = ${now}
            WHERE "id" = ${storedToken.id}
              AND "usedAt" IS NULL
              AND "revokedAt" IS NULL
              AND "expiresAt" > ${now}
            RETURNING "id"
        `;
        if (consumedRows.length === 0) {
            await revokeSessionFamily(storedToken.familyId, now);
            return res.status(401).json({ message: "Refresh token reuse detected; session family revoked", error: "token_reused" });
        }

        const nextOpaque = generateOpaqueRefreshToken();
        const nextExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        await prisma.$transaction([
            prisma.refreshToken.create({
                data: {
                    tokenHash: nextOpaque.tokenHash,
                    sessionId: session.id,
                    familyId: storedToken.familyId,
                    expiresAt: nextExpiresAt
                }
            }),
            prisma.session.update({
                where: { id: session.id },
                data: { refreshTokenHash: nextOpaque.tokenHash, lastUsedAt: now }
            })
        ]);

        const accessToken = generateAccessToken(user.id, session.id, user.tokenVersion);
        setSessionCookies(req, res, accessToken, nextOpaque.token);

        res.status(200).json({
            success: true,
            token: accessToken,
            user: formatAuthUser(user),
            session: { accessToken },
        });
    } catch (error:any) {
        console.error("Refresh failed:", error?.message || error || "Unknown error");
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
        const userId = req.auth?.userId;
        if (!userId) {
            res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
            return;
        }
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                username: true,
                fullName: true,
                displayName: true,
                profileImage: true,
                campus: { select: { name: true } },
                role: true,
                isEmailVerified: true,
                accountStatus: true,
                createdAt: true,
                stores: {
                    where: { status: "active" },
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        description: true,
                        category: true,
                        campus: true,
                        operatingLocation: true,
                        logo: true,
                        coverImage: true,
                        isVerified: true,
                        storeType: true,
                        status: true,
                        followersCount: true,
                        createdAt: true,
                    },
                    orderBy: { createdAt: "desc" },
                },
            }
        });
        if (!user) {
            res.status(401).json({ message: "User not found", error: "unauthorized" });
            return;
        }
        const activeStores = (user.stores || []).map((s) => ({ ...s, _id: s.id }));
        const formatted = {
            ...formatAuthUser(user),
            campus: user.campus?.name || null,
            stores: activeStores,
            store: activeStores[0] || null,
            storeId: activeStores[0]?.id || null,
        };
        res.setHeader("Cache-Control", "private, no-store");
        res.status(200).json({ success: true, user: formatted, data: formatted });
    } catch (error) {
        console.error("Error in getMe:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function logout(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
        const sessionId = req.auth?.sessionId;
        if (!sessionId) {
            res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
            return;
        }
        const now = new Date();
        await prisma.$transaction([
            prisma.session.updateMany({
                where: { id: sessionId, status: "ACTIVE" },
                data: { status: "REVOKED" }
            }),
            prisma.refreshToken.updateMany({
                where: { sessionId, revokedAt: null },
                data: { revokedAt: now }
            })
        ]);
        res.clearCookie("accessToken", getCookieClearOptions(req, "/"));
        res.clearCookie("refreshToken", getCookieClearOptions(req, "/api"));
        res.clearCookie("refreshToken", getCookieClearOptions(req, "/api/v1/auth"));
        res.status(200).json({ success: true, message: "Logged out successfully" });
    } catch (error) {
        console.error("Error in logout:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function logoutAll(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
        const userId = req.auth?.userId;
        if (!userId) {
            res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
            return;
        }
        const now = new Date();
        await prisma.$transaction([
            prisma.session.updateMany({
                where: { userId, status: "ACTIVE" },
                data: { status: "REVOKED" }
            }),
            prisma.refreshToken.updateMany({
                where: { session: { userId }, revokedAt: null },
                data: { revokedAt: now }
            }),
            prisma.user.update({
                where: { id: userId },
                data: { tokenVersion: { increment: 1 } }
            })
        ]);
        res.clearCookie("accessToken", getCookieClearOptions(req, "/"));
        res.clearCookie("refreshToken", getCookieClearOptions(req, "/api"));
        res.clearCookie("refreshToken", getCookieClearOptions(req, "/api/v1/auth"));
        res.status(200).json({ success: true, message: "All sessions revoked successfully" });
    } catch (error) {
        console.error("Error in logoutAll:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}
