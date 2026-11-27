import { Response } from "express";
import { Prisma } from "../generated/prisma/client.ts";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";
import { publishConversationEvent, publishUserEvent } from "../services/realtime.service.ts";

const MESSAGE_ENVELOPE_PREFIX = "__CH_MSG__:";

interface StoredConversationMeta {
  __metaVersion?: number;
  context?: Record<string, any> | null;
  additionalContexts?: Record<string, any>[];
  isBannerCollapsed?: boolean;
  activeOffer?: Record<string, any> | null;
  trackedDeal?: Record<string, any> | null;
  reviews?: Record<string, any>[];
  readAtByUser?: Record<string, string>;
}

interface DecodedMessagePayload {
  clientMessageId?: string;
  type: "text" | "image" | "offer" | "system";
  text: string;
  attachment?: Record<string, any>;
  attachedContext?: Record<string, any>;
  offer?: Record<string, any>;
}

function encodeMessageContent(payload: DecodedMessagePayload): string {
  const needsEnvelope =
    Boolean(payload.clientMessageId) ||
    payload.type !== "text" ||
    Boolean(payload.attachment) ||
    Boolean(payload.attachedContext) ||
    Boolean(payload.offer);

  if (!needsEnvelope) {
    return payload.text;
  }

  return `${MESSAGE_ENVELOPE_PREFIX}${JSON.stringify(payload)}`;
}

function decodeMessageContent(rawContent: string): DecodedMessagePayload {
  if (rawContent.startsWith(MESSAGE_ENVELOPE_PREFIX)) {
    try {
      const parsed = JSON.parse(rawContent.slice(MESSAGE_ENVELOPE_PREFIX.length));
      if (parsed && typeof parsed === "object") {
        return {
          clientMessageId: typeof parsed.clientMessageId === "string" ? parsed.clientMessageId : undefined,
          type:
            parsed.type === "image" || parsed.type === "offer" || parsed.type === "system"
              ? parsed.type
              : "text",
          text: typeof parsed.text === "string" ? parsed.text : "",
          attachment: parsed.attachment && typeof parsed.attachment === "object" ? parsed.attachment : undefined,
          attachedContext:
            parsed.attachedContext && typeof parsed.attachedContext === "object" ? parsed.attachedContext : undefined,
          offer: parsed.offer && typeof parsed.offer === "object" ? parsed.offer : undefined,
        };
      }
    } catch {
      // Fallback to raw text
    }
  }

  if (rawContent.startsWith("[OFFER]")) {
    return { type: "offer", text: rawContent };
  }
  if (rawContent.startsWith("[DEAL]")) {
    return { type: "system", text: rawContent };
  }
  return { type: "text", text: rawContent };
}

function parseConversationMeta(rawContext: unknown): StoredConversationMeta {
  if (!rawContext || typeof rawContext !== "object" || Array.isArray(rawContext)) {
    return {
      __metaVersion: 1,
      context: null,
      additionalContexts: [],
      isBannerCollapsed: false,
      activeOffer: null,
      trackedDeal: null,
      reviews: [],
      readAtByUser: {},
    };
  }

  const obj = rawContext as Record<string, any>;
  if ("__metaVersion" in obj) {
    return {
      __metaVersion: 1,
      context: obj.context ?? null,
      additionalContexts: Array.isArray(obj.additionalContexts) ? obj.additionalContexts : [],
      isBannerCollapsed: Boolean(obj.isBannerCollapsed),
      activeOffer: obj.activeOffer ?? null,
      trackedDeal: obj.trackedDeal ?? null,
      reviews: Array.isArray(obj.reviews) ? obj.reviews : [],
      readAtByUser: obj.readAtByUser && typeof obj.readAtByUser === "object" ? obj.readAtByUser : {},
    };
  }

  // Legacy plain context object stored directly in Conversation.context
  return {
    __metaVersion: 1,
    context: obj,
    additionalContexts: [],
    isBannerCollapsed: false,
    activeOffer: null,
    trackedDeal: null,
    reviews: [],
    readAtByUser: {},
  };
}

function toJsonInput(meta: StoredConversationMeta): Prisma.InputJsonValue {
  return meta as unknown as Prisma.InputJsonValue;
}

