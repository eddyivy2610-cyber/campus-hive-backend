import { isReservedIdentityName, normalizeDisplayNameWhitespace } from "./nameValidation.ts";
import { CAMPUS_COLLECTION, ConfidentialSafetyLocation } from "./campuses.ts";

export const LISTING_TITLE_MIN_LENGTH = 3;
export const LISTING_TITLE_MAX_LENGTH = 120;
export const LISTING_DESCRIPTION_MIN_LENGTH = 10;
export const LISTING_DESCRIPTION_MAX_LENGTH = 3000;
export const LISTING_MAX_PRICE_NGN = 50_000_000;
export const LISTING_MAX_IMAGES = 8;
export const MAX_ACTIVE_LISTINGS_PER_STORE = 200;

export const STORE_NAME_MIN_LENGTH = 3;
export const STORE_NAME_MAX_LENGTH = 60;
export const STORE_DESCRIPTION_MAX_LENGTH = 1000;
export const STORE_LOCATION_MAX_LENGTH = 160;

export const ALLOWED_LISTING_CATEGORIES = new Set([
  "Laptops & Computers",
  "Phones & Tablets",
  "Fashion & Clothing",
  "Books & Academics",
  "Hostel & Furniture",
  "Electronics & Audio",
  "Services",
  "Design & Printing",
  "Tech & Repairs",
  "Hair & Beauty",
  "Academic Tutoring & Writing",
  "Photography & Video",
  "Cleaning & Errand",
  // Legacy / general compatibility categories
  "Electronics",
  "Fashion",
  "Academics",
  "Food & Pastries",
  "Beauty & Personal Care",
  "Sports & Fitness",
  "General",
  "Other",
]);

export const ALLOWED_PRODUCT_CONDITIONS = new Set([
  "Brand New",
  "Like New",
  "Used - Excellent",
  "Used - Good",
  "Used - Fair",
]);

export const SELLER_ALLOWED_LISTING_STATUSES = new Set([
  "active",
  "paused",
  "sold",
  "draft",
]);

export const MODERATION_LOCKED_LISTING_STATUSES = new Set([
  "rejected",
  "removed",
  "suspended",
  "flagged",
  "pending_review",
]);

export const ALLOWED_SERVICE_PRICING_MODELS = new Set([
  "fixed",
  "hourly",
  "negotiable",
  "starting_at",
]);

export const ALLOWED_SERVICE_LOCATION_TYPES = new Set([
  "on_campus",
  "remote",
  "client_location",
  "vendor_shop",
]);

export const RESERVED_STORE_SLUGS = new Set([
  "admin",
  "admins",
  "api",
  "auth",
  "login",
  "signin",
  "register",
  "signup",
  "logout",
  "stores",
  "store",
  "listings",
  "listing",
  "dashboard",
  "settings",
  "explore",
  "search",
  "wanted",
  "radar",
  "messages",
  "notifications",
  "orders",
  "me",
  "account",
  "profile",
  "users",
  "user",
  "help",
  "support",
  "onboarding",
  "become-seller",
  "terms",
  "privacy",
  "verify",
  "reset-password",
  "forgot-password",
  "campushive",
  "campusmarket",
  "official",
  "system",
  "moderator",
  "staff",
  "root",
  "null",
  "undefined",
]);

const PROHIBITED_CONTENT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(ak-?47|assault\s+rifle|handgun|pistol|live\s+ammunition|firearms?|explosives?|grenade|switchblade|taser\s+gun)\b/i,
    reason: "Weapons, firearms, ammunition, and explosives are strictly prohibited on Campus Hive.",
  },
  {
    pattern: /\b(cocaine|heroin|methamphetamine|fentanyl|rohypnol|codeine\s+syrup|tramadol\s+\d*mg|thc\s+carts?|weed\s+plug|loud\s+plug)\b/i,
    reason: "Controlled substances, narcotics, and illicit drugs are strictly prohibited.",
  },
  {
    pattern: /\b(waec\s+runs|jamb\s+runs|neco\s+runs|expo\s+runs|leaked\s+exam\s+papers?|exam\s+malpractice|forged\s+transcript|fake\s+certificate|buy\s+grades?)\b/i,
    reason: "Exam malpractice materials, forged academic documents, and grade manipulation are prohibited.",
  },
  {
    pattern: /\b(cc\s+dumps?|cloned\s+cards?|bank\s+logs?|yahoo\s+format|hacked\s+accounts?|stolen\s+(iphone|laptop|phone))\b/i,
    reason: "Stolen goods, compromised accounts, and financial fraud items are prohibited.",
  },
];

