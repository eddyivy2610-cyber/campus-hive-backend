import assert from "node:assert/strict";
import prisma from "../src/prisma.ts";
import { authenticate } from "../src/middlewares/auth.middleware.ts";
import { generateAccessToken } from "../src/services/token.service.ts";
import { otpIpRateLimiter, loginRateLimiter } from "../src/lib/rateLimit.ts";

async function callMw(mw: any, req: any): Promise<{ status: number; body: any; nextCalled: boolean }> {
  return new Promise((resolve) => {
    let statusCode = 200;
    let nextCalled = false;
    const res: any = {
      setHeader() {},
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: any) {
        resolve({ status: statusCode, body: payload, nextCalled });
        return this;
      },
    };
    Promise.resolve(
      mw(req, res, () => {
        nextCalled = true;
        resolve({ status: statusCode, body: null, nextCalled: true });
      })
    );
  });
}

async function main() {
  process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "test_access_secret_12345678901234567890";

  // 1. DB outage in authenticate middleware -> 503 (not 401)
  const validToken = generateAccessToken("user-1", "sess-1", 0);
  const origFindUnique = prisma.session.findUnique;
  (prisma.session as any).findUnique = async () => {
    throw new Error("ECONNREFUSED 127.0.0.1:5433");
  };
  try {
    const dbDownRes = await callMw(authenticate, {
      headers: { authorization: `Bearer ${validToken}` },
      cookies: {},
    });
    assert.equal(dbDownRes.status, 503, `Expected 503 on DB outage, got ${dbDownRes.status}`);
    assert.equal(dbDownRes.body?.error, "service_unavailable");
    console.log("[PASS] authenticate returns 503 on DB outage");
  } finally {
    (prisma.session as any).findUnique = origFindUnique;
  }

  // 2. Production rate-limiter unavailability: OTP fails closed (503), Login fails open (nextCalled=true)
  const origEnv = process.env.NODE_ENV;
  const origUrl = process.env.UPSTASH_REDIS_REST_URL;
  const origTok = process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.NODE_ENV = "production";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    const otpFailClosed = await callMw(otpIpRateLimiter, {
      headers: {},
      ip: "203.0.113.5",
      body: {},
    });
    assert.equal(otpFailClosed.status, 503);
    assert.equal(otpFailClosed.nextCalled, false);
    console.log("[PASS] otpIpRateLimiter fails closed (503) when Redis unavailable in production");

    const loginFailOpen = await callMw(loginRateLimiter, {
      headers: {},
      ip: "203.0.113.5",
      body: { email: "user@example.test" },
    });
    assert.equal(loginFailOpen.nextCalled, true);

    let blockedOnFallback = false;
    for (let i = 0; i < 20; i++) {
      const attempt = await callMw(loginRateLimiter, {
        headers: {},
        ip: "203.0.113.5",
        body: { email: "user@example.test" },
      });
      if (attempt.status === 429) {
        blockedOnFallback = true;
        break;
      }
    }
    assert.equal(blockedOnFallback, true, "Expected local fallback limiter to block excess login attempts");
    console.log("[PASS] loginRateLimiter degrades to local rate limit when Redis unavailable in production");
  } finally {
    process.env.NODE_ENV = origEnv;
    if (origUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = origUrl;
    if (origTok !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = origTok;
  }
}

main().catch((err) => {
  console.error("[FAIL]", err);
  process.exit(1);
});
