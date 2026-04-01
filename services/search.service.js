import User from "../models/User.js";
import { PROFILE_CATALOG } from "../data/searchCatalog.js";

// We search via MongoDB for profiles now
export const searchProfiles = async (query) => {
    if (!query) return [];
    
    // Search in displayName, fullName, email, bio, tags, role, schoolName
    const searchRegex = new RegExp(query, "i");
    const users = await User.find({
        $or: [
            { "profile.displayName": searchRegex },
            { "profile.bio": searchRegex },
            { "personalDetails.fullName": searchRegex },
            { "studentStatus.schoolName": searchRegex },
            { "businessProfile.name": searchRegex },
            { "businessProfile.category": searchRegex },
            { "role": searchRegex },
            { "businessProfile.tags": { $in: [searchRegex] } }
        ],
        accountStatus: "active"
    }).limit(20);

    // Also search in mock catalog for special shops/seed data
    const mockMatches = PROFILE_CATALOG.filter(p => 
        p.name.match(searchRegex) || p.handle.match(searchRegex) || p.bio.match(searchRegex)
    );

    return [...users, ...mockMatches];
};
