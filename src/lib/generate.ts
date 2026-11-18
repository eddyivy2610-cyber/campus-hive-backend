import crypto from "crypto";

export function generateNumericOtp(length = 6): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += String(crypto.randomInt(0, 10));
  }
  return result;
}

export function randomString(length: number): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

export function generateToken(prefix?: string): string {
  const timestamp = Date.now();
  const randomStr = randomString(16);
  const token = `${prefix || 'tk'}-${timestamp}-${randomStr}`;
  return token;
}
