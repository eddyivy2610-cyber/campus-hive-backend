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
    select: { name: true, logo: true, slug: true, campus: true, isVerified: true },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
} as const;

type RadarSelectedUser = Prisma.UserGetPayload<{ select: typeof RADAR_USER_SELECT }>;

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

/**
 * Resolves a reply author's display identity: when the replier owns an active store,
 * always present their Store profile (name, logo, slug, verification) — matching Messaging.
 */
function resolveReplyAuthorIdentity(user?: RadarSelectedUser | null) {
  const store = user?.stores?.[0];
  if (store) {
    return {
      authorName: store.name,
      authorHandle: store.slug || user?.username || "store",
      authorDept: store.campus || user?.campus?.name || "Campus Store",
      authorAvatar: store.logo || user?.profileImage || "",
      authorStoreSlug: store.slug || null,
      isVerified: Boolean(store.isVerified || user?.isEmailVerified),
    };
  }
  return {
    authorName: user?.displayName || user?.fullName || user?.username || "Campus Member",
    authorHandle: user?.username || "member",
    authorDept: user?.campus?.name || "Main Campus",
    authorAvatar: user?.profileImage || "",
    authorStoreSlug: null,
    isVerified: Boolean(user?.isEmailVerified),
  };
}

// Abuse limits for Campus Radar
const RADAR_MAX_REQUEST_CHARS = 500;
const RADAR_MAX_REPLY_CHARS = 500;
const RADAR_MAX_SHORT_FIELD_CHARS = 120;
const RADAR_MAX_REPLIES_PER_POST = 100;
const RADAR_MAX_REPLIES_PER_USER_PER_POST = 10;
const RADAR_MAX_POSTS_PER_HOUR = 5;

