import Pusher from "pusher";

let pusherInstance: Pusher | null = null;

function getPusherConfig() {
  return {
    appId: process.env.PUSHER_APP_ID?.trim() || "",
    key: process.env.PUSHER_KEY?.trim() || process.env.NEXT_PUBLIC_PUSHER_KEY?.trim() || "",
    secret: process.env.PUSHER_SECRET?.trim() || "",
    cluster: process.env.PUSHER_CLUSTER?.trim() || process.env.NEXT_PUBLIC_PUSHER_CLUSTER?.trim() || "eu",
    useTLS: process.env.PUSHER_USE_TLS !== "false",
    host: process.env.PUSHER_HOST?.trim() || undefined,
    port: process.env.PUSHER_PORT ? Number(process.env.PUSHER_PORT) : undefined,
  };
}

export function isRealtimeConfigured(): boolean {
  const cfg = getPusherConfig();
  return Boolean(cfg.appId && cfg.key && cfg.secret);
}

export function getRealtimeServer(): Pusher | null {
  if (pusherInstance) return pusherInstance;

  const cfg = getPusherConfig();
  if (!cfg.appId || !cfg.key || !cfg.secret) {
    return null;
  }

  pusherInstance = new Pusher({
    appId: cfg.appId,
    key: cfg.key,
    secret: cfg.secret,
    cluster: cfg.cluster,
    useTLS: cfg.useTLS,
    ...(cfg.host ? { host: cfg.host } : {}),
    ...(cfg.port ? { port: cfg.port } : {}),
  });

  return pusherInstance;
}

export function authorizeChannel(
  socketId: string,
  channelName: string,
  user: { id: string; name?: string; avatar?: string; accountType?: string }
) {
  const pusher = getRealtimeServer();
  if (!pusher) return null;

  if (channelName.startsWith("presence-")) {
    return pusher.authorizeChannel(socketId, channelName, {
      user_id: user.id,
      user_info: {
        name: user.name || "Campus Member",
        avatar: user.avatar,
        accountType: user.accountType || "student",
      },
    });
  }

  return pusher.authorizeChannel(socketId, channelName);
}

export async function publishConversationEvent(
  conversationId: string,
  event: "new-message" | "deal-updated" | "offer-updated",
  payload: unknown
): Promise<void> {
  const pusher = getRealtimeServer();
  if (!pusher) return;

  try {
    await pusher.trigger(`private-conversation-${conversationId}`, event, payload);
  } catch (err) {
    console.warn(`[Realtime] Failed to publish ${event} on conversation ${conversationId}:`, err);
  }
}

export async function publishUserEvent(
  userId: string,
  event: "conversation-updated" | "notification",
  payload: unknown
): Promise<void> {
  const pusher = getRealtimeServer();
  if (!pusher) return;

  try {
    await pusher.trigger(`private-user-${userId}`, event, payload);
  } catch (err) {
    console.warn(`[Realtime] Failed to publish ${event} on user ${userId}:`, err);
  }
}
