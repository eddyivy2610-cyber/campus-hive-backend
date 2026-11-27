import { Router } from "express";
import { requireAdmin } from "../middlewares/auth.middleware.ts";
import { loginRateLimiter, otpIpRateLimiter } from "../lib/rateLimit.ts";
import {
  adminAnalytics,
  adminAuthMe,
  adminSignIn,
  adminSignUp,
  adminCreateBanner,
  adminDeleteBanner,
  adminDeleteListing,
  adminDeleteReview,
  adminDuplicateBanner,
  adminListBanners,
  adminListBusinessApplications,
  adminListListings,
  adminListLogs,
  adminListReports,
  adminListReviews,
  adminListStores,
  adminListUsers,
  adminOverview,
  adminReviewBusinessApplication,
  adminSetBannerStatus,
  adminUpdateBanner,
  adminUpdateListing,
  adminUpdateReport,
  adminUpdateStoreStatus,
  adminUpdateUser,
  adminGetSettings,
  adminUpdateSetting,
} from "../controllers/admin.controller.ts";

const router = Router();

// Admin Auth
router.post("/auth/signin", loginRateLimiter, adminSignIn);
router.post("/auth/signup", otpIpRateLimiter, adminSignUp);
router.get("/auth/me", requireAdmin, adminAuthMe);

// Overview, Analytics & Audit Logs
router.get("/overview", requireAdmin, adminOverview);
router.get("/analytics", requireAdmin, adminAnalytics);
router.get("/logs", requireAdmin, adminListLogs);

// Users
router.get("/users", requireAdmin, adminListUsers);
router.patch("/users/:id", requireAdmin, adminUpdateUser);

// Stores & Business Applications
router.get("/stores", requireAdmin, adminListStores);
router.patch("/stores/:id", requireAdmin, adminUpdateStoreStatus);
router.get("/business-applications", requireAdmin, adminListBusinessApplications);
router.patch("/business-applications/:id", requireAdmin, adminReviewBusinessApplication);

// Listings
router.get("/listings", requireAdmin, adminListListings);
router.patch("/listings/:id", requireAdmin, adminUpdateListing);
router.delete("/listings/:id", requireAdmin, adminDeleteListing);

// Reports & Reviews
router.get("/reports", requireAdmin, adminListReports);
router.patch("/reports/:id", requireAdmin, adminUpdateReport);
router.get("/reviews", requireAdmin, adminListReviews);
router.delete("/reviews/:id", requireAdmin, adminDeleteReview);

// Banners
router.get("/banners", requireAdmin, adminListBanners);
router.post("/banners", requireAdmin, adminCreateBanner);
router.patch("/banners/:id", requireAdmin, adminUpdateBanner);
router.delete("/banners/:id", requireAdmin, adminDeleteBanner);
router.post("/banners/:id/publish", requireAdmin, (req, res) => adminSetBannerStatus("published", req, res));
router.post("/banners/:id/unpublish", requireAdmin, (req, res) => adminSetBannerStatus("draft", req, res));
router.post("/banners/:id/archive", requireAdmin, (req, res) => adminSetBannerStatus("archived", req, res));
router.post("/banners/:id/duplicate", requireAdmin, adminDuplicateBanner);

// Platform Settings (admin-controlled live config)
// GET is intentionally public so the sign-up page can self-gate without a token.
// PATCH requires admin authentication.
router.get("/settings", adminGetSettings);
router.patch("/settings", requireAdmin, adminUpdateSetting);

export default router;