export function checkListingContentSafety(
  title: string,
  description?: string | null
): { safe: boolean; reason?: string } {
  const combined = `${title || ""}\n${description || ""}`;
  if (/(?:javascript|vbscript|data:text\/html):/i.test(combined)) {
    return { safe: false, reason: "Unsafe link or script scheme detected in listing content." };
  }
  for (const rule of PROHIBITED_CONTENT_PATTERNS) {
    if (rule.pattern.test(combined)) {
      return { safe: false, reason: rule.reason };
    }
  }
  return { safe: true };
}

export function validateListingPrice(
  rawPrice: unknown,
  options?: { listingType?: string; pricingModel?: string }
): { valid: boolean; price: number; error?: string } {
  const num = Number(rawPrice);
  if (!Number.isFinite(num)) {
    return { valid: false, price: 0, error: "A valid numeric price is required." };
  }
  const allowZero =
    options?.listingType === "service" && options?.pricingModel === "negotiable";
  if (allowZero ? num < 0 : num <= 0) {
    return {
      valid: false,
      price: num,
      error: allowZero
        ? "Price cannot be negative."
        : "Price must be greater than ₦0.",
    };
  }
  if (num > LISTING_MAX_PRICE_NGN) {
    return {
      valid: false,
      price: num,
      error: `Price cannot exceed ₦${LISTING_MAX_PRICE_NGN.toLocaleString("en-NG")}.`,
    };
  }
  return { valid: true, price: Math.round(num * 100) / 100 };
}

const TRUSTED_PUBLIC_IMAGE_HOSTS = new Set([
  "res.cloudinary.com",
  "images.unsplash.com",
  "api.dicebear.com",
]);

export function validatePublicImageUrl(
  rawUrl: unknown,
  userId: string,
  allowedFolders: string[] = ["listing_image", "listings", "store_logo", "store_cover", "store_banner", "cover_image", "stores", "users", "avatar", "profile_avatar"]
): { valid: boolean; url: string; error?: string } {
  if (typeof rawUrl !== "string") {
    return { valid: false, url: "", error: "Image URL must be a string." };
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, url: "", error: "Image URL cannot be empty." };
  }
  if (
    trimmed.includes("/authenticated/") ||
    trimmed.includes("private_docs") ||
    trimmed.includes("business_document")
  ) {
    return {
      valid: false,
      url: "",
      error: "Private verification documents cannot be used as public images.",
    };
  }

  // Allow safe bounded data URLs from local dev fallback
  if (trimmed.startsWith("data:")) {
    if (!/^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
      return { valid: false, url: "", error: "Invalid inline image data format." };
    }
    if (trimmed.length > 11 * 1024 * 1024) {
      return { valid: false, url: "", error: "Inline image exceeds maximum size limit." };
    }
    return { valid: true, url: trimmed };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, url: "", error: "Malformed image URL." };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, url: "", error: "Image URLs must use HTTPS." };
  }

  const host = parsed.hostname.toLowerCase();
  if (!TRUSTED_PUBLIC_IMAGE_HOSTS.has(host)) {
    return {
      valid: false,
      url: "",
      error: "External third-party image URLs are not permitted. Please upload images directly.",
    };
  }

  if (host === "res.cloudinary.com") {
    const path = decodeURIComponent(parsed.pathname);
    if (path.includes("..") || !path.includes("/image/upload/")) {
      return { valid: false, url: "", error: "Invalid Cloudinary public image delivery URL." };
    }
    const configuredCloud = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    if (configuredCloud && !path.startsWith(`/${configuredCloud}/`)) {
      return { valid: false, url: "", error: "Image does not belong to this platform's storage account." };
    }
    const matchesOwnedFolder = allowedFolders.some((folder) =>
      path.includes(`/campushive/${folder}/${userId}/`)
    );
    if (!matchesOwnedFolder) {
      return {
        valid: false,
        url: "",
        error: "Security rejection: Uploaded image does not belong to your account.",
      };
    }
  }

  return { valid: true, url: trimmed };
}

