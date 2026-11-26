import { Response } from "express";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";
import { toPublicStore } from "../lib/serializers.ts";
import { verifyAccessToken } from "../services/token.service.ts";

async function resolveStoreByTarget(targetId: string) {
  const clean = targetId.trim();
  if (!clean) return null;
  return prisma.store.findFirst({
    where: {
      status: "active",
      OR: [{ id: clean }, { ownerId: clean }, { slugLower: clean.toLowerCase() }],
    },
    select: { id: true, ownerId: true, followersCount: true, status: true },
  });
}

async function getOptionalUserId(req: AuthenticatedRequest): Promise<string | null> {
  if (req.auth?.userId) return req.auth.userId;
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const cookieToken = (req as any).cookies?.accessToken || null;
  const token = bearer || cookieToken;
  if (!token) return null;
  const decoded = await verifyAccessToken(token).catch(() => null);
  return decoded?.userId || null;
}

export async function followStore(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const rawTarget = String(req.params.storeId || req.params.targetId || "");
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const store = await resolveStoreByTarget(rawTarget);
    if (!store) {
      res.status(404).json({ message: "Store not found", error: "not_found" });
      return;
    }

    const followersCount = await prisma.$transaction(async (tx) => {
      const inserted = await tx.follow.createMany({
        data: [{ followerId: userId, storeId: store.id }],
        skipDuplicates: true,
      });
      if (inserted.count > 0) {
        const updated = await tx.store.update({
          where: { id: store.id },
          data: { followersCount: { increment: 1 } },
          select: { followersCount: true },
        });
        return updated.followersCount;
      }
      return store.followersCount;
    });

    res.status(200).json({
      success: true,
      following: true,
      isFollowing: true,
      storeId: store.id,
      followersCount,
    });
  } catch (err) {
    console.error("Error following store:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function unfollowStore(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const rawTarget = String(req.params.storeId || req.params.targetId || "");
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const store = await resolveStoreByTarget(rawTarget);
    const targetStoreId = store?.id || rawTarget;

    const followersCount = await prisma.$transaction(async (tx) => {
      const deleted = await tx.follow.deleteMany({
        where: { followerId: userId, storeId: targetStoreId },
      });
      if (deleted.count > 0) {
        await tx.store.updateMany({
          where: { id: targetStoreId, followersCount: { gt: 0 } },
          data: { followersCount: { decrement: 1 } },
        });
      }
      const s = await tx.store.findUnique({
        where: { id: targetStoreId },
        select: { followersCount: true },
      });
      return s?.followersCount ?? 0;
    });

    res.status(200).json({
      success: true,
      following: false,
      isFollowing: false,
      storeId: targetStoreId,
      followersCount,
    });
  } catch (err) {
    console.error("Error unfollowing store:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function toggleFollow(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const rawTarget = String(req.params.targetId || req.params.storeId || "");
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const store = await resolveStoreByTarget(rawTarget);
    if (!store) {
      res.status(404).json({ message: "Store not found", error: "not_found" });
      return;
    }

    const existing = await prisma.follow.findUnique({
      where: { followerId_storeId: { followerId: userId, storeId: store.id } },
    });

    if (existing) {
      req.params.storeId = store.id;
      return unfollowStore(req, res);
    }
    req.params.storeId = store.id;
    return followStore(req, res);
  } catch (err) {
    console.error("Error toggling follow:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function getFollowStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const rawTarget = String(req.params.targetId || req.params.storeId || "");
    const store = await resolveStoreByTarget(rawTarget);
    const userId = await getOptionalUserId(req);

    if (!store) {
      res.status(200).json({
        success: true,
        isFollowing: false,
        following: false,
        followersCount: 0,
      });
      return;
    }

    let isFollowing = false;
    if (userId) {
      const existing = await prisma.follow.findUnique({
        where: { followerId_storeId: { followerId: userId, storeId: store.id } },
        select: { id: true },
      });
      isFollowing = Boolean(existing);
    }

    res.status(200).json({
      success: true,
      isFollowing,
      following: isFollowing,
      followersCount: store.followersCount,
      storeId: store.id,
    });
  } catch (err) {
    console.error("Error checking follow status:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function getFollowCounts(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const rawTarget = String(req.params.targetId || "");
    const store = await resolveStoreByTarget(rawTarget);
    const followersCount = store?.followersCount ?? 0;

    res.status(200).json({
      success: true,
      followersCount,
      followingCount: 0,
      data: { followersCount, followingCount: 0 },
    });
  } catch (err) {
    console.error("Error fetching follow counts:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function listFollowing(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const follows = await prisma.follow.findMany({
      where: {
        followerId: userId,
        store: { status: "active" },
      },
      orderBy: { createdAt: "desc" },
      include: {
        store: true,
      },
    });

    const stores = follows.map((f) => toPublicStore(f.store));
    res.status(200).json({ success: true, data: { stores }, stores });
  } catch (err) {
    console.error("Error listing followed stores:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
