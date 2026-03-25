import User from "../models/User.js";
import EmailVerification from "../models/EmailVerification.js";
import argon2 from "argon2";

export const registerUserService = async (req) => {
    const { 
        email, 
        password, 
        profile, 
        personalDetails, 
        studentStatus, 
        role, 
        agreedToTerms, 
        identification, 
        businessProfile, 
        } = req.body;
    
    try {
        // Validate required fields
        const requiredFields = [];
        if (!email) requiredFields.push("email");
        if (!profile?.displayName) requiredFields.push("profile.displayName");
        if (!role) requiredFields.push("role");
        if (agreedToTerms === undefined || agreedToTerms === false) requiredFields.push("agreedToTerms");
        
        if (requiredFields.length > 0) {
            return {
                success: false,
                message: `Missing required fields: ${requiredFields.join(", ")}`,
                status: 400
            };
        }
        
        // Email format validation
        const emailRegex = /^\S+@\S+\.\S+$/;
        if (!emailRegex.test(email)) {
            return {
                success: false,
                message: "Please provide a valid email address",
                status: 400
            };
        }
        
        // Check if email already exists
        const emailExists = await User.findOne({ email: email.toLowerCase().trim() });
        if (emailExists) {
            return {
                success: false,
                message: "Email already in use",
                status: 409
            };
        }
        
        // Check if display name already exists
        const displayNameExists = await User.findOne({ 
            "profile.displayName": profile.displayName.trim() 
        });
        if (displayNameExists) {
            return {
                success: false,
                message: "Display name already taken",
                status: 409
            };
        }
        
        // Check phone numbers if provided
        if (personalDetails?.phones && personalDetails.phones.length > 0) {
            for (const phone of personalDetails.phones) {
                const phoneExists = await User.findOne({ 
                    "personalDetails.phones": phone 
                });
                if (phoneExists) {
                    return {
                        success: false,
                        message: `Phone number ${phone} already in use`,
                        status: 409
                    };
                }
            }
        }
        
        // Validate business profile for sellers
        if (role === "seller") {
            if (!req.body.businessProfile?.name) {
                return {
                    success: false,
                    message: "Business name is required for sellers",
                    status: 400
                };
            }
        }
        
        // Construct user object matching the refined schema
        const newUser = {
            email: email.toLowerCase().trim(),
            profile: {
                displayName: profile.displayName.trim(),
                bio: profile.bio || "Hey I'm using Campus Market!",
                avatar: profile.avatar || null
            },
            personalDetails: personalDetails ? {
                fullName: personalDetails.fullName?.trim(),
                dateOfBirth: personalDetails.dateOfBirth,
                stateOfOrigin: personalDetails.stateOfOrigin?.trim(),
                phones: personalDetails.phones || []
            } : undefined,
            studentStatus: studentStatus || {
                isStudent: false,
                departmentFaculty: ""
            },
            role: role,
            agreedToTerms: agreedToTerms,
            agreedToTermsAt: new Date(),
            emailVerified: false,
            accountStatus: "active",
            rating: {
                average: 0,
                count: 0
            }
        };
        
        // Add business profile for sellers
        if (role === "seller" && req.body.businessProfile) {
            newUser.businessProfile = {
                name: req.body.businessProfile.name.trim(),
                description: req.body.businessProfile.description?.trim() || "",
                tags: req.body.businessProfile.tags || []
            };
        }
        
        // Add password if provided (for email/password auth)
        if (password) {
            const hashpassword = await argon2.hash(password,  {
                type: argon2.argon2id,
                memoryCost: 2 ** 12,  // 4 MB - Very fast, still secure
                timeCost: 2,          // 2 iterations
                parallelism: 1,
                hashLength: 32,
                saltLength: 16,
            });
            newUser.password = hashpassword;
        }
        
        // Create user
        const savedUser = await User.create(newUser);
        
        // Create email verification record
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const emailVerification = await EmailVerification.create({
            userId: savedUser._id,
            email: savedUser.email,
            verificationCode: verificationCode,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        });
        
        // TODO: Send verification email here
        // await sendVerificationEmail(savedUser.email, verificationCode);
        
        // Return user data (excluding sensitive fields)
        const userResponse = savedUser.toObject();
        delete userResponse.password;
        delete userResponse.emailVerificationToken;
        delete userResponse.passwordResetToken;
        
        return {
            success: true,
            message: "User registered successfully. Please verify your email.",
            status: 201,
            data: {
                userId: savedUser._id,
                email: savedUser.email,
                profile: savedUser.profile,
                role: savedUser.role,
                emailVerified: savedUser.emailVerified
            }
        };
        
    } catch (error) {
        console.error("Registration service error:", error);
        return {
            success: false,
            message: "Internal Server Error",
            status: 500,
            error: error.message
        };
    }
};

