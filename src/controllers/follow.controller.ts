import { Response } from "express";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";
import { toPublicStore } from "../lib/serializers.ts";

export async function followStore(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const storeId = String(req.params.storeId || "");
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store || store.status !== "active") {
      res.status(404).json({ message: "Store not found", error: "not_found" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const inserted = await tx.follow.createMany({
        data: [{ followerId: userId, storeId }],
        skipDuplicates: true,
      });
      if (inserted.count > 0) {
        await tx.store.update({
          where: { id: storeId },
          data: { followersCount: { increment: 1 } },
        });
      }
    });

    res.status(200).json({ success: true, following: true, storeId });
  } catch (err) {
    console.error("Error following store:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function unfollowStore(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const storeId = String(req.params.storeId || "");
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.follow.deleteMany({
        where: { followerId: userId, storeId },
      });
      if (deleted.count > 0) {
        await tx.store.updateMany({
          where: { id: storeId, followersCount: { gt: 0 } },
          data: { followersCount: { decrement: 1 } },
        });
      }
    });

    res.status(200).json({ success: true, following: false, storeId });
  } catch (err) {
    console.error("Error unfollowing store:", err);
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
    console.error("Error listing following stores:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
