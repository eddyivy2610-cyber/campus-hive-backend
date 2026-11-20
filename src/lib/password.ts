import bcrypt from "bcrypt";
import argon2 from "argon2";

const BCRYPT_ROUNDS = 12;
const DUMMY_PASSWORD_SEED = "dummy_timing_equalization_password_placeholder_v1";
let dummyHashPromise: Promise<string> | null = null;

export function getDummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash(DUMMY_PASSWORD_SEED, BCRYPT_ROUNDS);
  }
  return dummyHashPromise;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) {
    return false;
  }
  if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$")) {
    return bcrypt.compare(password, storedHash);
  }
  if (storedHash.startsWith("$argon2id$")) {
    return argon2.verify(storedHash, password);
  }
  return false;
}
