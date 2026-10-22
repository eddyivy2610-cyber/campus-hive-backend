import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { env } from "./env.js";

export const AUTH_ISSUER = "campushive.edu.ng";
export const AUTH_AUDIENCE = "campushive-api";

/**
 * Resolves the authentication secret key for Express and Socket.IO.
 * This is the SAME AUTH_SECRET the Next.js app uses (same precedence:
 * AUTH_SECRET, then JWT_SECRET), validated to >= 32 chars on boot.
 */
export const getAuthSecret = () => {
  return env.AUTH_SECRET;
};

/**
 * End of the legacy-token transition window (env AUTH_LEGACY_TOKENS_UNTIL).
 * Read per call so tests / ops can move it without a restart of this module.
 */
export const getLegacyTokenSunset = () => {
  const raw = process.env.AUTH_LEGACY_TOKENS_UNTIL || env.AUTH_LEGACY_TOKENS_UNTIL;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? 0 : ms; // unparsable => window closed (fail safe)
};

export const isLegacyWindowOpen = (nowMs = Date.now()) => nowMs < getLegacyTokenSunset();

/**
 * Verifies a JWT and returns normalised claims ({ ...claims, sub, id }).
 *
 * 1. Signature: HS256 only, shared AUTH_SECRET (alg:none / RS-HS confusion rejected).
 * 2. exp is REQUIRED (jsonwebtoken only checks it when present).
 * 3. iss must equal AUTH_ISSUER and aud must equal AUTH_AUDIENCE.
 * 4. sub is the subject. If sub and id are both present they must match.
 * 5. Refresh tokens (tokenType !== "access") are rejected.
 *
 * Transition window (until AUTH_LEGACY_TOKENS_UNTIL): a token from the old signer
 * that is MISSING iss / aud / sub is still accepted, reading `id` as the subject.
 * A claim that is present but wrong is ALWAYS rejected, inside or outside the window.
 * After the sunset, iss, aud and sub are all mandatory.
 */
export const verifyAuthClaims = (token) => {
  if (!token || typeof token !== "string") {
    throw new Error("Token missing");
  }

  const decoded = jwt.verify(token, getAuthSecret(), {
    algorithms: ["HS256"],
  });

  if (!decoded || typeof decoded !== "object") {
    throw new Error("Invalid token payload");
  }

  // exp is mandatory: no non-expiring tokens
  if (typeof decoded.exp !== "number") {
    throw new Error("Token missing exp");
  }

  const legacyOpen = isLegacyWindowOpen();

  // iss: wrong => always reject; missing => only allowed in the legacy window
  if (decoded.iss !== undefined) {
    if (decoded.iss !== AUTH_ISSUER) {
      throw new Error(`Invalid token issuer: expected ${AUTH_ISSUER}, got ${decoded.iss}`);
    }
  } else if (!legacyOpen) {
    throw new Error("Token missing iss");
  }

  // aud: string or array per RFC 7519; must contain our audience
  if (decoded.aud !== undefined) {
    const audOk = Array.isArray(decoded.aud)
      ? decoded.aud.includes(AUTH_AUDIENCE)
      : decoded.aud === AUTH_AUDIENCE;
    if (!audOk) {
      throw new Error(`Invalid token audience: expected ${AUTH_AUDIENCE}, got ${decoded.aud}`);
    }
  } else if (!legacyOpen) {
    throw new Error("Token missing aud");
  }

  // Token-type isolation: Next.js signs refresh tokens with the same secret.
  // A refresh token must never be accepted as an access token here.
  if (decoded.tokenType && decoded.tokenType !== "access") {
    throw new Error(`Invalid token type: expected access, got ${decoded.tokenType}`);
  }

  // Subject: sub is authoritative. id is read only during the transition window.
  const hasSub = typeof decoded.sub === "string" && decoded.sub.length > 0;
  const hasId = decoded.id !== undefined && decoded.id !== null && String(decoded.id).length > 0;

  let subjectId;
  if (hasSub) {
    if (hasId && String(decoded.id) !== decoded.sub) {
      throw new Error("Token sub/id mismatch");
    }
    subjectId = decoded.sub;
  } else if (hasId && legacyOpen) {
    subjectId = String(decoded.id);
  } else {
    throw new Error(legacyOpen ? "Token missing subject identifier (sub/id)" : "Token missing sub");
  }

  return {
    ...decoded,
    sub: subjectId,
    id: subjectId, // callers should read sub; id kept for backwards compatibility
  };
};