export function validateListingImages(
  rawImages: unknown,
  userId: string,
  options?: { requireAtLeastOne?: boolean }
): { valid: boolean; images: string[]; error?: string } {
  if (rawImages === undefined || rawImages === null) {
    if (options?.requireAtLeastOne) {
      return { valid: false, images: [], error: "At least 1 listing photo is required." };
    }
    return { valid: true, images: [] };
  }
  if (!Array.isArray(rawImages)) {
    return { valid: false, images: [], error: "Images must be an array of URLs." };
  }
  if (rawImages.length > LISTING_MAX_IMAGES) {
    return {
      valid: false,
      images: [],
      error: `A listing can have at most ${LISTING_MAX_IMAGES} photos.`,
    };
  }
  if (options?.requireAtLeastOne && rawImages.length === 0) {
    return { valid: false, images: [], error: "At least 1 listing photo is required." };
  }

  const validated: string[] = [];
  for (const item of rawImages) {
    const check = validatePublicImageUrl(item, userId, ["listing_image", "listings"]);
    if (!check.valid) {
      return { valid: false, images: [], error: check.error };
    }
    validated.push(check.url);
  }

  return { valid: true, images: validated };
}

export function sanitizeServiceDetails(
  raw: unknown,
  userId: string
): { valid: boolean; value?: Record<string, unknown>; error?: string } {
  if (raw === undefined || raw === null) {
    return { valid: true, value: undefined };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, error: "serviceDetails must be an object." };
  }
  const input = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (input.pricingModel !== undefined) {
    const pm = String(input.pricingModel).trim();
    if (!ALLOWED_SERVICE_PRICING_MODELS.has(pm)) {
      return { valid: false, error: "Invalid service pricing model." };
    }
    out.pricingModel = pm;
  } else {
    out.pricingModel = "fixed";
  }

  if (input.deliveryTime !== undefined && input.deliveryTime !== null) {
    out.deliveryTime = String(input.deliveryTime).trim().slice(0, 80);
  }

  if (input.serviceLocationType !== undefined) {
    const slt = String(input.serviceLocationType).trim();
    if (!ALLOWED_SERVICE_LOCATION_TYPES.has(slt)) {
      return { valid: false, error: "Invalid service location type." };
    }
    out.serviceLocationType = slt;
  }

  if (input.experienceYears !== undefined && input.experienceYears !== null) {
    const yrs = Number(input.experienceYears);
    if (!Number.isFinite(yrs) || yrs < 0 || yrs > 60) {
      return { valid: false, error: "Experience years must be between 0 and 60." };
    }
    out.experienceYears = Math.round(yrs);
  }

  if (input.portfolio !== undefined) {
    if (!Array.isArray(input.portfolio) || input.portfolio.length > 6) {
      return { valid: false, error: "Service portfolio may contain at most 6 images." };
    }
    const cleanPortfolio: string[] = [];
    for (const pUrl of input.portfolio) {
      const check = validatePublicImageUrl(pUrl, userId, ["listing_image", "listings"]);
      if (!check.valid) {
        return { valid: false, error: check.error };
      }
      cleanPortfolio.push(check.url);
    }
    out.portfolio = cleanPortfolio;
  }

  return { valid: true, value: out };
}

export function validateStoreName(raw: unknown): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  if (typeof raw !== "string") {
    return { valid: false, normalized: "", error: "Store name is required." };
  }
  const normalized = normalizeDisplayNameWhitespace(raw);
  if (normalized.length < STORE_NAME_MIN_LENGTH || normalized.length > STORE_NAME_MAX_LENGTH) {
    return {
      valid: false,
      normalized,
      error: `Store name must be between ${STORE_NAME_MIN_LENGTH} and ${STORE_NAME_MAX_LENGTH} characters.`,
    };
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\p{M} &'.,()-]*$/u.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: "Store name contains unsupported characters.",
    };
  }
  const letterCount = (normalized.match(/\p{L}/gu) || []).length;
  if (letterCount < 2) {
    return {
      valid: false,
      normalized,
      error: "Store name must include at least 2 letters.",
    };
  }
  if (isReservedIdentityName(normalized)) {
    return {
      valid: false,
      normalized,
      error: "This store name uses a reserved or official platform term and cannot be registered.",
    };
  }
  return { valid: true, normalized };
}

