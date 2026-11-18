import { Response } from "express";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";

export async function createConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const participantId = String(req.body?.participantId || "").trim();
    if (!participantId || participantId === userId) {
      res.status(400).json({ message: "Valid participantId is required", error: "bad_request" });
      return;
    }

    const otherUser = await prisma.user.findUnique({ where: { id: participantId }, select: { id: true } });
    if (!otherUser) {
      res.status(404).json({ message: "Participant not found", error: "not_found" });
      return;
    }

    const [participantA, participantB] = [userId, participantId].sort();
    const conv = await prisma.conversation.upsert({
      where: { participantA_participantB: { participantA, participantB } },
      update: {},
      create: { participantA, participantB },
    });

    res.status(201).json({ success: true, data: conv });
  } catch (err) {
    console.error("Create conversation error:", err);
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

    const conv = await prisma.conversation.findUnique({
      where: { id: convId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conv) {
      res.status(404).json({ message: "Conversation not found", error: "not_found" });
      return;
    }
    if (conv.participantA !== userId && conv.participantB !== userId) {
      res.status(403).json({ message: "Forbidden: not a conversation participant", error: "forbidden" });
      return;
    }

    res.status(200).json({ success: true, data: conv });
  } catch (err) {
    console.error("Get conversation error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function sendMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    const convId = String(req.params.id || "");
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }
    if (!content) {
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

    const msg = await prisma.message.create({
      data: {
        conversationId: convId,
        senderId: userId,
        content,
      },
    });
    res.status(201).json({ success: true, data: msg });
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
    const msg = await prisma.message.create({
      data: {
        conversationId: convId,
        senderId: userId,
        content: `[OFFER] NGN ${amount}${explanation ? `: ${explanation}` : ""}`,
      },
    });
    res.status(201).json({ success: true, data: { offer: { amount, explanation, messageId: msg.id } } });
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
    const safePrice = agreedPriceFormatted.replace(/₦/g, "NGN ");
    const msg = await prisma.message.create({
      data: {
        conversationId: convId,
        senderId: userId,
        content: `[DEAL] ${safePrice} ${agreedTerms}`.trim(),
      },
    });
    res.status(201).json({ success: true, data: { deal: { agreedPriceFormatted, agreedTerms, messageId: msg.id } } });
  } catch (err) {
    console.error("Create deal error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
