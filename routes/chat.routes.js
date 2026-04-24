import { Router } from "express";
import { getUserConversations, getMessages, sendMessage, getOrCreateConversation } from "../controllers/chat.controller.js";
import { protect } from "../utils/auth.js";

const router = Router();

router.get("/user/:userId", getUserConversations);
router.get("/:conversationId/messages", getMessages);
router.post("/send", sendMessage);
router.post("/conversation", getOrCreateConversation);

export default router;
