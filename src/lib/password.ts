import bcrypt from "bcrypt";
import argon2 from "argon2";

const DUMMY_PASSWORD_SEED = "dummy_timing_equalization_password_placeholder_v1";
let dummyHashPromise: Promise<string> | null = null;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function validatePasswordPolicy(password: unknown): { valid: boolean; error?: string } {
  if (typeof password !== "string" || !password) {
    return { valid: false, error: "Password is required." };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { valid: false, error: `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.` };
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { valid: false, error: "Password must contain both letters and numbers." };
  }
  return { valid: true };
}

export function getDummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash(DUMMY_PASSWORD_SEED, { type: argon2.argon2id });
  }
  return dummyHashPromise;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash || typeof password !== "string" || password.length > PASSWORD_MAX_LENGTH) {
    return false;
  }
  if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$")) {
    return bcrypt.compare(password, storedHash);
  }
  if (storedHash.startsWith("$argon2")) {
    return argon2.verify(storedHash, password);
  }
  return false;
}
