import { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.ts";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";

const RADAR_USER_SELECT = {
  id: true,
  fullName: true,
  displayName: true,
  username: true,
  profileImage: true,
  isEmailVerified: true,
  campus: { select: { name: true } },
  stores: {
    where: { status: "active" },
    select: { logo: true, slug: true },
    take: 1,
  },
} as const;

function resolveUserAvatar(
  user?: { profileImage?: string | null; stores?: Array<{ logo?: string | null }> } | null
): string {
  return user?.profileImage || user?.stores?.[0]?.logo || "";
}

function resolveUserStoreSlug(
  user?: { stores?: Array<{ slug?: string | null }> } | null
): string | null {
  return user?.stores?.[0]?.slug || null;
}

function formatTimeAgo(dateInput: Date | string): string {
  try {
    const d = new Date(dateInput);
    const diffMs = Date.now() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "Recently";
  }
}

export async function listRadarPosts(req: Request, res: Response): Promise<void> {
  try {
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const campus = typeof req.query.campus === "string" ? req.query.campus.trim() : "";
    const rawLimit = Number.parseInt(String(req.query.limit || "40"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 40;

    const posts = await prisma.radarPost.findMany({
      where: {
        status: "active",
        ...(category && category !== "all" ? { category } : {}),
        ...(campus && campus !== "all" ? { campus } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const replyUserIds = posts.flatMap((p) =>
      Array.isArray(p.replies)
        ? (p.replies as any[])
            .map((r) => (typeof r?.userId === "string" ? r.userId : ""))
            .filter(Boolean)
        : []
    );
    const userIds = Array.from(new Set([...posts.map((p) => p.userId), ...replyUserIds]));
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: RADAR_USER_SELECT,
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const mapped = posts.map((p) => {
      const owner = userMap.get(p.userId);
      const rawReplies = Array.isArray(p.replies) ? (p.replies as any[]) : [];
      return {
        id: p.id,
        userId: p.userId,
        requesterName: owner?.displayName || owner?.fullName || owner?.username || "Campus Student",
        requesterHandle: owner?.username || "student",
        requesterLocation: p.location || owner?.campus?.name || p.campus || "Main Campus",
        requesterAvatar: resolveUserAvatar(owner),
        requesterStoreSlug: resolveUserStoreSlug(owner),
        isVerified: Boolean(owner?.isEmailVerified),
        requestText: p.requestText,
        category: p.category || "all",
        budget: p.budget || "",
        campus: p.campus || "Main Campus",
        timeAgo: formatTimeAgo(p.createdAt),
        replies: rawReplies.map((r) => {
          const replyAuthor = typeof r.userId === "string" ? userMap.get(r.userId) : undefined;
          return {
            id: r.id,
            userId: r.userId,
            authorName: r.authorName,
            authorHandle: r.authorHandle,
            authorDept: r.authorDept,
            authorAvatar: r.authorAvatar || resolveUserAvatar(replyAuthor),
            authorStoreSlug: r.authorStoreSlug || resolveUserStoreSlug(replyAuthor),
            isVerified: Boolean(r.isVerified),
            message: r.message,
            authorTime: formatTimeAgo(r.createdAt || p.createdAt),
          };
        }),
      };
    });

    res.status(200).json({ success: true, data: mapped });
  } catch (err) {
    console.error("[GET /radar] Error:", err);
    res.status(500).json({ success: false, error: "Failed to load radar requests" });
  }
}

export async function createRadarPost(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const requestText = typeof req.body?.requestText === "string" ? req.body.requestText.trim() : "";
    if (!requestText) {
      res.status(400).json({ success: false, error: "Request description is required." });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: RADAR_USER_SELECT,
    });

    const location =
      (typeof req.body?.location === "string" && req.body.location.trim()) ||
      (typeof req.body?.campus === "string" && req.body.campus.trim()) ||
      user?.campus?.name ||
      "Main Campus";
    const category =
      typeof req.body?.category === "string" && req.body.category.trim()
        ? req.body.category.trim()
        : "all";
    const budget = typeof req.body?.budget === "string" ? req.body.budget.trim() : "";

    const post = await prisma.radarPost.create({
      data: {
        userId,
        requestText,
        category,
        budget,
        campus: location,
        location,
        status: "active",
        replies: [],
      },
    });

    const created = {
      id: post.id,
      userId,
      requesterName: user?.displayName || user?.fullName || user?.username || "Campus Student",
      requesterHandle: user?.username || "student",
      requesterLocation: location,
      requesterAvatar: resolveUserAvatar(user),
      requesterStoreSlug: resolveUserStoreSlug(user),
      isVerified: Boolean(user?.isEmailVerified),
      requestText: post.requestText,
      category: post.category,
      budget: post.budget,
      campus: post.campus,
      timeAgo: "Just now",
      replies: [],
    };

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error("[POST /radar] Error:", err);
    res.status(500).json({ success: false, error: "Failed to post radar request" });
  }
}

export async function getRadarPost(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id || "");
    const post = await prisma.radarPost.findUnique({ where: { id } });
    if (!post) {
      res.status(404).json({ success: false, error: "Radar post not found." });
      return;
    }
    res.status(200).json({ success: true, data: post });
  } catch (err) {
    console.error("[GET /radar/:id] Error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch post." });
  }
}

export async function deleteRadarPost(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const id = String(req.params.id || "");
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const post = await prisma.radarPost.findUnique({ where: { id } });
    if (!post) {
      res.status(404).json({ success: false, error: "Radar post not found." });
      return;
    }

    if (post.userId !== userId && req.auth?.role !== "ADMIN") {
      res.status(403).json({ success: false, error: "You are not authorized to delete this post." });
      return;
    }

    await prisma.radarPost.delete({ where: { id } });
    res.status(200).json({ success: true, message: "Post deleted successfully." });
  } catch (err) {
    console.error("[DELETE /radar/:id] Error:", err);
    res.status(500).json({ success: false, error: "Failed to delete post." });
  }
}

export async function replyRadarPost(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const id = String(req.params.id || "");
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";

    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    if (!message) {
      res.status(400).json({ success: false, error: "Reply message is required" });
      return;
    }

    const post = await prisma.radarPost.findUnique({ where: { id } });
    if (!post) {
      res.status(404).json({ success: false, error: "Radar post not found" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: RADAR_USER_SELECT,
    });

    const newReply = {
      id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId,
      authorName: user?.displayName || user?.fullName || user?.username || "Campus Member",
      authorHandle: user?.username || "member",
      authorDept: user?.campus?.name || "Main Campus",
      authorAvatar: resolveUserAvatar(user),
      authorStoreSlug: resolveUserStoreSlug(user),
      isVerified: Boolean(user?.isEmailVerified),
      message,
      createdAt: new Date().toISOString(),
    };

    const existingReplies = Array.isArray(post.replies) ? (post.replies as any[]) : [];
    const nextReplies = [...existingReplies, newReply];

    await prisma.radarPost.update({
      where: { id },
      data: { replies: nextReplies as unknown as Prisma.InputJsonValue },
    });

    if (post.userId !== userId) {
      prisma.notification
        .create({
          data: {
            userId: post.userId,
            type: "radar",
            title: `New reply to your Radar request`,
            message: `${newReply.authorName}: ${message.slice(0, 100)}`,
            link: "/wanted",
          },
        })
        .catch(() => {});
    }

    res.status(200).json({
      success: true,
      data: {
        ...newReply,
        authorTime: "Just now",
      },
    });
  } catch (err) {
    console.error("[POST /radar/:id/replies] Error:", err);
    res.status(500).json({ success: false, error: "Failed to post reply" });
  }
}
