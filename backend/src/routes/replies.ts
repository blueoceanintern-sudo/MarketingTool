import { Hono } from "hono";

type Sentiment = "positive" | "negative" | "neutral";
type ReplyCategory = "positive" | "unsubscribe" | "negative" | "question" | "hostile" | "neutral";

interface Reply {
  id: string;
  emailEventId: string;
  leadId: string;
  body: string;
  sentiment: Sentiment;
  category: ReplyCategory;
  resolved: boolean;
  receivedAt: string;
}

const replies = new Map<string, Reply>();

// suppression list shared with sender (keyed by email address)
export const suppressionList = new Set<string>();

export const repliesRouter = new Hono();

repliesRouter.post("/webhooks/ses/reply", async (c) => {
  const body = await c.req.json<{
    emailEventId: string;
    leadId: string;
    leadEmail: string;
    body: string;
  }>();

  if (!body.emailEventId || !body.leadId || !body.leadEmail || !body.body) {
    return c.json({ error: "emailEventId, leadId, leadEmail, body are required" }, 400);
  }

  const category = classifyReply(body.body);
  const sentiment = categoryToSentiment(category);

  const reply: Reply = {
    id: crypto.randomUUID(),
    emailEventId: body.emailEventId,
    leadId: body.leadId,
    body: body.body,
    sentiment,
    category,
    resolved: false,
    receivedAt: new Date().toISOString(),
  };

  replies.set(reply.id, reply);

  if (category === "unsubscribe" || category === "negative" || category === "hostile") {
    suppressionList.add(body.leadEmail);
  }

  return c.json({ reply, action: resolveAction(category) }, 201);
});

repliesRouter.get("/replies/flagged", (c) => {
  const flagged = Array.from(replies.values()).filter(
    (r) => !r.resolved && (r.category === "question" || r.category === "hostile")
  );
  return c.json(flagged);
});

repliesRouter.patch("/replies/:id/resolve", (c) => {
  const reply = replies.get(c.req.param("id"));
  if (!reply) return c.json({ error: "Reply not found" }, 404);

  reply.resolved = true;
  replies.set(reply.id, reply);
  return c.json(reply);
});

function classifyReply(body: string): ReplyCategory {
  const lower = body.toLowerCase();
  if (/unsubscribe|opt.?out|remove me|stop emailing/i.test(lower)) return "unsubscribe";
  if (/legal|lawsuit|report|spam|attorney|solicitor/i.test(lower)) return "hostile";
  if (/interested|yes|love to|sounds good|tell me more|book|call|demo/i.test(lower)) return "positive";
  if (/\?|how|what|when|who|where|clarif|more info/i.test(lower)) return "question";
  return "neutral";
}

function categoryToSentiment(category: ReplyCategory): Sentiment {
  if (category === "positive") return "positive";
  if (category === "unsubscribe" || category === "hostile" || category === "negative") return "negative";
  return "neutral";
}

function resolveAction(category: ReplyCategory): string {
  switch (category) {
    case "positive": return "demo_booking";
    case "unsubscribe":
    case "negative": return "suppressed";
    case "hostile": return "risk_flagged_and_suppressed";
    case "question": return "flagged_for_review";
    default: return "flagged_for_review";
  }
}
