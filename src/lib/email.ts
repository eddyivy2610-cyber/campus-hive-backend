export function validateEmail(email: string): boolean {
  if (typeof email !== "string") return false;

  const trimmed = email.trim();
  if (!trimmed) return false;

  // RFC 5322-ish practical regex (covers the vast majority of real emails)
  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  if (trimmed.length > 254) return false;
  if (!emailRegex.test(trimmed)) return false;

  // Local part max length per RFC 5321
  const [local] = trimmed.split("@");
  if (local.length > 64) return false;

  // No consecutive dots, no leading/trailing dot in local part
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return false;
  }

  return true;
}