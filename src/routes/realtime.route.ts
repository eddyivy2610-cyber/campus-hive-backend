import { Router, Response } from "express";
import prisma from "../prisma.ts";
import { authenticate, AuthenticatedRequest } from "../middlewares/auth.middleware.ts";
import { authorizeChannel, isRealtimeConfigured } from "../services/realtime.service.ts";

const router = Router();

router.post("/auth", authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const socketId = typeof req.body?.socket_id === "string" ? req.body.socket_id.trim() : "";
    const channelName = typeof req.body?.channel_name === "string" ? req.body.channel_name.trim() : "";

    if (!socketId || !channelName) {
      res.status(400).json({ error: "Missing socket_id or channel_name" });
      return;
    }

    if (!isRealtimeConfigured()) {
      res.status(503).json({ error: "Realtime service not configured" });
      return;
    }

    // Enforce channel authorization rules
    if (channelName.startsWith("private-user-")) {
      const targetUserId = channelName.slice("private-user-".length);
      if (targetUserId !== userId) {
        res.status(403).json({ error: "Forbidden: cannot subscribe to another user's channel" });
        return;
      }
    } else if (
      channelName.startsWith("private-conversation-") ||
      channelName.startsWith("presence-conversation-")
    ) {
      const convId = channelName.startsWith("private-conversation-")
        ? channelName.slice("private-conversation-".length)
        : channelName.slice("presence-conversation-".length);

      const conv = await prisma.conversation.findUnique({
        where: { id: convId },
        select: { participantA: true, participantB: true },
      });

      if (!conv || (conv.participantA !== userId && conv.participantB !== userId)) {
        res.status(403).json({ error: "Forbidden: not a conversation participant" });
        return;
      }
    } else {
      res.status(403).json({ error: "Forbidden: unsupported channel" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, displayName: true, username: true, profileImage: true, role: true },
    });

    const authResponse = authorizeChannel(socketId, channelName, {
      id: userId,
      name: user?.displayName || user?.fullName || user?.username || "Campus Member",
      avatar: user?.profileImage || undefined,
      accountType: user?.role === "SELLER" ? "student_store" : "student",
    });

    if (!authResponse) {
      res.status(503).json({ error: "Realtime service unavailable" });
      return;
    }

    res.status(200).json(authResponse);
  } catch (err) {
    console.error("Realtime auth error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
