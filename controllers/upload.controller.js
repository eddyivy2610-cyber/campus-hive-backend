import { uploadToCloudinary } from "../utils/cloudinary.js";

/**
 * Handle multiple image uploads to Cloudinary
 */
export const uploadImages = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: "No files uploaded" });
        }

        const uploadPromises = req.files.map((file) => 
            uploadToCloudinary(file.buffer, "campus-market/listings")
        );

        const results = await Promise.all(uploadPromises);
        
        const imageUrls = results.map((result) => result.secure_url);

        res.status(200).json({
            success: true,
            urls: imageUrls,
        });
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ 
            message: "Failed to upload images to Cloudinary",
            error: error.message 
        });
    }
};