function cleanShortField(value: unknown, max = RADAR_MAX_SHORT_FIELD_CHARS): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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
          const hydrated = replyAuthor ? resolveReplyAuthorIdentity(replyAuthor) : null;
          const parentReply =
            typeof r.parentReplyId === "string" && r.parentReplyId
              ? rawReplies.find((cand) => cand?.id === r.parentReplyId)
              : null;
          const parentAuthor =
            parentReply && typeof parentReply.userId === "string"
              ? userMap.get(parentReply.userId)
              : undefined;
          const parentIdentity = parentAuthor ? resolveReplyAuthorIdentity(parentAuthor) : null;

          return {
            id: r.id,
            userId: r.userId,
            authorName: hydrated?.authorName || r.authorName,
            authorHandle: hydrated?.authorHandle || r.authorHandle,
            authorDept: hydrated?.authorDept || r.authorDept,
            authorAvatar: hydrated?.authorAvatar || r.authorAvatar || "",
            authorStoreSlug: hydrated ? hydrated.authorStoreSlug : r.authorStoreSlug || null,
            parentReplyId: typeof r.parentReplyId === "string" && r.parentReplyId ? r.parentReplyId : null,
            replyToName:
              (typeof r.replyToName === "string" && r.replyToName) ||
              parentIdentity?.authorName ||
              null,
            isVerified: hydrated ? hydrated.isVerified : Boolean(r.isVerified),
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
    if (requestText.length > RADAR_MAX_REQUEST_CHARS) {
      res.status(400).json({
        success: false,
        error: `Request must be ${RADAR_MAX_REQUEST_CHARS} characters or fewer.`,
      });
      return;
    }

    const recentPostCount = await prisma.radarPost.count({
      where: { userId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recentPostCount >= RADAR_MAX_POSTS_PER_HOUR) {
      res.status(429).json({
        success: false,
        error: "You're posting too quickly. Please wait a bit before posting another request.",
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: RADAR_USER_SELECT,
    });

    const location =
      cleanShortField(req.body?.location) ||
      cleanShortField(req.body?.campus) ||
      user?.campus?.name ||
      "Main Campus";
    const category = cleanShortField(req.body?.category, 40) || "all";
    const budget = cleanShortField(req.body?.budget, 40);

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
    if (!post || post.status !== "active") {
      res.status(404).json({ success: false, error: "Radar post not found." });
      return;
    }
    const rawReplies = Array.isArray(post.replies) ? (post.replies as any[]) : [];
    const singlePostUserIds = Array.from(
      new Set([
        post.userId,
        ...rawReplies.map((r) => (typeof r?.userId === "string" ? r.userId : "")).filter(Boolean),
      ])
    );
    const singlePostUsers = singlePostUserIds.length
      ? await prisma.user.findMany({
          where: { id: { in: singlePostUserIds } },
          select: RADAR_USER_SELECT,
        })
      : [];
    const singleUserMap = new Map(singlePostUsers.map((u) => [u.id, u]));
    const owner = singleUserMap.get(post.userId);
    res.status(200).json({
      success: true,
      data: {
        id: post.id,
        requesterName: owner?.displayName || owner?.fullName || owner?.username || "Campus Student",
        requesterHandle: owner?.username || "student",
        requesterLocation: post.location || owner?.campus?.name || post.campus || "Main Campus",
        requesterAvatar: resolveUserAvatar(owner),
        requesterStoreSlug: resolveUserStoreSlug(owner),
        isVerified: Boolean(owner?.isEmailVerified),
        requestText: post.requestText,
        category: post.category || "all",
        budget: post.budget || "",
        campus: post.campus || "Main Campus",
        timeAgo: formatTimeAgo(post.createdAt),
        replies: rawReplies.map((r) => {
          const replyAuthor = typeof r.userId === "string" ? singleUserMap.get(r.userId) : undefined;
          const hydrated = replyAuthor ? resolveReplyAuthorIdentity(replyAuthor) : null;
          return {
            id: r.id,
            authorName: hydrated?.authorName || r.authorName,
            authorHandle: hydrated?.authorHandle || r.authorHandle,
            authorDept: hydrated?.authorDept || r.authorDept,
            authorAvatar: hydrated?.authorAvatar || r.authorAvatar || "",
            authorStoreSlug: hydrated ? hydrated.authorStoreSlug : r.authorStoreSlug || null,
            parentReplyId: typeof r.parentReplyId === "string" && r.parentReplyId ? r.parentReplyId : null,
            replyToName: typeof r.replyToName === "string" && r.replyToName ? r.replyToName : null,
            isVerified: hydrated ? hydrated.isVerified : Boolean(r.isVerified),
            message: r.message,
            authorTime: formatTimeAgo(r.createdAt || post.createdAt),
          };
        }),
      },
    });
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
    if (message.length > RADAR_MAX_REPLY_CHARS) {
      res.status(400).json({
        success: false,
        error: `Reply must be ${RADAR_MAX_REPLY_CHARS} characters or fewer.`,
      });
      return;
    }

    const post = await prisma.radarPost.findUnique({ where: { id } });
    if (!post) {
      res.status(404).json({ success: false, error: "Radar post not found" });
      return;
    }

    const existingReplies = Array.isArray(post.replies) ? (post.replies as any[]) : [];
    if (existingReplies.length >= RADAR_MAX_REPLIES_PER_POST) {
      res.status(409).json({ success: false, error: "This request has reached the maximum number of replies." });
      return;
    }
    const userReplyCount = existingReplies.filter((r) => r?.userId === userId).length;
    if (userReplyCount >= RADAR_MAX_REPLIES_PER_USER_PER_POST) {
      res.status(429).json({
        success: false,
        error: "You've replied to this request too many times. Try messaging the poster instead.",
      });
      return;
    }

    const rawParentId =
      typeof req.body?.parentReplyId === "string" ? req.body.parentReplyId.trim() : "";
    let resolvedParentReplyId: string | null = null;
    let resolvedReplyToName: string | null = null;
    if (rawParentId) {
      const targetReply = existingReplies.find((r) => r?.id === rawParentId);
      if (!targetReply) {
        res.status(404).json({ success: false, error: "The reply you are responding to was not found." });
        return;
      }
      resolvedParentReplyId =
        typeof targetReply.parentReplyId === "string" && targetReply.parentReplyId
          ? targetReply.parentReplyId
          : String(targetReply.id);
      if (typeof targetReply.userId === "string" && targetReply.userId) {
        const targetOwner = await prisma.user.findUnique({
          where: { id: targetReply.userId },
          select: RADAR_USER_SELECT,
        });
        resolvedReplyToName = resolveReplyAuthorIdentity(targetOwner).authorName;
      } else {
        resolvedReplyToName =
          typeof targetReply.authorName === "string" && targetReply.authorName
            ? targetReply.authorName
            : null;
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: RADAR_USER_SELECT,
    });
    const authorIdentity = resolveReplyAuthorIdentity(user);

    const newReply = {
      id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId,
      authorName: authorIdentity.authorName,
      authorHandle: authorIdentity.authorHandle,
      authorDept: authorIdentity.authorDept,
      authorAvatar: authorIdentity.authorAvatar,
      authorStoreSlug: authorIdentity.authorStoreSlug,
      parentReplyId: resolvedParentReplyId,
      replyToName: resolvedReplyToName,
      isVerified: authorIdentity.isVerified,
      message,
      createdAt: new Date().toISOString(),
    };
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
