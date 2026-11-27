import crypto from "node:crypto";
import { getOtpPepper } from "./config.ts";

/**
 * Computes deterministic HMAC-SHA256 digest of an OTP using the server pepper.
 */
export function hashOtp(otp: string): string {
  return crypto.createHmac("sha256", getOtpPepper()).update(String(otp).trim()).digest("hex");
}

/**
 * Constant-time comparison of a candidate OTP against a stored HMAC-SHA256 hex digest.
 */
export function verifyOtp(otp: string, storedHash: string): boolean {
  if (!storedHash || typeof storedHash !== "string" || typeof otp !== "string") return false;
  const cleanOtp = otp.trim();
  if (!/^\d{6}$/.test(cleanOtp)) return false;
  const candidate = hashOtp(cleanOtp);
  const bufA = Buffer.from(candidate, "hex");
  const bufB = Buffer.from(storedHash, "hex");
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
