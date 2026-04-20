import { Router } from "express";
import { uploadImages } from "../controllers/upload.controller.js";
import { protect } from "../utils/auth.js";
import upload from "../middleware/upload.js";

const router = Router();

// Endpoint for uploading multiple listing images
// Limit to 5 images per request
router.post("/", protect, upload.array("images", 5), uploadImages);

export default router;
