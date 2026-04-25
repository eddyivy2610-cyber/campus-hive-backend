import { Router } from "express";
import { getUserConversations, getMessages, sendMessage, getOrCreateConversation, endNegotiation, confirmEndNegotiation } from "../controllers/chat.controller.js";
import { protect } from "../utils/auth.js";

const router = Router();

router.get("/user/:userId", getUserConversations);
router.get("/:conversationId/messages", getMessages);
router.post("/send", sendMessage);
router.post("/conversation", getOrCreateConversation);
router.post("/negotiation/end", endNegotiation);
router.post("/negotiation/confirm", confirmEndNegotiation);

export default router;
