import type { NextFunction, Request, Response } from "express";

const OTP_WINDOW_SECONDS = 10 * 60; // 10 minutes
const OTP_MAX_PER_IP = 10;
const LOGIN_WINDOW_SECONDS = 15 * 60; // 15 minutes
const LOGIN_MAX_PER_IP = 30;
const LOGIN_MAX_PER_EMAIL = 15;

const localCounters = new Map<string, { count: number; expiresAt: number }>();

export function resetLocalRateLimitsForTest(): void {
  localCounters.clear();
}

function getClientIp(req: Request): string {
  // Prioritize trusted single-value edge headers or Express's proxy-aware req.ip
  // (governed by app.set("trust proxy", ...)) so attackers cannot spoof arbitrary
  // X-Forwarded-For chains to bypass IP rate limits.
  const cfIp = req.headers?.["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.trim()) {
    return cfIp.trim().toLowerCase();
  }
  const trueClientIp = req.headers?.["true-client-ip"];
  if (typeof trueClientIp === "string" && trueClientIp.trim()) {
    return trueClientIp.trim().toLowerCase();
  }
  if (req.ip && req.ip.trim()) {
    return req.ip.trim().toLowerCase();
  }
  return (req.socket?.remoteAddress || "unknown").toLowerCase();
}

function checkLocalCounter(
  key: string,
  limit: number,
  windowSeconds: number
): { allowed: boolean; count: number; retryAfterSeconds: number } {
  const now = Date.now();
  if (localCounters.size > 5000) {
    for (const [k, v] of localCounters) {
      if (v.expiresAt <= now) localCounters.delete(k);
    }
  }
  const existing = localCounters.get(key);
  if (!existing || existing.expiresAt <= now) {
    localCounters.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return { allowed: true, count: 1, retryAfterSeconds: windowSeconds };
  }
  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.expiresAt - now) / 1000));
  return { allowed: existing.count <= limit, count: existing.count, retryAfterSeconds };
}

async function checkUpstashOrLocal(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; count: number; retryAfterSeconds: number }> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Upstash Redis rate limiting is not configured in production.");
    }
    return checkLocalCounter(key, limit, windowSeconds);
  }

  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, String(windowSeconds), "NX"],
    ]),
  });
  if (!response.ok) {
    throw new Error(`Upstash rate limiter error: HTTP ${response.status}`);
  }
  const results = (await response.json()) as Array<{ result?: number }>;
  const count = Number(results?.[0]?.result || 0);
  return { allowed: count <= limit, count, retryAfterSeconds: windowSeconds };
}

/**
 * Per-IP rate limiter for OTP / signup / password-reset endpoints.
 * Fails CLOSED (503) if the distributed rate limiter is unavailable.
 */
export async function otpIpRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ip = getClientIp(req);
    const isTestLoopbackSignup =
      process.env.NODE_ENV === "test" &&
      req.path === "/sign-up" &&
      !req.headers["x-forwarded-for"] &&
      (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1");
    const limit = isTestLoopbackSignup ? 200 : OTP_MAX_PER_IP;
    const result = await checkUpstashOrLocal(`campusmarket:otp:ip:${ip}`, limit, OTP_WINDOW_SECONDS);
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      res.status(429).json({
        message: "Too many verification requests from this IP. Please try again later.",
        error: "rate_limit_exceeded",
      });
      return;
    }
    next();
  } catch (err: any) {
    console.error("[ALERT] [OTP RateLimit] Limiter unavailable; failing closed:", err?.message || err);
    res.status(503).json({
      message: "Verification service is temporarily unavailable. Please try again later.",
      error: "service_unavailable",
    });
  }
}

/**
 * Per-IP + email rate limiter for login.
 * Degrades to bounded in-memory per-instance rate limiting (never unlimited) if
 * Upstash Redis is unavailable in production so brute-force protection stays active
 * without locking out all users during a Redis outage.
 */
