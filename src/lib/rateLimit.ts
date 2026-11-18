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
  const fwd = req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return (raw?.split(",")[0]?.trim() || req.ip || req.socket?.remoteAddress || "unknown").toLowerCase();
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
    const now = Date.now();
    const existing = localCounters.get(key);
    if (!existing || existing.expiresAt <= now) {
      localCounters.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
      return { allowed: true, count: 1, retryAfterSeconds: windowSeconds };
    }
    existing.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.expiresAt - now) / 1000));
    return { allowed: existing.count <= limit, count: existing.count, retryAfterSeconds };
  }

  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, String(windowSeconds)],
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
 * Fails OPEN if the distributed rate limiter is unavailable so users are not locked out.
 */
export async function loginRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ip = getClientIp(req);
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
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
    console.error("[ALERT] [Login RateLimit] Limiter unavailable; failing open:", err?.message || err);
    next();
  }
}
