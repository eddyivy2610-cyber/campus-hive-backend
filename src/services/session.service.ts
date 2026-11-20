import { Request, Response } from "express";
import crypto from "crypto";
import prisma from "../prisma.ts";
import { generateAccessToken, generateOpaqueRefreshToken } from "./token.service.ts";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

type SessionBody = {
  accessToken: string;
  refreshToken: string;
};

interface StartSessionResponse {
  session: SessionBody | null;
  success: boolean;
  message: string;
}

export function setSessionCookies(
  req: Request,
  res: Response,
  accessToken: string,
  refreshToken: string
): void {
  // Rely strictly on Express req.secure (governed by app.set("trust proxy", ...)) + production env
  const isSecure = Boolean(req.secure || process.env.NODE_ENV === "production");

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/api",
    maxAge: 7 * DAY_IN_MS,
  });
}

export async function cleanupExpiredRefreshTokens(now = new Date()): Promise<number> {
  const revokedCutoff = new Date(now.getTime() - 30 * DAY_IN_MS);
  const usedCutoff = new Date(now.getTime() - 7 * DAY_IN_MS);
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { revokedAt: { lt: revokedCutoff } },
        { usedAt: { lt: usedCutoff } },
      ],
    },
  });
  return result.count;
}

export function startRefreshTokenCleanupSchedule(
  intervalMs = 6 * 60 * 60 * 1000
): NodeJS.Timeout {
  void cleanupExpiredRefreshTokens().catch((err) => {
    console.error("[RefreshTokenCleanup] Initial cleanup failed:", err?.message || err);
  });
  const timer = setInterval(() => {
    void cleanupExpiredRefreshTokens().catch((err) => {
      console.error("[RefreshTokenCleanup] Scheduled cleanup failed:", err?.message || err);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}

export async function startSession(userId: string): Promise<StartSessionResponse> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true },
    });
    const expiresAt = new Date(Date.now() + 7 * DAY_IN_MS);
    const familyId = crypto.randomUUID();
    const { token: refreshToken, tokenHash } = generateOpaqueRefreshToken();

    const newSession = await prisma.$transaction(async (tx) => {
      const s = await tx.session.create({
        data: {
          userId,
          familyId,
          refreshTokenHash: tokenHash,
          expiresAt,
        },
      });
      await tx.refreshToken.create({
        data: {
          tokenHash,
          sessionId: s.id,
          familyId,
          expiresAt,
        },
      });
      return s;
    });

    const accessToken = generateAccessToken(
      userId,
      newSession.id,
      user?.tokenVersion ?? 0
    );

    return {
      session: { accessToken, refreshToken },
      success: true,
      message: "Session created",
    };
  } catch (err: any) {
    return {
      session: null,
      success: false,
      message: `Session creation failed: ${err.message || "Unknown error"}`,
    };
  }
}
