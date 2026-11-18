import "dotenv/config";
import assert from "node:assert/strict";
import express from "express";
import request from "node:http";
import prisma from "../src/prisma.ts";
import { signup } from "../src/controllers/signup.controller.ts";
import { requestNewVerificationTokenCode } from "../src/controllers/verification-token.controller.ts";
import { resetEmailTransporterForTest } from "../src/services/email.service.ts";

async function callHandler(
  handler: any,
  { method = "POST", body = {}, params = {} }: { method?: string; body?: any; params?: Record<string, string> }
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const req: any = { method, body, params, headers: {}, cookies: {} };
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: any) {
        resolve({ status: statusCode, body: payload });
        return this;
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

async function main() {
  const email = `item4_mailsink_${Date.now()}@example.test`;
  const origSmtpHost = process.env.SMTP_HOST;
  const origSmtpPort = process.env.SMTP_PORT;

  try {
    // 1. Point SMTP to a closed port so sendOtpEmailService fails
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "19999";
    resetEmailTransporterForTest();

    const signupRes = await callHandler(signup, {
      method: "POST",
      body: { email, password: "TestPassword123!", fullName: "Mail Sink User" },
    });

    assert.equal(signupRes.status, 201, `Expected 201 when mail sink fails, got ${signupRes.status}`);
    const token = signupRes.body?.verification?.token;
    assert.ok(token, "Verification token must be returned");

    // Verify pending account and verification token are kept in DB (zero deleted rows)
    const dbUser = await prisma.user.findUnique({ where: { email } });
    assert.ok(dbUser, "Pending user must NOT be deleted when mail sink fails");
    assert.equal(dbUser.accountStatus, "PENDING");
    assert.equal(dbUser.isEmailVerified, false);

    const dbVt = await prisma.verificationToken.findUnique({ where: { token } });
    assert.ok(dbVt, "VerificationToken must NOT be deleted when mail sink fails");
    console.log("[PASS] Signup with failing mail sink kept PENDING user and VerificationToken without crashing");

    // 2. Restore SMTP to live Mailpit port 1025 and verify resend works immediately
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1025";
    resetEmailTransporterForTest();

    const resendRes = await callHandler(requestNewVerificationTokenCode, {
      method: "GET",
      params: { token },
    });
    assert.equal(resendRes.status, 200, `Expected resend to succeed (200), got ${resendRes.status}`);
    console.log("[PASS] Resend verification code succeeded after mail sink recovered");
  } finally {
    if (origSmtpHost !== undefined) process.env.SMTP_HOST = origSmtpHost;
    if (origSmtpPort !== undefined) process.env.SMTP_PORT = origSmtpPort;
    const u = await prisma.user.findUnique({ where: { email } });
    if (u) {
      await prisma.verificationToken.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[FAIL]", err);
  process.exit(1);
});
