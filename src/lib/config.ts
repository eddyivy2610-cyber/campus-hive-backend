function resolveMaxStoresPerUser(): number {
  const raw = process.env.MAX_STORES_PER_USER;
  if (process.env.NODE_ENV === "production" && (raw === undefined || raw.trim() === "")) {
    throw new Error("BOOT FATAL: MAX_STORES_PER_USER environment variable is required in production.");
  }
  if (raw !== undefined && raw.trim() !== "") {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`BOOT FATAL: MAX_STORES_PER_USER must be a positive integer >= 1 (got '${raw}').`);
    }
    return parsed;
  }
  return 1;
}

export const MAX_STORES_PER_USER = resolveMaxStoresPerUser();

export const JWT_ISSUER = process.env.JWT_ISSUER || "campushive.edu.ng";
export const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "campushive-api";

export function getOtpPepper(): string {
  const pepper = process.env.OTP_HASH_PEPPER || process.env.OTP_PEPPER;
  if (process.env.NODE_ENV === "production" && (!pepper || pepper.trim() === "")) {
    throw new Error("BOOT FATAL: OTP_HASH_PEPPER environment variable is required in production.");
  }
  return pepper || "dev_only_otp_hmac_pepper_change_in_production";
}
