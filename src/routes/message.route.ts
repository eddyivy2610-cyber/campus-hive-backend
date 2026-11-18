import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.ts";
import {
  createConversation,
  getConversationMessages,
  sendMessage,
  createOffer,
  createDeal,
} from "../controllers/message.controller.ts";

const router = Router();

router.post("/conversations", authenticate, createConversation);
router.get("/conversations/:id", authenticate, getConversationMessages);
router.post("/conversations/:id/messages", authenticate, sendMessage);
router.post("/conversations/:id/offers", authenticate, createOffer);
router.post("/conversations/:id/deal", authenticate, createDeal);

export default router;
