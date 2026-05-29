import { Hono } from "hono";
import { db } from "../db";
import { emailDrafts, leads, campaigns } from "../db/schema";
import { eq, and } from "drizzle-orm";

function formatDraft(row: {
  id: string;
  leadId: string;
  campaignId: string;
  templateId: string;
  subject: string;
  body: string;
  confidenceScore: number;
  status: string;
  createdAt: Date;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadRole: string | null;
  campaignName: string;
}) {
  return {
    id: row.id,
    lead_id: row.leadId,
    lead_name: [row.leadFirstName, row.leadLastName].filter(Boolean).join(" "),
    lead_role: row.leadRole ?? "",
    campaign_id: row.campaignId,
    campaign_name: row.campaignName,
    template_id: row.templateId,
    subject: row.subject,
    body: row.body,
    confidence_score: row.confidenceScore,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

async function getDraftWithJoins(draftId: string) {
  const [row] = await db
    .select({
      id: emailDrafts.id,
      leadId: emailDrafts.leadId,
      campaignId: emailDrafts.campaignId,
      templateId: emailDrafts.templateId,
      subject: emailDrafts.subject,
      body: emailDrafts.body,
      confidenceScore: emailDrafts.confidenceScore,
      status: emailDrafts.status,
      createdAt: emailDrafts.createdAt,
      leadFirstName: leads.firstName,
      leadLastName: leads.lastName,
      leadRole: leads.role,
      campaignName: campaigns.name,
    })
    .from(emailDrafts)
    .innerJoin(leads, eq(emailDrafts.leadId, leads.id))
    .innerJoin(campaigns, eq(emailDrafts.campaignId, campaigns.id))
    .where(eq(emailDrafts.id, draftId))
    .limit(1);
  return row;
}

export const draftsRouter = new Hono();

draftsRouter.get("/queue", async (c) => {
  const rows = await db
    .select({
      id: emailDrafts.id,
      leadId: emailDrafts.leadId,
      campaignId: emailDrafts.campaignId,
      templateId: emailDrafts.templateId,
      subject: emailDrafts.subject,
      body: emailDrafts.body,
      confidenceScore: emailDrafts.confidenceScore,
      status: emailDrafts.status,
      createdAt: emailDrafts.createdAt,
      leadFirstName: leads.firstName,
      leadLastName: leads.lastName,
      leadRole: leads.role,
      campaignName: campaigns.name,
    })
    .from(emailDrafts)
    .innerJoin(leads, eq(emailDrafts.leadId, leads.id))
    .innerJoin(campaigns, eq(emailDrafts.campaignId, campaigns.id))
    .where(eq(emailDrafts.status, "pending_review"))
    .orderBy(emailDrafts.createdAt);

  return c.json(rows.map(formatDraft));
});

draftsRouter.patch("/:id/approve", async (c) => {
  const draftId = c.req.param("id");
  const [draft] = await db.select().from(emailDrafts).where(eq(emailDrafts.id, draftId)).limit(1);
  if (!draft) return c.json({ error: "Draft not found" }, 404);
  if (draft.status !== "pending_review") {
    return c.json({ error: `Cannot approve a draft with status '${draft.status}'` }, 409);
  }

  await db.update(emailDrafts).set({ status: "scheduled" }).where(eq(emailDrafts.id, draftId));
  const row = await getDraftWithJoins(draftId);
  if (!row) return c.json({ error: "Draft not found after update" }, 500);
  return c.json(formatDraft(row));
});

draftsRouter.patch("/:id/reject", async (c) => {
  const draftId = c.req.param("id");
  const [draft] = await db.select().from(emailDrafts).where(eq(emailDrafts.id, draftId)).limit(1);
  if (!draft) return c.json({ error: "Draft not found" }, 404);
  if (draft.status !== "pending_review") {
    return c.json({ error: `Cannot reject a draft with status '${draft.status}'` }, 409);
  }

  await db.update(emailDrafts).set({ status: "rejected" }).where(eq(emailDrafts.id, draftId));
  const row = await getDraftWithJoins(draftId);
  if (!row) return c.json({ error: "Draft not found after update" }, 500);
  return c.json(formatDraft(row));
});

draftsRouter.patch("/:id/edit", async (c) => {
  const draftId = c.req.param("id");
  const [draft] = await db.select().from(emailDrafts).where(eq(emailDrafts.id, draftId)).limit(1);
  if (!draft) return c.json({ error: "Draft not found" }, 404);
  if (draft.status === "sent") return c.json({ error: "Cannot edit a sent draft" }, 409);

  const body = await c.req.json<{ subject?: string; body?: string }>();
  if (!body.subject && !body.body) {
    return c.json({ error: "Provide subject or body to edit" }, 400);
  }

  const updates: Partial<{ subject: string; body: string; confidenceScore: number; status: "pending_review" }> = {
    status: "pending_review",
  };
  if (body.subject) updates.subject = body.subject;
  if (body.body) {
    updates.body = body.body;
    updates.confidenceScore = scoreBody(body.body);
  }

  await db.update(emailDrafts).set(updates).where(eq(emailDrafts.id, draftId));
  const row = await getDraftWithJoins(draftId);
  if (!row) return c.json({ error: "Draft not found after update" }, 500);
  return c.json(formatDraft(row));
});

function scoreBody(body: string): number {
  const wordCount = body.trim().split(/\s+/).length;
  if (wordCount > 125) return 40;
  if (wordCount < 20) return 50;
  return 75;
}
