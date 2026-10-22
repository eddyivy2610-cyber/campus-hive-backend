import { Router } from "express";

const router = Router();

/**
 * LEGACY UPLOAD ENDPOINT RETIRED & CLOSED (Patch 4.2).
 * All client consumers have migrated to Next.js /api/upload/sign and /api/upload.
 * Returning 410 Gone closes the legacy multer disk/memory upload surface entirely.
 */
router.use((req, res) => {
  res.status(410).json({
    success: false,
    error: "Gone: The legacy Express upload endpoint has been permanently retired for security. Please use Next.js /api/upload/sign or /api/upload.",
  });
});

export default router;
