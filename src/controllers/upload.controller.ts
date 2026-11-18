import crypto from "node:crypto";
import { Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";

const ALLOWED_PURPOSES = new Set([
  "listing_image",
  "store_logo",
  "store_banner",
  "business_document",
  "profile_avatar",
]);

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DOC_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);

export async function signUpload(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
    return;
  }

  const { purpose = "listing_image", filename = "", extension = "", mimeType = "", sizeBytes } = req.body || {};
  if (!ALLOWED_PURPOSES.has(String(purpose))) {
    res.status(400).json({ message: "Invalid upload purpose", error: "bad_request" });
    return;
  }

  const maxBytes = purpose === "business_document" ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
  if (sizeBytes !== undefined) {
    const numericSize = Number(sizeBytes);
    if (!Number.isFinite(numericSize) || numericSize <= 0 || numericSize > maxBytes) {
      res.status(400).json({
        message: `File size exceeds maximum limit of ${maxBytes} bytes`,
        error: "file_too_large",
      });
      return;
    }
  }

  let ext = String(extension || "").trim().toLowerCase();
  if (!ext && typeof filename === "string") {
    const m = filename.match(/\.[a-zA-Z0-9]+$/);
    if (m) ext = m[0].toLowerCase();
  }
  if (!ext && typeof mimeType === "string") {
    const m = mimeType.toLowerCase();
    if (m === "image/jpeg" || m === "image/jpg") ext = ".jpg";
    else if (m === "image/png") ext = ".png";
    else if (m === "image/webp") ext = ".webp";
    else if (m === "application/pdf") ext = ".pdf";
  }

  const allowed = purpose === "business_document" ? DOC_EXTENSIONS : IMAGE_EXTENSIONS;
  if (!ext || !allowed.has(ext)) {
    res.status(400).json({ message: `Disallowed file extension '${ext || "none"}'`, error: "invalid_file_type" });
    return;
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({ message: "Upload storage is not configured", error: "storage_unconfigured" });
      return;
    }
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `campushive/${purpose}/${userId}/${crypto.randomUUID()}`;
  const signature = crypto
    .createHmac("sha256", apiSecret || "dev_upload_signing_secret")
    .update(`public_id=${publicId}&timestamp=${timestamp}`)
    .digest("hex");

  const accessType = purpose === "business_document" ? "authenticated" : "public";

  res.status(200).json({
    success: true,
    data: {
      publicId,
      timestamp,
      signature,
      accessType,
      cloudName: cloudName || "dev-local",
      apiKey: apiKey || "dev-key",
    },
  });
}
