import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
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
router.post("/conversations", authenticate, createConversation);
router.get("/conversations/:id", authenticate, getConversationMessages);
router.patch("/conversations/:id", authenticate, updateConversation);
router.get("/conversations/:id/messages", authenticate, getMessagesCursor);
router.post("/conversations/:id/messages", authenticate, sendMessage);
router.post("/conversations/:id/offers", authenticate, createOffer);
router.post("/conversations/:id/deal", authenticate, createDeal);
router.patch("/conversations/:id/deal", authenticate, updateDealCheckIn);
router.post("/conversations/:id/reviews", authenticate, createDealReview);

export default router;
