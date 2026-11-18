import { NextFunction, Request, Response } from "express";
import prisma from "../prisma.ts";
import { verifyAccessToken } from "../services/token.service.ts";
import { isDatabaseUnavailable } from "../lib/databaseErrors.ts";

export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: string;
    sessionId: string;
    role: string;
  };
}

export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const bearer =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : null;
    const cookieToken = (req as any).cookies?.accessToken || null;
    const token = bearer || cookieToken;

    if (!token) {
      res.status(401).json({ message: "Authentication required", error: "unauthorized" });
      return;
    }

    const decoded = await verifyAccessToken(token);
    if (!decoded) {
      res.status(401).json({ message: "Invalid or expired access token", error: "unauthorized" });
      return;
    }

    let session;
    try {
      session = await prisma.session.findUnique({
        where: { id: decoded.sessionId },
        include: { user: true },
      });
    } catch (dbErr) {
      console.error("Auth middleware DB error:", dbErr);
      res.status(503).json({ message: "Service temporarily unavailable", error: "service_unavailable" });
      return;
    }

    if (!session || session.status !== "ACTIVE" || session.expiresAt <= new Date()) {
      res.status(401).json({ message: "Session is revoked or expired", error: "unauthorized" });
      return;
    }

    if (!session.user || session.user.tokenVersion !== decoded.tokenVersion) {
      res.status(401).json({ message: "Session invalidated", error: "unauthorized" });
      return;
    }

    if (session.user.accountStatus === "SUSPENDED" || session.user.accountStatus === "BANNED") {
      res.status(403).json({ message: "Account is suspended", error: "account_suspended" });
      return;
    }

    if (session.user.accountStatus !== "ACTIVE") {
      res.status(403).json({ message: "Account is not active", error: "account_not_active" });
      return;
    }

    req.auth = {
      userId: session.user.id,
      sessionId: session.id,
      role: session.user.role,
    };

    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
  }
}

/**
 * Requires live DB verification that the authenticated user still holds role === "ADMIN"
 * and accountStatus === "ACTIVE" (prevents demoted/suspended admins using unexpired JWTs).
 */
export async function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  await authenticate(req, res, async () => {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, accountStatus: true },
      });
      if (!dbUser || dbUser.role !== "ADMIN" || dbUser.accountStatus !== "ACTIVE") {
        res.status(403).json({
          message: "Forbidden: Admin authorization revoked or required",
          error: "forbidden",
        });
        return;
      }
      next();
    } catch (err) {
      if (isDatabaseUnavailable(err)) {
        res.status(503).json({
          success: false,
          error: "Database temporarily unavailable. Please try again shortly.",
        });
        return;
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });
}