function formatMessageDTO(msg: {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: Date;
}) {
  const decoded = decodeMessageContent(msg.content);
  return {
    id: msg.id,
    clientMessageId: decoded.clientMessageId,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    type: decoded.type,
    text: decoded.text,
    content: decoded.text,
    attachment: decoded.attachment,
    attachedContext: decoded.attachedContext,
    offer: decoded.offer,
    deliveryStatus: "delivered" as const,
    createdAt: msg.createdAt.toISOString(),
  };
}

const participantUserSelect = {
  id: true,
  fullName: true,
  displayName: true,
  username: true,
  profileImage: true,
  bio: true,
  role: true,
  isEmailVerified: true,
  createdAt: true,
  campus: { select: { name: true } },
  stores: {
    where: { status: "active" },
    select: { id: true, slug: true, name: true, description: true, logo: true, isVerified: true },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
} as const;

type SelectedUser = Prisma.UserGetPayload<{ select: typeof participantUserSelect }>;

function buildParticipantProfile(user: SelectedUser) {
  const store = user.stores?.[0];
  const isSeller = Boolean(store) || user.role === "SELLER";
  return {
    id: user.id,
    name: store?.name || user.displayName || user.fullName || user.username || "Campus Member",
    subtitle: store
      ? store.description || user.campus?.name || "Campus Store"
      : user.bio || user.campus?.name || "Campus Member",
    avatar: store?.logo || user.profileImage || undefined,
    isVerified: Boolean(user.isEmailVerified || store?.isVerified),
    accountType: (isSeller ? "student_store" : "student") as "student" | "student_store" | "approved_business",
    storeSlug: store?.slug || undefined,
    hasStore: Boolean(store),
    campusIdentityVerified: Boolean(user.isEmailVerified),
    businessApproved: Boolean(store?.isVerified),
    memberSince: String(user.createdAt.getFullYear()),
    campusLocation: user.campus?.name || "Main Campus",
  };
}

async function buildConversationDTO(
  conv: {
    id: string;
    participantA: string;
    participantB: string;
    storeId: string | null;
    context: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
    userA: SelectedUser;
    userB: SelectedUser;
    messages?: Array<{
      id: string;
      conversationId: string;
      senderId: string;
      content: string;
      createdAt: Date;
    }>;
  },
  viewerId: string,
  unreadCount = 0
) {
  const meta = parseConversationMeta(conv.context);
  const viewerProfile = conv.participantA === viewerId ? buildParticipantProfile(conv.userA) : buildParticipantProfile(conv.userB);
  const otherProfile = conv.participantA === viewerId ? buildParticipantProfile(conv.userB) : buildParticipantProfile(conv.userA);

  const lastRaw = conv.messages && conv.messages.length > 0 ? conv.messages[0] : null;
  const lastDecoded = lastRaw ? decodeMessageContent(lastRaw.content) : null;

  return {
    id: conv.id,
    storeId: conv.storeId ?? undefined,
    participants: [viewerProfile, otherProfile],
    otherParticipant: otherProfile,
    context: meta.context ?? null,
    additionalContexts: meta.additionalContexts ?? [],
    isBannerCollapsed: Boolean(meta.isBannerCollapsed),
    lastMessage: lastRaw && lastDecoded
      ? {
          text: lastDecoded.text || (lastDecoded.attachment ? "Sent an image" : ""),
          senderId: lastRaw.senderId,
          createdAt: lastRaw.createdAt.toISOString(),
          type: lastDecoded.type,
        }
      : null,
    unreadCount,
    activeOffer: meta.activeOffer ?? null,
    trackedDeal: meta.trackedDeal ?? null,
    reviews: meta.reviews ?? [],
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
  };
}

async function loadConversationWithUsers(convId: string) {
  return prisma.conversation.findUnique({
    where: { id: convId },
    include: {
      userA: { select: participantUserSelect },
      userB: { select: participantUserSelect },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

export async function createConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    let participantId = String(req.body?.participantId || "").trim();
    const storeIdInput = typeof req.body?.storeId === "string" ? req.body.storeId.trim() : "";
    const contextInput = req.body?.context && typeof req.body.context === "object" ? req.body.context : undefined;

    let resolvedStore: { id: string; ownerId: string; logo: string | null } | null = null;
    if (storeIdInput) {
      resolvedStore = await prisma.store.findFirst({
        where: { OR: [{ id: storeIdInput }, { slugLower: storeIdInput.toLowerCase() }] },
        select: { id: true, ownerId: true, logo: true },
      });
      if (resolvedStore?.ownerId) {
        participantId = resolvedStore.ownerId;
      }
    }

    if (!participantId || participantId === userId) {
      res.status(400).json({ message: "Valid participantId is required", error: "bad_request" });
      return;
    }

    const otherUser = await prisma.user.findUnique({
      where: { id: participantId },
      select: { id: true },
    });
    if (!otherUser) {
      res.status(404).json({ message: "Participant not found", error: "not_found" });
      return;
    }

    const [participantA, participantB] = [userId, participantId].sort();
    const existing = await prisma.conversation.findUnique({
      where: { participantA_participantB: { participantA, participantB } },
    });

    const nextMeta = parseConversationMeta(existing?.context);
    if (contextInput) {
      if (nextMeta.context && nextMeta.context.contextId && nextMeta.context.contextId !== contextInput.contextId) {
        const alreadyListed = (nextMeta.additionalContexts || []).some(
          (c) => c.contextId === nextMeta.context?.contextId
        );
        if (!alreadyListed) {
          nextMeta.additionalContexts = [nextMeta.context, ...(nextMeta.additionalContexts || [])].slice(0, 10);
        }
      }
      nextMeta.context = {
        ...contextInput,
        attachedAt: contextInput.attachedAt || new Date().toISOString(),
      };
    }

    const conv = await prisma.conversation.upsert({
      where: { participantA_participantB: { participantA, participantB } },
      update: {
        ...(resolvedStore?.id ? { storeId: resolvedStore.id } : {}),
        ...(contextInput ? { context: toJsonInput(nextMeta) } : {}),
      },
      create: {
        participantA,
        participantB,
        ...(resolvedStore?.id ? { storeId: resolvedStore.id } : {}),
        ...(contextInput ? { context: toJsonInput(nextMeta) } : {}),
      },
      include: {
        userA: { select: participantUserSelect },
        userB: { select: participantUserSelect },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    const dto = await buildConversationDTO(conv, userId, 0);
    res.status(201).json({
      success: true,
      conversation: dto,
      data: dto,
    });
  } catch (err) {
    console.error("Create conversation error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Resolve a chat participant's public identity on the server.
 * Accepts a user ID, store ID, or store slug. Used to render draft chats so the
 * client never trusts names, avatars, or verified badges passed through URLs.
 */
export async function getParticipantProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const ref = String(req.params.id || "").trim();
    if (!ref || ref.length > 120) {
      res.status(400).json({ message: "Valid participant reference is required", error: "bad_request" });
      return;
    }

    let targetUserId = ref;
    const store = await prisma.store.findFirst({
      where: { OR: [{ id: ref }, { slugLower: ref.toLowerCase() }], status: "active" },
      select: { ownerId: true },
    });
    if (store?.ownerId) targetUserId = store.ownerId;

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: participantUserSelect,
    });
    if (!target) {
      res.status(404).json({ message: "Participant not found", error: "not_found" });
      return;
    }

    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ success: true, data: buildParticipantProfile(target) });
  } catch (err) {
    console.error("Get participant profile error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function getConversationMessages(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const convId = String(req.params.id || "");
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || "50"), 10) || 50));
    const skip = (page - 1) * limit;

    const conv = await prisma.conversation.findUnique({
      where: { id: convId },
      include: {
        userA: { select: participantUserSelect },
        userB: { select: participantUserSelect },
      },
    });
    if (!conv) {
      res.status(404).json({ message: "Conversation not found", error: "not_found" });
      return;
    }
    if (conv.participantA !== userId && conv.participantB !== userId) {
      res.status(403).json({ message: "Forbidden: not a conversation participant", error: "forbidden" });
      return;
    }

    // Mark as read for viewer
    const meta = parseConversationMeta(conv.context);
    meta.readAtByUser = { ...(meta.readAtByUser || {}), [userId]: new Date().toISOString() };
    await prisma.conversation.update({
      where: { id: convId },
      data: { context: toJsonInput(meta) },
    });

    const [totalMessages, descMessages] = await Promise.all([
      prisma.message.count({ where: { conversationId: convId } }),
      prisma.message.findMany({
        where: { conversationId: convId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: limit,
      }),
    ]);

    const ordered = descMessages.reverse();
    const formattedMessages = ordered.map(formatMessageDTO);
    const latestMsg = ordered.length > 0 ? ordered[ordered.length - 1] : null;
    const convDto = await buildConversationDTO(
      { ...conv, context: meta as unknown as Prisma.JsonValue, messages: latestMsg ? [latestMsg] : [] },
      userId,
      0
    );

    res.status(200).json({
      success: true,
      conversation: convDto,
      messages: formattedMessages,
      totalMessages,
      hasOlderMessages: skip + descMessages.length < totalMessages,
      data: {
        conversation: convDto,
        messages: formattedMessages,
        totalMessages,
        hasOlderMessages: skip + descMessages.length < totalMessages,
      },
    });
  } catch (err) {
    console.error("Get conversation error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function getMessagesCursor(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const convId = String(req.params.id || "");
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const conv = await prisma.conversation.findUnique({ where: { id: convId } });
    if (!conv) {
      res.status(404).json({ message: "Conversation not found", error: "not_found" });
      return;
    }
    if (conv.participantA !== userId && conv.participantB !== userId) {
      res.status(403).json({ message: "Forbidden: not a conversation participant", error: "forbidden" });
      return;
    }

    const sinceId = typeof req.query.sinceId === "string" ? req.query.sinceId.trim() : "";
    const beforeId =
      typeof req.query.before === "string"
        ? req.query.before.trim()
        : typeof req.query.cursor === "string"
        ? req.query.cursor.trim()
        : "";
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || "50"), 10) || 50));

    if (sinceId) {
      const pivot = await prisma.message.findUnique({
        where: { id: sinceId },
        select: { createdAt: true },
      });
      if (pivot) {
        const newer = await prisma.message.findMany({
          where: {
            conversationId: convId,
            createdAt: { gt: pivot.createdAt },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: limit,
        });
        res.status(200).json({
          success: true,
          conversationId: convId,
          sinceId,
          messages: newer.map(formatMessageDTO),
        });
        return;
      }
    }

    if (beforeId) {
      const pivot = await prisma.message.findUnique({
        where: { id: beforeId },
        select: { createdAt: true },
      });
      if (pivot) {
        const olderDesc = await prisma.message.findMany({
          where: {
            conversationId: convId,
            createdAt: { lt: pivot.createdAt },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        });
        const hasOlderMessages = olderDesc.length > limit;
        const pageSlice = olderDesc.slice(0, limit).reverse();
        res.status(200).json({
          success: true,
          conversationId: convId,
          messages: pageSlice.map(formatMessageDTO),
          hasOlderMessages,
        });
        return;
      }
    }

    const recentDesc = await prisma.message.findMany({
      where: { conversationId: convId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasOlderMessages = recentDesc.length > limit;
    const pageSlice = recentDesc.slice(0, limit).reverse();
    res.status(200).json({
      success: true,
      conversationId: convId,
      messages: pageSlice.map(formatMessageDTO),
      hasOlderMessages,
    });
  } catch (err) {
    console.error("Get messages cursor error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function updateConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const convId = String(req.params.id || "");
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const conv = await loadConversationWithUsers(convId);
    if (!conv) {
      res.status(404).json({ message: "Conversation not found", error: "not_found" });
      return;
    }
    if (conv.participantA !== userId && conv.participantB !== userId) {
      res.status(403).json({ message: "Forbidden: not a conversation participant", error: "forbidden" });
      return;
    }

    const meta = parseConversationMeta(conv.context);
    if (typeof req.body?.collapsed === "boolean") {
      meta.isBannerCollapsed = req.body.collapsed;
    }
    if (typeof req.body?.contextStatus === "string" && meta.context) {
      meta.context = { ...meta.context, status: req.body.contextStatus };
    }

    const updated = await prisma.conversation.update({
      where: { id: convId },
      data: { context: toJsonInput(meta) },
      include: {
        userA: { select: participantUserSelect },
        userB: { select: participantUserSelect },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    const dto = await buildConversationDTO(updated, userId, 0);
    res.status(200).json({ success: true, conversation: dto, data: dto });
  } catch (err) {
    console.error("Update conversation error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function sendMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const convId = String(req.params.id || "");
    const rawText =
      typeof req.body?.text === "string"
        ? req.body.text.trim()
        : typeof req.body?.content === "string"
        ? req.body.content.trim()
        : "";
    const clientMessageId =
      typeof req.body?.clientMessageId === "string" ? req.body.clientMessageId.trim() : undefined;
    const attachment =
      req.body?.attachment && typeof req.body.attachment === "object" ? req.body.attachment : undefined;
    const attachedContext =
      req.body?.attachedContext && typeof req.body.attachedContext === "object" ? req.body.attachedContext : undefined;

    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }
    if (!rawText && !attachment) {
      res.status(400).json({ message: "Message content is required", error: "bad_request" });
      return;
    }

    const conv = await prisma.conversation.findUnique({ where: { id: convId } });
    if (!conv) {
      res.status(404).json({ message: "Conversation not found", error: "not_found" });
      return;
    }
    if (conv.participantA !== userId && conv.participantB !== userId) {
      res.status(403).json({ message: "Forbidden: not a conversation participant", error: "forbidden" });
      return;
    }

    // Deduplicate by clientMessageId if present
    if (clientMessageId) {
      const recent = await prisma.message.findMany({
        where: { conversationId: convId, senderId: userId },
        orderBy: { createdAt: "desc" },
        take: 15,
      });
      const dup = recent.find((m) => decodeMessageContent(m.content).clientMessageId === clientMessageId);
      if (dup) {
        const refreshed = await loadConversationWithUsers(convId);
        const convDto = refreshed ? await buildConversationDTO(refreshed, userId, 0) : null;
        const msgDto = formatMessageDTO(dup);
        res.status(200).json({ success: true, message: msgDto, conversation: convDto, data: msgDto });
        return;
      }
    }

    const encodedContent = encodeMessageContent({
      clientMessageId,
      type: attachment && !rawText ? "image" : "text",
      text: rawText,
      attachment,
      attachedContext,
    });

    const msg = await prisma.message.create({
      data: {
        conversationId: convId,
        senderId: userId,
        content: encodedContent,
      },
    });

    const meta = parseConversationMeta(conv.context);
    meta.readAtByUser = { ...(meta.readAtByUser || {}), [userId]: new Date().toISOString() };
    if (attachedContext) {
      meta.context = { ...attachedContext, attachedAt: attachedContext.attachedAt || new Date().toISOString() };
    }

    const updatedConv = await prisma.conversation.update({
      where: { id: convId },
      data: {
        context: toJsonInput(meta),
        updatedAt: new Date(),
      },
      include: {
        userA: { select: participantUserSelect },
        userB: { select: participantUserSelect },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    const recipientId = conv.participantA === userId ? conv.participantB : conv.participantA;
    const senderProfile =
      conv.participantA === userId
        ? buildParticipantProfile(updatedConv.userA)
        : buildParticipantProfile(updatedConv.userB);

    prisma.notification
      .create({
        data: {
          userId: recipientId,
          type: "message",
          title: `New message from ${senderProfile.name}`,
          message: rawText ? rawText.slice(0, 120) : "Sent an attachment",
          link: `/messages?conversation=${convId}`,
        },
      })
      .catch(() => {});

    const msgDto = formatMessageDTO(msg);
    const convDto = await buildConversationDTO(updatedConv, userId, 0);
    const recipientConvDto = await buildConversationDTO(updatedConv, recipientId, 1);

    void publishConversationEvent(convId, "new-message", {
      message: msgDto,
    });
    void publishUserEvent(recipientId, "conversation-updated", {
      conversation: recipientConvDto,
    });

    res.status(201).json({
      success: true,
      message: msgDto,
      conversation: convDto,
      data: msgDto,
    });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function createOffer(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const convId = String(req.params.id || "");
    const amount = Number(req.body?.amount);
    const explanation = typeof req.body?.explanation === "string" ? req.body.explanation.trim() : "";

    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ message: "Valid positive offer amount is required", error: "bad_request" });
      return;
    }

    const conv = await prisma.conversation.findUnique({ where: { id: convId } });
    if (!conv) {
      res.status(404).json({ message: "Conversation not found", error: "not_found" });
      return;
    }
    if (conv.participantA !== userId && conv.participantB !== userId) {
      res.status(403).json({ message: "Forbidden: not a conversation participant", error: "forbidden" });
      return;
    }

    const meta = parseConversationMeta(conv.context);
    const otherId = conv.participantA === userId ? conv.participantB : conv.participantA;
    const nowIso = new Date().toISOString();
    const offer = {
      id: `offer-${Date.now()}`,
      conversationId: convId,
      contextType: req.body?.contextType || meta.context?.contextType || "product",
      contextId: req.body?.contextId || meta.context?.contextId || convId,
      title: req.body?.title || meta.context?.title || "Campus Listing",
      requesterId: userId,
      sellerId: otherId,
      proposerId: userId,
      amount,
      amountFormatted: `₦${amount.toLocaleString()}`,
      explanation,
      conditionOrAvailability: req.body?.conditionOrAvailability,
      meetupDetails: req.body?.meetupDetails,
      status: "Pending",
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const msg = await prisma.message.create({
      data: {
        conversationId: convId,
        senderId: userId,
        content: encodeMessageContent({
          type: "offer",
          text: `Offer: ₦${amount.toLocaleString()}${explanation ? ` — ${explanation}` : ""}`,
          offer,
        }),
      },
    });

    meta.activeOffer = offer;
    if (meta.context) {
      meta.context = { ...meta.context, status: "Offer pending" };
    }
    const updatedConv = await prisma.conversation.update({
      where: { id: convId },
      data: { context: toJsonInput(meta), updatedAt: new Date() },
      include: {
        userA: { select: participantUserSelect },
        userB: { select: participantUserSelect },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    const msgDto = formatMessageDTO(msg);
    const convDto = await buildConversationDTO(updatedConv, userId, 0);
    const recipientConvDto = await buildConversationDTO(updatedConv, otherId, 1);

    void publishConversationEvent(convId, "offer-updated", offer);
    void publishConversationEvent(convId, "new-message", {
      message: msgDto,
    });
    void publishUserEvent(otherId, "conversation-updated", {
      conversation: recipientConvDto,
    });

    res.status(201).json({
      success: true,
      offer,
      message: msgDto,
      conversation: convDto,
      data: { offer, message: msgDto, conversation: convDto },
    });
  } catch (err) {
    console.error("Create offer error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function createDeal(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const convId = String(req.params.id || "");
    const agreedPriceFormatted =
      typeof req.body?.agreedPriceFormatted === "string" ? req.body.agreedPriceFormatted.trim() : "";
    const agreedTerms =
      typeof req.body?.agreedTerms === "string" ? req.body.agreedTerms.trim() : "";
    const expectedMeetupDate =
      typeof req.body?.expectedMeetupDate === "string" ? req.body.expectedMeetupDate.trim() : undefined;

    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const conv = await prisma.conversation.findUnique({ where: { id: convId } });
    if (!conv) {
      res.status(404).json({ message: "Conversation not found", error: "not_found" });
      return;
    }
    if (conv.participantA !== userId && conv.participantB !== userId) {
      res.status(403).json({ message: "Forbidden: not a conversation participant", error: "forbidden" });
      return;
    }

    const meta = parseConversationMeta(conv.context);
    const otherId = conv.participantA === userId ? conv.participantB : conv.participantA;
    const nowIso = new Date().toISOString();
    const deal = {
      id: `deal-${Date.now()}`,
      conversationId: convId,
      storeId: conv.storeId ?? undefined,
      contextType: meta.context?.contextType,
      contextId: meta.context?.contextId,
      resourceTitle: meta.context?.title || "Campus Exchange",
      buyerId: userId,
      sellerId: otherId,
      initiatedById: userId,
      agreedPriceFormatted: agreedPriceFormatted || meta.context?.priceFormatted || "Agreed price",
      agreedTerms: agreedTerms || "Meet on campus and inspect item",
      expectedMeetupDate,
      status: "In progress",
      participantResponses: {},
      isMutuallyConfirmed: false,
      hasConflict: false,
      checkInTriggered: false,
      reminderCount: 0,
      remindersStopped: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const msg = await prisma.message.create({
      data: {
        conversationId: convId,
        senderId: userId,
        content: encodeMessageContent({
          type: "system",
          text: `Deal tracking started: ${deal.agreedPriceFormatted} (${deal.agreedTerms})`,
        }),
      },
    });

    meta.trackedDeal = deal;
    const updatedConv = await prisma.conversation.update({
      where: { id: convId },
      data: { context: toJsonInput(meta), updatedAt: new Date() },
      include: {
        userA: { select: participantUserSelect },
        userB: { select: participantUserSelect },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    const msgDto = formatMessageDTO(msg);
    const convDto = await buildConversationDTO(updatedConv, userId, 0);
    const recipientConvDto = await buildConversationDTO(updatedConv, otherId, 1);

    void publishConversationEvent(convId, "deal-updated", deal);
    void publishConversationEvent(convId, "new-message", {
      message: msgDto,
    });
    void publishUserEvent(otherId, "conversation-updated", {
      conversation: recipientConvDto,
    });

    res.status(201).json({
      success: true,
      deal,
      systemMessage: msgDto,
      conversation: convDto,
      data: { deal, systemMessage: msgDto, conversation: convDto },
    });
  } catch (err) {
    console.error("Create deal error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function updateDealCheckIn(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const convId = String(req.params.id || "");
    const choice = req.body?.choice as "Completed" | "Still arranging" | "Didn't happen" | undefined;

    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }
    if (!choice || !["Completed", "Still arranging", "Didn't happen"].includes(choice)) {
      res.status(400).json({ message: "Valid check-in choice is required", error: "bad_request" });
      return;
    }

    const conv = await prisma.conversation.findUnique({ where: { id: convId } });
    if (!conv) {
      res.status(404).json({ message: "Conversation not found", error: "not_found" });
      return;
    }
    if (conv.participantA !== userId && conv.participantB !== userId) {
      res.status(403).json({ message: "Forbidden: not a conversation participant", error: "forbidden" });
      return;
    }

    const meta = parseConversationMeta(conv.context);
    const otherId = conv.participantA === userId ? conv.participantB : conv.participantA;
    const nowIso = new Date().toISOString();

    const existingDeal = meta.trackedDeal || {
      id: `deal-${Date.now()}`,
      conversationId: convId,
      storeId: conv.storeId ?? undefined,
      contextType: meta.context?.contextType,
      contextId: meta.context?.contextId,
      resourceTitle: meta.context?.title || "Campus Exchange",
      buyerId: userId,
      sellerId: otherId,
      initiatedById: userId,
      agreedPriceFormatted: meta.context?.priceFormatted || "Agreed price",
      agreedTerms: "Campus meetup",
      status: "In progress",
      participantResponses: {},
      isMutuallyConfirmed: false,
      hasConflict: false,
      checkInTriggered: true,
      reminderCount: 0,
      remindersStopped: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const responses: Record<string, string> = {
      ...(existingDeal.participantResponses || {}),
      [userId]: choice,
    };
    const otherChoice = responses[otherId];

    let status = "In progress";
    let isMutuallyConfirmed = false;
    let hasConflict = false;

    if (choice === "Completed" && otherChoice === "Completed") {
      status = "Completed";
      isMutuallyConfirmed = true;
    } else if (choice === "Didn't happen" && otherChoice === "Didn't happen") {
      status = "Didn't happen / Cancelled";
    } else if (
      (choice === "Completed" && otherChoice === "Didn't happen") ||
      (choice === "Didn't happen" && otherChoice === "Completed")
    ) {
      status = "Needs clarification";
      hasConflict = true;
    } else if (choice === "Completed" || otherChoice === "Completed") {
      status = "Needs confirmation";
    }

    const updatedDeal = {
      ...existingDeal,
      participantResponses: responses,
      status,
      isMutuallyConfirmed,
      hasConflict,
      checkInTriggered: true,
      updatedAt: nowIso,
    };

    meta.trackedDeal = updatedDeal;
    if (isMutuallyConfirmed && meta.context) {
      meta.context = { ...meta.context, status: "Deal completed" };
    }

    const msg = await prisma.message.create({
      data: {
        conversationId: convId,
        senderId: userId,
        content: encodeMessageContent({
          type: "system",
          text: `Deal check-in updated: ${choice} (${status})`,
        }),
      },
    });

    const updatedConv = await prisma.conversation.update({
      where: { id: convId },
      data: { context: toJsonInput(meta), updatedAt: new Date() },
      include: {
        userA: { select: participantUserSelect },
        userB: { select: participantUserSelect },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    const msgDto = formatMessageDTO(msg);
    const convDto = await buildConversationDTO(updatedConv, userId, 0);
    const recipientConvDto = await buildConversationDTO(updatedConv, otherId, 1);

    void publishConversationEvent(convId, "deal-updated", updatedDeal);
    void publishConversationEvent(convId, "new-message", {
      message: msgDto,
    });

    res.status(200).json({
      success: true,
      deal: updatedDeal,
      systemMessage: msgDto,
      conversation: convDto,
      data: { deal: updatedDeal, systemMessage: msgDto, conversation: convDto },
    });
  } catch (err) {
    console.error("Update deal check-in error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function createDealReview(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const convId = String(req.params.id || "");
    const rating = Number(req.body?.rating);
    const tags = Array.isArray(req.body?.tags) ? req.body.tags.map(String) : [];
    const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : undefined;

    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ message: "Rating between 1 and 5 is required", error: "bad_request" });
      return;
    }

    const conv = await loadConversationWithUsers(convId);
    if (!conv) {
      res.status(404).json({ message: "Conversation not found", error: "not_found" });
      return;
    }
    if (conv.participantA !== userId && conv.participantB !== userId) {
      res.status(403).json({ message: "Forbidden: not a conversation participant", error: "forbidden" });
      return;
    }

    const meta = parseConversationMeta(conv.context);
    const reviewer = conv.participantA === userId ? conv.userA : conv.userB;
    const revieweeId = conv.participantA === userId ? conv.participantB : conv.participantA;
    const review = {
      id: `rev-${Date.now()}`,
      dealId: meta.trackedDeal?.id || convId,
      conversationId: convId,
      storeId: conv.storeId ?? undefined,
      reviewerId: userId,
      reviewerName: reviewer.displayName || reviewer.fullName || reviewer.username,
      revieweeId,
      rating,
      tags,
      comment,
      moderationStatus: "approved" as const,
      createdAt: new Date().toISOString(),
    };

    meta.reviews = [...(meta.reviews || []), review];
    const updatedConv = await prisma.conversation.update({
      where: { id: convId },
      data: { context: toJsonInput(meta), updatedAt: new Date() },
      include: {
        userA: { select: participantUserSelect },
        userB: { select: participantUserSelect },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    const convDto = await buildConversationDTO(updatedConv, userId, 0);
    res.status(201).json({
      success: true,
      review,
      conversation: convDto,
      data: { review, conversation: convDto },
    });
  } catch (err) {
    console.error("Create deal review error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function listConversations(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const rawLimit = Number.parseInt(String(req.query.limit || "30"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 30;
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const filterParam = typeof req.query.filter === "string" ? req.query.filter : "all";
    const storeIdFilter = typeof req.query.storeId === "string" ? req.query.storeId.trim() : "";

    const viewer = await prisma.user.findUnique({
      where: { id: userId },
      select: participantUserSelect,
    });

    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [{ participantA: userId }, { participantB: userId }],
        ...(storeIdFilter ? { storeId: storeIdFilter } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: {
        userA: { select: participantUserSelect },
        userB: { select: participantUserSelect },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    const dtos = await Promise.all(
      conversations.map(async (conv) => {
        const meta = parseConversationMeta(conv.context);
        const lastReadIso = meta.readAtByUser?.[userId];
        const unreadCount = await prisma.message.count({
          where: {
            conversationId: conv.id,
            senderId: { not: userId },
            ...(lastReadIso ? { createdAt: { gt: new Date(lastReadIso) } } : {}),
          },
        });
        return buildConversationDTO(conv, userId, unreadCount);
      })
    );

    const filtered = dtos.filter((c) => {
      if (filterParam === "unread" && c.unreadCount <= 0) return false;
      if (filterParam === "offers" && !c.activeOffer) return false;
      if (q) {
        const haystack = [
          c.otherParticipant?.name,
          c.context?.title,
          c.lastMessage?.text,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    res.status(200).json({
      success: true,
      currentUser: viewer ? buildParticipantProfile(viewer) : undefined,
      conversations: filtered,
      data: filtered,
    });
  } catch (err) {
    console.error("List conversations error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
