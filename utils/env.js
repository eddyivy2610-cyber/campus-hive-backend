import { z } from "zod";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Load .env from current directory or campus-hive-backend folder
dotenv.config();
if (!process.env.AUTH_SECRET) {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const backendEnvPath = path.resolve(__dirname, "../.env");
    if (fs.existsSync(backendEnvPath)) {
      dotenv.config({ path: backendEnvPath });
    }
  } catch {
    // Ignore fallback errors
  }
}

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z
    .string({
      required_error: "MONGODB_URI is required and cannot be empty",
    })
    .min(1, "MONGODB_URI cannot be empty"),
  AUTH_SECRET: z
    .string({
      required_error: "AUTH_SECRET is required and must be at least 32 characters",
    })
    .min(32, "AUTH_SECRET must be at least 32 characters long for cryptographic security"),
  SMTP_USER: z
    .string({
      required_error: "SMTP_USER is required for email verification dispatch",
    })
    .min(1, "SMTP_USER cannot be empty"),
  SMTP_PASSWORD: z
    .string({
      required_error: "SMTP_PASSWORD is required for email verification dispatch",
    })
    .min(1, "SMTP_PASSWORD cannot be empty"),
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().default(587),
  ADMIN_REGISTRATION_KEY: z
    .string({
      required_error: "ADMIN_REGISTRATION_KEY is required for admin suite security",
    })
    .min(1, "ADMIN_REGISTRATION_KEY cannot be empty"),
  // Sunset for legacy JWTs that lack iss/aud/sub (old Express signer, 7-day lifetime).
  // After this instant, verifyAuthClaims requires iss, aud and sub on every token.
  // Set to a past date (e.g. "1970-01-01T00:00:00Z") to close the window immediately.
  AUTH_LEGACY_TOKENS_UNTIL: z
    .string()
    .default("2026-10-28T00:00:00Z")
    .refine((v) => !Number.isNaN(Date.parse(v)), {
      message: "AUTH_LEGACY_TOKENS_UNTIL must be an ISO-8601 date",
    }),
});

export function validateEnv(customEnv) {
  const raw = customEnv || {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    MONGODB_URI: process.env.MONGODB_URI,
    AUTH_SECRET: process.env.AUTH_SECRET || process.env.JWT_SECRET,
    SMTP_USER: process.env.SMTP_USER || process.env.EMAIL_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD || process.env.EMAIL_PASSWORD,
    SMTP_HOST: process.env.SMTP_HOST || "smtp.gmail.com",
    SMTP_PORT: process.env.SMTP_PORT || "587",
    ADMIN_REGISTRATION_KEY: process.env.ADMIN_REGISTRATION_KEY,
    AUTH_LEGACY_TOKENS_UNTIL: process.env.AUTH_LEGACY_TOKENS_UNTIL || undefined,
  };

  const result = envSchema.safeParse(raw);

  if (!result.success) {
    console.error("\n==================================================================");
    console.error("❌ FATAL: Express Backend crashed on boot — Missing environment variables:");
    console.error("==================================================================");
    for (const issue of result.error.issues) {
      console.error(`  • [${issue.path.join(".")}] ${issue.message}`);
    }
    console.error("==================================================================\n");

    throw new Error(
      `FATAL: Express backend failed to boot: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
  }

  return result.data;
}

export const env = validateEnv();