export const getUserByIdService = async (userId) => {
    try {
        const user = await User.findById(userId)
            .select("-password -emailVerificationToken -passwordResetToken -twoFactorSecret")
            .lean();
        
        if (!user) {
            return {
                success: false,
                message: "User not found",
                status: 404
            };
        }
        
        return {
            success: true,
            message: "User retrieved successfully",
            status: 200,
            data: user
        };
    } catch (error) {
        console.error("Get user service error:", error);
        return {
            success: false,
            message: "Internal Server Error",
            status: 500
        };
    }
};

export const updateUserService = async (userId, updateData, requestingUserId) => {
    try {
        // Check if user exists
        const user = await User.findById(userId);
        if (!user) {
            return {
                success: false,
                message: "User not found",
                status: 404
            };
        }
        
        // Authorization check (only admin or the user themselves can update)
        if (requestingUserId !== userId.toString()) {
            const requestingUser = await User.findById(requestingUserId);
            if (requestingUser?.role !== "admin") {
                return {
                    success: false,
                    message: "Unauthorized to update this user",
                    status: 403
                };
            }
        }
        
        // Fields that cannot be updated directly
        const restrictedFields = [
            "_id", "email", "emailVerified", "password", 
            "loginCount", "previousLoginAt", "ipAddresses",
            "emailVerificationToken", "passwordResetToken"
        ];
        
        // Remove restricted fields from update data
        restrictedFields.forEach(field => {
            delete updateData[field];
        });
        
        // Validate display name uniqueness if being updated
        if (updateData.profile?.displayName) {
            const existingUser = await User.findOne({
                "profile.displayName": updateData.profile.displayName,
                _id: { $ne: userId }
            });
            
            if (existingUser) {
                return {
                    success: false,
                    message: "Display name already taken",
                    status: 409
                };
            }
        }
        
        // Validate phone numbers if being updated
        if (updateData.personalDetails?.phones) {
            for (const phone of updateData.personalDetails.phones) {
                const existingUser = await User.findOne({
                    "personalDetails.phones": phone,
                    _id: { $ne: userId }
                });
                
                if (existingUser) {
                    return {
                        success: false,
                        message: `Phone number ${phone} already in use`,
                        status: 409
                    };
                }
            }
        }
        
        // Update user
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true, runValidators: true }
        ).select("-password -emailVerificationToken -passwordResetToken -twoFactorSecret");
        
        return {
            success: true,
            message: "User updated successfully",
            status: 200,
            data: updatedUser
        };
        
    } catch (error) {
        console.error("Update user service error:", error);
        
        // Handle validation errors
        if (error.name === "ValidationError") {
            const errors = Object.values(error.errors).map(e => e.message);
            return {
                success: false,
                message: "Validation error",
                status: 400,
                errors: errors
            };
        }
        
        return {
            success: false,
            message: "Internal Server Error",
            status: 500
        };
    }
};

// Additional service methods
export const verifyEmailService = async (email, code) => {
    try {
        const verification = await EmailVerification.findOne({
            email: email.toLowerCase(),
            verificationCode: code,
            expiresAt: { $gt: new Date() }
        });
        
        if (!verification) {
            return {
                success: false,
                message: "Invalid or expired verification code",
                status: 400
            };
        }
        
        const user = await User.findByIdAndUpdate(
            verification.userId,
            { emailVerified: true },
            { new: true }
        );
        
        await EmailVerification.deleteOne({ _id: verification._id });
        
        return {
            success: true,
            message: "Email verified successfully",
            status: 200,
            data: { userId: user._id, email: user.email }
        };
        
    } catch (error) {
        console.error("Email verification error:", error);
        return {
            success: false,
            message: "Internal Server Error",
            status: 500
        };
    }
};

export const updateLastLoginService = async (userId, ipAddress, deviceInfo) => {
    try {
        const user = await User.findById(userId);
        if (!user) {
            return {
                success: false,
                message: "User not found",
                status: 404
            };
        }
        
        await user.updateLastLogin();
        
        // Update IP and device info
        if (ipAddress && !user.ipAddresses.includes(ipAddress)) {
            user.ipAddresses.push(ipAddress);
        }
        
        if (deviceInfo) {
            user.deviceInfo = deviceInfo;
        }
        
        await user.save();
        
        return {
            success: true,
            message: "Last login updated",
            status: 200
        };
        
    } catch (error) {
        console.error("Update last login error:", error);
        return {
            success: false,
            message: "Internal Server Error",
            status: 500
        };
    }
};