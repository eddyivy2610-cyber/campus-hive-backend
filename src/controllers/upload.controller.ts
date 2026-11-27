import crypto from "node:crypto";
import { Response } from "express";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";

const ALLOWED_PURPOSES = new Set([
  "listing_image",
  "store_logo",
  "store_banner",
  "store_cover",
  "cover_image",
  "business_document",
  "profile_avatar",
  "avatar",
  "general",
]);

const COVER_PURPOSES = new Set(["store_banner", "store_cover", "cover_image"]);

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const DOC_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"]);

function parseMultipartFile(
  bodyBuffer: Buffer,
  contentType: string
): { fileBuffer: Buffer; filename: string; mimeType: string; purpose: string } | null {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!match) return null;
  const boundary = match[1] || match[2];
  const boundaryBytes = Buffer.from(`--${boundary}`);

  let fileBuffer: Buffer | null = null;
  let filename = "upload.jpg";
  let mimeType = "application/octet-stream";
  let purpose = "general";

  let pos = bodyBuffer.indexOf(boundaryBytes);
  while (pos !== -1) {
    const nextPos = bodyBuffer.indexOf(boundaryBytes, pos + boundaryBytes.length);
    if (nextPos === -1) break;

    const part = bodyBuffer.subarray(pos + boundaryBytes.length, nextPos);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headersStr = part.subarray(0, headerEnd).toString("utf8");
      // Trim trailing \r\n before next boundary
      const contentStart = headerEnd + 4;
      const contentEnd = part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10
        ? part.length - 2
        : part.length;
      const content = part.subarray(contentStart, contentEnd);

      const nameMatch = headersStr.match(/name="([^"]+)"/i);
      const fieldName = nameMatch?.[1];

      if (fieldName === "purpose") {
        purpose = content.toString("utf8").trim() || purpose;
      } else if (fieldName === "file") {
        const fnMatch = headersStr.match(/filename="([^"]+)"/i);
        if (fnMatch?.[1]) filename = fnMatch[1];
        const ctMatch = headersStr.match(/Content-Type:\s*([^\r\n;]+)/i);
        if (ctMatch?.[1]) mimeType = ctMatch[1].trim().toLowerCase();
        fileBuffer = content;
      }
    }
    pos = nextPos;
  }

  if (!fileBuffer || fileBuffer.length === 0) return null;
  return { fileBuffer, filename, mimeType, purpose };
}

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

  if (COVER_PURPOSES.has(String(purpose))) {
    const activeStores = await prisma.store.count({
      where: { ownerId: userId, status: "active" },
    });
    if (activeStores === 0) {
      res.status(403).json({
        message: "Cover photos are only available to active storefront owners.",
        error: "forbidden",
      });
      return;
    }
  }

  const maxBytes =
    purpose === "business_document"
      ? 10 * 1024 * 1024
      : COVER_PURPOSES.has(String(purpose))
      ? 8 * 1024 * 1024
      : 5 * 1024 * 1024;
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
    else if (m === "image/gif") ext = ".gif";
    else if (m === "application/pdf") ext = ".pdf";
  }

  const allowed = purpose === "business_document" ? DOC_EXTENSIONS : IMAGE_EXTENSIONS;
  if (!ext || !allowed.has(ext)) {
    res.status(400).json({ message: `Disallowed file extension '${ext || "none"}'`, error: "invalid_file_type" });
    return;
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

  if (!cloudName || !apiKey || !apiSecret) {
    res.status(503).json({ message: "Direct upload storage is not configured", error: "storage_unconfigured" });
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `campushive/${purpose}/${userId}`;
  const publicId = crypto.randomUUID();
  const isPrivate = purpose === "business_document";
  const accessType = isPrivate ? "authenticated" : "upload";
  const resourceType = ext === ".pdf" ? "raw" : "image";
  const paramsToSign = isPrivate
    ? `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}&type=authenticated`
    : `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`;

  const signature = crypto
    .createHash("sha1")
    .update(`${paramsToSign}${apiSecret}`)
    .digest("hex");

  const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;

  res.status(200).json({
    success: true,
    uploadUrl,
    folder,
    publicId,
    timestamp,
    signature,
    type: accessType,
    apiKey,
    data: {
      uploadUrl,
      folder,
      publicId,
      timestamp,
      signature,
      accessType,
      cloudName,
      apiKey,
    },
  });
}

export async function uploadFileFallback(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized", error: "unauthorized" });
      return;
    }

    const contentType = String(req.headers["content-type"] || "");
    if (!Buffer.isBuffer(req.body) || !contentType.includes("multipart/form-data")) {
      res.status(400).json({ success: false, error: "Expected multipart/form-data upload." });
      return;
    }

    const parsed = parseMultipartFile(req.body, contentType);
    if (!parsed) {
      res.status(400).json({ success: false, error: "No file provided." });
      return;
    }

    const { fileBuffer, filename, mimeType, purpose } = parsed;
    if (COVER_PURPOSES.has(purpose)) {
      const activeStores = await prisma.store.count({
        where: { ownerId: userId, status: "active" },
      });
      if (activeStores === 0) {
        res.status(403).json({
          success: false,
          error: "Cover photos are only available to active storefront owners.",
        });
        return;
      }
    }
    const isPrivate = purpose === "business_document";
    const maxBytes = isPrivate
      ? 10 * 1024 * 1024
      : COVER_PURPOSES.has(purpose)
      ? 8 * 1024 * 1024
      : 5 * 1024 * 1024;
    if (fileBuffer.length > maxBytes) {
      res.status(400).json({ success: false, error: "File exceeds maximum allowed size." });
      return;
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
    const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

    if (cloudName && apiKey && apiSecret) {
      const timestamp = Math.floor(Date.now() / 1000);
      const folder = `campushive/${purpose}/${userId}`;
      const paramsToSign = isPrivate
        ? `folder=${folder}&timestamp=${timestamp}&type=authenticated`
        : `folder=${folder}&timestamp=${timestamp}`;
      const signature = crypto.createHash("sha1").update(`${paramsToSign}${apiSecret}`).digest("hex");

      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), filename);
      form.append("api_key", apiKey);
      form.append("timestamp", String(timestamp));
      form.append("signature", signature);
      form.append("folder", folder);
      if (isPrivate) form.append("type", "authenticated");

      const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
        method: "POST",
        body: form,
      });
      if (cloudRes.ok) {
        const cloudData = (await cloudRes.json()) as { secure_url?: string };
        if (cloudData.secure_url) {
          res.status(200).json({ success: true, url: cloudData.secure_url, isPrivate });
          return;
        }
      }
    }

    // Fallback to inline data URL when Cloudinary is not configured
    const safeMime = mimeType && mimeType !== "application/octet-stream" ? mimeType : "image/jpeg";
    const dataUrl = `data:${safeMime};base64,${fileBuffer.toString("base64")}`;
    res.status(200).json({ success: true, url: dataUrl, isPrivate });
  } catch (err) {
    console.error("Upload fallback error:", err);
    res.status(500).json({ success: false, error: "Failed to process upload." });
  }
}