/**
 * Generate a JWT token for a user with standard claims (iss, aud, sub)
 * and legacy 'id' for transition window compatibility.
 * @param {Object} user - The user object
 * @returns {string} - The signed JWT token
 */
export const generateToken = (user) => {
  const userId = String(user._id);
  return jwt.sign(
    {
      sub: userId,
      id: userId, // transition window compatibility
      email: user.email,
      role: user.role,
      tokenType: "access",
    },
    getAuthSecret(),
    {
      algorithm: "HS256",
      issuer: AUTH_ISSUER,
      audience: AUTH_AUDIENCE,
      expiresIn: "7d",
    }
  );
};

/**
 * Generate a JWT for an admin account using the same standard claims
 * (iss, aud, sub, HS256) as generateToken, so Next.js verifyAuthToken accepts it.
 *
 * @param {Object} admin - The admin User document
 * @returns {string} - The signed JWT token
 */
export const generateAdminToken = (admin) => {
  const adminId = String(admin._id);
  const username = admin.profile?.handle || admin.profile?.displayName || admin.username || "admin";
  return jwt.sign(
    {
      sub: adminId,
      id: adminId, // transition window compatibility
      email: admin.email,
      name: username,
      role: "admin",
      adminRole: "superadmin",
      isAdmin: true,
      isStudent: false,
      studentVerified: false,
      tokenType: "access",
    },
    getAuthSecret(),
    {
      algorithm: "HS256",
      issuer: AUTH_ISSUER,
      audience: AUTH_AUDIENCE,
      expiresIn: "7d",
    }
  );
};

/**
 * Middleware to protect routes and verify JWT
 */
export const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = verifyAuthClaims(token);
      const userId = decoded.sub;

      req.user = await User.findById(userId).select("-password");

      if (!req.user) {
        return res.status(401).json({ message: "Not authorized, user not found" });
      }

      if (req.user.accountStatus && req.user.accountStatus !== "active") {
        return res.status(403).json({
          message: `Forbidden: Account is ${req.user.accountStatus}. Please contact support.`,
        });
      }

      next();
      return;
    } catch (error) {
      console.error("Auth error:", error.message);
      res.status(401).json({ message: "Not authorized, token failed", error: error.message });
      return;
    }
  }

  if (!token) {
    res.status(401).json({ message: "Not authorized, no token" });
  }
};

/**
 * Middleware to restrict access to admins only
 */
export const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Forbidden: Admin access required" });
  }
};

/**
 * Middleware to protect admin routes and verify against User collection (role: "admin")
 */
export const adminProtect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = verifyAuthClaims(token);
      const adminId = decoded.sub;

      const admin = await User.findById(adminId).select("-password");

      if (!admin || admin.role !== "admin") {
        return res.status(401).json({ message: "Not authorized as admin, account not found" });
      }

      if (admin.accountStatus && admin.accountStatus !== "active") {
        return res.status(403).json({
          message: `Forbidden: Admin account is ${admin.accountStatus}.`,
        });
      }

      req.admin = admin;
      req.user = admin;

      next();
      return;
    } catch (error) {
      console.error("Admin Auth error:", error.message);
      res.status(401).json({ message: "Not authorized, admin token failed", error: error.message });
      return;
    }
  }

  if (!token) {
    res.status(401).json({ message: "Not authorized, no admin token" });
  }
};

/**
 * Middleware to allow both standard Users and Administrators
 * Useful for shared features like notifications
 */
export const unifiedAuth = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = verifyAuthClaims(token);
      const accountId = decoded.sub;

      const user = await User.findById(accountId).select("-password");
      if (user) {
        if (user.accountStatus && user.accountStatus !== "active") {
          return res.status(403).json({
            message: `Forbidden: Account is ${user.accountStatus}. Please contact support.`,
          });
        }
        req.user = user;
        if (user.role === "admin") {
          req.admin = user;
          req.authType = "admin";
        } else {
          req.authType = "user";
        }
        return next();
      }

      return res.status(401).json({ message: "Not authorized, account not found" });
    } catch (error) {
      console.error("Unified Auth error:", error.message);
      res.status(401).json({ message: "Not authorized, token failed", error: error.message });
      return;
    }
  }

  if (!token) {
    res.status(401).json({ message: "Not authorized, no token" });
  }
};
