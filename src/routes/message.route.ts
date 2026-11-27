import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import { messageWriteRateLimiter } from "../lib/rateLimit.ts";
import {
  createConversation,
  getConversationMessages,
  getMessagesCursor,
  updateConversation,
  listConversations,
  sendMessage,
  createOffer,
  createDeal,
  updateDealCheckIn,
  createDealReview,
  getParticipantProfile,
} from "../controllers/message.controller.ts";

const router = Router();

router.get("/participants/:id", authenticate, getParticipantProfile);
router.get("/conversations", authenticate, listConversations);
router.post("/conversations", authenticate, messageWriteRateLimiter, createConversation);
router.get("/conversations/:id", authenticate, getConversationMessages);
router.patch("/conversations/:id", authenticate, updateConversation);
router.get("/conversations/:id/messages", authenticate, getMessagesCursor);
router.post("/conversations/:id/messages", authenticate, messageWriteRateLimiter, sendMessage);
router.post("/conversations/:id/offers", authenticate, messageWriteRateLimiter, createOffer);
router.post("/conversations/:id/deal", authenticate, messageWriteRateLimiter, createDeal);
router.patch("/conversations/:id/deal", authenticate, messageWriteRateLimiter, updateDealCheckIn);
router.post("/conversations/:id/reviews", authenticate, messageWriteRateLimiter, createDealReview);

export default router;
