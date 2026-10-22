/**
 * Canonical System Enums for Campus Hive (Express Backend)
 * Shared source of truth across Next.js and Express backend.
 */

export const LISTING_STATUSES = [
  "active",
  "draft",
  "pending_review",
  "paused",
  "sold",
  "rejected",
  "removed",
];

export const PRODUCT_CONDITIONS = [
  "Brand New",
  "Like New",
  "Used - Excellent",
  "Used - Good",
  "Used - Fair",
];

export const LISTING_TYPES = ["product", "service"];

export const SERVICE_PRICING_MODELS = [
  "fixed",
  "hourly",
  "negotiable",
  "starting_at",
];

export const SERVICE_LOCATION_TYPES = [
  "on_campus",
  "remote",
  "client_location",
  "vendor_shop",
];

export const LISTING_PAUSED_BY_REASONS = [
  "seller",
  "account_suspension",
  "store_suspension",
];

export const LISTING_REMOVED_BY_REASONS = [
  "seller",
  "account_ban",
  "admin",
];

export const USER_ACCOUNT_STATUSES = [
  "active",
  "suspended",
  "banned",
  "pending",
];

export const USER_ROLES = ["buyer", "seller", "admin"];

export const STORE_STATUSES = [
  "active",
  "pending_review",
  "rejected",
  "suspended",
  "paused",
];

export const STORE_SUSPENDED_BY_REASONS = [
  "account_suspension",
  "store_suspension",
  "admin",
  "account_ban",
];