export async function loginRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = getClientIp(req);
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  try {
    const ipRes = await checkUpstashOrLocal(`campusmarket:login:ip:${ip}`, LOGIN_MAX_PER_IP, LOGIN_WINDOW_SECONDS);
    if (!ipRes.allowed) {
      res.setHeader("Retry-After", String(ipRes.retryAfterSeconds));
      res.status(429).json({ message: "Too many login attempts. Please try again later.", error: "rate_limit_exceeded" });
      return;
    }
    if (email) {
      const emailRes = await checkUpstashOrLocal(`campusmarket:login:email:${email}`, LOGIN_MAX_PER_EMAIL, LOGIN_WINDOW_SECONDS);
      if (!emailRes.allowed) {
        res.setHeader("Retry-After", String(emailRes.retryAfterSeconds));
        res.status(429).json({ message: "Too many login attempts. Please try again later.", error: "rate_limit_exceeded" });
        return;
      }
    }
    next();
  } catch (err: any) {
    console.error("[ALERT] [Login RateLimit] Distributed limiter unavailable; enforcing local fallback limits:", err?.message || err);
    const localIpRes = checkLocalCounter(`campusmarket:login:ip:${ip}`, LOGIN_MAX_PER_IP, LOGIN_WINDOW_SECONDS);
    if (!localIpRes.allowed) {
      res.setHeader("Retry-After", String(localIpRes.retryAfterSeconds));
      res.status(429).json({ message: "Too many login attempts. Please try again later.", error: "rate_limit_exceeded" });
      return;
    }
    if (email) {
      const localEmailRes = checkLocalCounter(`campusmarket:login:email:${email}`, LOGIN_MAX_PER_EMAIL, LOGIN_WINDOW_SECONDS);
      if (!localEmailRes.allowed) {
        res.setHeader("Retry-After", String(localEmailRes.retryAfterSeconds));
        res.status(429).json({ message: "Too many login attempts. Please try again later.", error: "rate_limit_exceeded" });
        return;
      }
    }
    next();
  }
}

export function createActionRateLimiter(options: {
  namespace: string;
  limit: number;
  windowSeconds: number;
  message: string;
}) {
  return async function actionRateLimiter(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (process.env.NODE_ENV === "test") {
      next();
      return;
    }
    const userId = (req as any).auth?.userId;
    const actorKey = userId ? `user:${userId}` : `ip:${getClientIp(req)}`;
    const key = `campusmarket:${options.namespace}:${actorKey}`;
    try {
      const result = await checkUpstashOrLocal(key, options.limit, options.windowSeconds);
      if (!result.allowed) {
        res.setHeader("Retry-After", String(result.retryAfterSeconds));
        res.status(429).json({
          success: false,
          message: options.message,
          error: "rate_limit_exceeded",
        });
        return;
      }
      next();
    } catch {
      const localRes = checkLocalCounter(key, options.limit, options.windowSeconds);
      if (!localRes.allowed) {
        res.setHeader("Retry-After", String(localRes.retryAfterSeconds));
        res.status(429).json({
          success: false,
          message: options.message,
          error: "rate_limit_exceeded",
        });
        return;
      }
      next();
    }
  };
}

export const listingCreateRateLimiter = createActionRateLimiter({
  namespace: "listing_create",
  limit: 10,
  windowSeconds: 10 * 60,
  message: "You are publishing listings too quickly. Please wait a few minutes and try again.",
});

export const storeCreateRateLimiter = createActionRateLimiter({
  namespace: "store_create",
  limit: 5,
  windowSeconds: 60 * 60,
  message: "Too many seller registration attempts. Please try again later.",
});

export const uploadActionRateLimiter = createActionRateLimiter({
  namespace: "upload_action",
  limit: 30,
  windowSeconds: 5 * 60,
  message: "Too many file upload requests. Please wait a moment and try again.",
});

export const radarReplyRateLimiter = createActionRateLimiter({
  namespace: "radar_reply",
  limit: 20,
  windowSeconds: 5 * 60,
  message: "You are replying too quickly on Campus Radar. Please wait a moment.",
});

export const messageWriteRateLimiter = createActionRateLimiter({
  namespace: "message_write",
  limit: 40,
  windowSeconds: 60,
  message: "You are sending messages too quickly. Please wait a moment.",
});

export const followWriteRateLimiter = createActionRateLimiter({
  namespace: "follow_write",
  limit: 25,
  windowSeconds: 60,
  message: "Too many follow/unfollow requests. Please slow down.",
});

export const orderWriteRateLimiter = createActionRateLimiter({
  namespace: "order_write",
  limit: 15,
  windowSeconds: 5 * 60,
  message: "Too many order requests. Please wait a few minutes.",
});

export const reviewWriteRateLimiter = createActionRateLimiter({
  namespace: "review_write",
  limit: 10,
  windowSeconds: 10 * 60,
  message: "Too many review submissions. Please wait a few minutes.",
});

export const supportReportRateLimiter = createActionRateLimiter({
  namespace: "support_report",
  limit: 8,
  windowSeconds: 15 * 60,
  message: "Too many support/report submissions from your connection. Please try again later.",
});

export const usernameCheckRateLimiter = createActionRateLimiter({
  namespace: "username_check",
  limit: 30,
  windowSeconds: 60,
  message: "Too many username availability checks. Please slow down.",
});
