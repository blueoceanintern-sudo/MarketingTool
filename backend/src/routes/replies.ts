import { Hono } from "hono";
import { db } from "../db";
import { replies, emailEvents, leads, companies, emailDrafts, campaigns, suppressionList, riskFlags } from "../db/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";

function formatReply(row: {
  id: string;
  body: string;
  sentiment: string;
  category: string;
  receivedAt: Date;
  resolvedAt: Date | null;
  leadId: string;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadEmail: string;
  companyName: string;
  campaignId: string;
  campaignName: string;
}) {
  const isQuestion = row.category === "question";
  const isHostile = row.category === "hostile";
  return {
    id: row.id,
    lead_id: row.leadId,
    lead_name: [row.leadFirstName, row.leadLastName].filter(Boolean).join(" "),
    lead_email: row.leadEmail,
    lead_company: row.companyName,
    campaign_id: row.campaignId,
    campaign_name: row.campaignName,
    body: row.body,
    sentiment: row.sentiment,
    category: row.category,
    received_at: row.receivedAt.toISOString(),
    resolved_at: row.resolvedAt?.toISOString() ?? null,
    is_flagged: (isQuestion || isHostile) && row.resolvedAt === null,
  };
}

const repliesJoinQuery = () =>
  db
    .select({
      id: replies.id,
      body: replies.body,
      sentiment: replies.sentiment,
      category: replies.category,
      receivedAt: replies.receivedAt,
      resolvedAt: replies.resolvedAt,
      leadId: leads.id,
      leadFirstName: leads.firstName,
      leadLastName: leads.lastName,
      leadEmail: leads.email,
      companyName: companies.name,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
    })
    .from(replies)
    .innerJoin(emailEvents, eq(replies.emailEventId, emailEvents.id))
    .innerJoin(leads, eq(emailEvents.leadId, leads.id))
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .innerJoin(emailDrafts, eq(emailEvents.draftId, emailDrafts.id))
    .innerJoin(campaigns, eq(emailDrafts.campaignId, campaigns.id));

export const repliesRouter = new Hono();

repliesRouter.get("/replies", async (c) => {
  const rows = await repliesJoinQuery().orderBy(replies.receivedAt);
  return c.json(rows.map(formatReply));
});

repliesRouter.get("/replies/flagged", async (c) => {
  const rows = await repliesJoinQuery()
    .where(and(isNull(replies.resolvedAt), inArray(replies.category, ["question", "hostile"])))
    .orderBy(replies.receivedAt);
  return c.json(rows.map(formatReply));
});

repliesRouter.patch("/replies/:id/resolve", async (c) => {
  const [reply] = await db
    .select()
    .from(replies)
    .where(eq(replies.id, c.req.param("id")))
    .limit(1);
  if (!reply) return c.json({ error: "Reply not found" }, 404);

  await db.update(replies).set({ resolvedAt: new Date() }).where(eq(replies.id, reply.id));
  return c.json({ id: reply.id, resolved: true });
});

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

  const [emailEvent] = await db
    .select()
    .from(emailEvents)
    .where(eq(emailEvents.id, body.emailEventId))
    .limit(1);
  if (!emailEvent) return c.json({ error: "Email event not found" }, 404);

  const category = classifyReply(body.body);
  const sentiment = categoryToSentiment(category);

  const [reply] = await db
    .insert(replies)
    .values({
      emailEventId: body.emailEventId,
      body: body.body,
      sentiment,
      category,
    })
    .returning();

  await db.update(emailEvents).set({ repliedAt: new Date() }).where(eq(emailEvents.id, body.emailEventId));

  if (category === "unsubscribe" || category === "negative" || category === "hostile") {
    // Add to suppression list (upsert)
    await db
      .insert(suppressionList)
      .values({
        email: body.leadEmail,
        reason: category === "hostile" ? "hostile" : "unsubscribed",
      })
      .onConflictDoNothing();
  }

  if (category === "hostile") {
    await db.insert(riskFlags).values({
      leadId: body.leadId,
      flagType: "hostile_interaction",
    });
  }

  return c.json({ reply, action: resolveAction(category) }, 201);
});

function classifyReply(body: string): string {
  const lower = body.toLowerCase();
  if (/unsubscribe|opt.?out|remove me|stop emailing/i.test(lower)) return "unsubscribe";
  if (/legal|lawsuit|report|spam|attorney|solicitor/i.test(lower)) return "hostile";
  if (/interested|yes|love to|sounds good|tell me more|book|call|demo/i.test(lower)) return "positive";
  if (/\?|how|what|when|who|where|clarif|more info/i.test(lower)) return "question";
  return "neutral";
}

function categoryToSentiment(category: string): "positive" | "negative" | "neutral" {
  if (category === "positive") return "positive";
  if (["unsubscribe", "hostile", "negative"].includes(category)) return "negative";
  return "neutral";
}

function resolveAction(category: string): string {
  switch (category) {
    case "positive": return "demo_booking";
    case "unsubscribe":
    case "negative": return "suppressed";
    case "hostile": return "risk_flagged_and_suppressed";
    case "question": return "flagged_for_review";
    default: return "flagged_for_review";
  }
}
