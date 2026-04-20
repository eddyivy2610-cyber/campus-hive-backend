import User from "../models/User.js";

/**
 * Generates a unique handle (username) from a full name and email digits.
 * @param {string} fullName - User's full name
 * @param {string} email - User's email
 * @returns {Promise<string>} - A unique handle
 */
export const generateUniqueHandle = async (fullName, email) => {
    // 1. Normalize name: lowercase and remove non-alphanumeric
    let base = fullName.toLowerCase().replace(/[^a-z0-9]/g, "");
    
    // 2. Extract digits from email if any
    const emailDigits = email.split('@')[0].replace(/[^0-9]/g, "");
    
    let handle = base + (emailDigits ? emailDigits : "");

    // 3. Ensure uniqueness in DB
    let isUnique = false;
    let fallbackCounter = 1;
    let finalHandle = handle;

    while (!isUnique) {
        const existing = await User.findOne({ "profile.handle": finalHandle });
        if (!existing) {
            isUnique = true;
        } else {
            // Append random digits or counter
            finalHandle = handle + Math.floor(Math.random() * 1000);
            
            // Safety break after too many attempts
            fallbackCounter++;
            if (fallbackCounter > 10) {
                finalHandle = handle + Date.now().toString().slice(-4);
                isUnique = true; 
            }
        }
    }

    return finalHandle;
};