export function validateAndResolveStoreSlug(
  rawSlug: unknown,
  storeName: string,
  appendEntropyWhenGenerated = false
): { valid: boolean; slug: string; error?: string } {
  if (typeof rawSlug === "string" && rawSlug.trim() !== "") {
    const clean = rawSlug.trim().toLowerCase();
    if (clean.length < 3 || clean.length > 60) {
      return {
        valid: false,
        slug: clean,
        error: "Store slug must be between 3 and 60 characters.",
      };
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean)) {
      return {
        valid: false,
        slug: clean,
        error: "Store slug may only contain lowercase letters, numbers, and single hyphens.",
      };
    }
    if (RESERVED_STORE_SLUGS.has(clean) || isReservedIdentityName(clean)) {
      return {
        valid: false,
        slug: clean,
        error: `The store handle "${clean}" is reserved and unavailable.`,
      };
    }
    return { valid: true, slug: clean };
  }

  let base =
    storeName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "store";
  if (base.length < 3) base = `${base}-store`;
  if (base.length > 46) base = base.slice(0, 46).replace(/-+$/g, "");
  if (RESERVED_STORE_SLUGS.has(base)) base = `${base}-shop`;
  const finalSlug = appendEntropyWhenGenerated
    ? `${base}-${Date.now().toString(36)}`
    : base;
  return { valid: true, slug: finalSlug };
}

export function validatePhoneInput(raw: unknown): {
  valid: boolean;
  phone: string;
  error?: string;
} {
  if (typeof raw !== "string" || !raw.trim()) {
    return { valid: false, phone: "", error: "A valid contact phone or WhatsApp number is required." };
  }
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!/^\+?[0-9 ()-]{7,20}$/.test(trimmed) || digits.length < 7 || digits.length > 15) {
    return {
      valid: false,
      phone: trimmed,
      error: "Enter a valid phone number (7 to 15 digits).",
    };
  }
  return { valid: true, phone: trimmed };
}

export function validateVerificationDocumentUrl(
  rawUrl: unknown,
  userId: string
): { valid: boolean; url: string; error?: string } {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return {
      valid: false,
      url: "",
      error: "Verification document upload is required.",
    };
  }
  const trimmed = rawUrl.trim();

  if (trimmed.startsWith("data:")) {
    if (
      !/^data:(image\/(jpeg|jpg|png|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/i.test(
        trimmed
      )
    ) {
      return {
        valid: false,
        url: "",
        error: "Verification document must be a valid JPEG, PNG, WebP, or PDF upload.",
      };
    }
    if (trimmed.length > 15 * 1024 * 1024) {
      return {
        valid: false,
        url: "",
        error: "Verification document exceeds the 10MB size limit.",
      };
    }
    return { valid: true, url: trimmed };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, url: "", error: "Malformed verification document URL." };
  }

  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "res.cloudinary.com") {
    return {
      valid: false,
      url: "",
      error: "Verification document must be uploaded through Campus Hive's secure uploader.",
    };
  }

  const path = decodeURIComponent(parsed.pathname);
  if (path.includes("..")) {
    return { valid: false, url: "", error: "Invalid verification document path." };
  }

  const configuredCloud = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  if (configuredCloud && !path.startsWith(`/${configuredCloud}/`)) {
    return {
      valid: false,
      url: "",
      error: "Verification document does not belong to this platform's storage account.",
    };
  }

  const ownsDoc =
    path.includes(`/campushive/business_document/${userId}/`) ||
    path.includes(`/campushive/private_docs/${userId}/`);
  if (!ownsDoc) {
    return {
      valid: false,
      url: "",
      error: "Security rejection: Verification document does not belong to your account.",
    };
  }

  return { valid: true, url: trimmed };
}

/**
 * Inspects file magic bytes to verify genuine binary content (blocks disguised HTML/SVG/EXE).
 */
export function detectFileMagicMime(
  buf: Buffer
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "application/pdf" | null {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }

  // GIF87a / GIF89a: 47 49 46 38 (37|39) 61
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return "image/gif";
  }

  // WebP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }

  // PDF: %PDF-
  if (
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  ) {
    return "application/pdf";
  }

  return null;
}

/**
 * Computes Haversine distance in km from seller's captured safetyLocation to their selected campus.
 */
export function computeCampusDistanceKm(
  campusName: string | null | undefined,
  safetyLocation: Pick<ConfidentialSafetyLocation, "lat" | "lng"> | null | undefined
): number | null {
  if (!campusName || !safetyLocation) return null;
  const { lat, lng } = safetyLocation;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const normalized = campusName.trim().toLowerCase();
  const match = CAMPUS_COLLECTION.find(
    (c) =>
      c.name.toLowerCase() === normalized ||
      c.shortName.toLowerCase() === normalized ||
      c.slug === normalized
  );
  if (!match || !Number.isFinite(match.lat) || !Number.isFinite(match.lng)) {
    return null;
  }

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(match.lat - lat);
  const dLng = toRad(match.lng - lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat)) * Math.cos(toRad(match.lat)) * Math.sin(dLng / 2) ** 2;
  const dist = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  return Math.round(dist * 10) / 10;
}
