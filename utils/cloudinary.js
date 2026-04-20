import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload a stream-based file to Cloudinary
 * @param {Buffer} fileBuffer - The file buffer from Multer
 * @param {string} folder - Destination folder on Cloudinary
 * @returns {Promise<object>} - Cloudinary upload response
 */
export const uploadToCloudinary = (fileBuffer, folder = "campus-market/listings") => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            { folder, resource_type: "auto" },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
        uploadStream.end(fileBuffer);
    });
};

export default cloudinary;
