import crypto from "crypto";

export async function generateVerificationToken(): Promise<string> {
  return `vt_${crypto.randomBytes(32).toString("base64url")}`;
}
