import { Hono } from "hono";
import { db } from "../db";
import { emailDrafts, leads, campaigns } from "../db/schema";
import { count, eq, and, sql } from "drizzle-orm";
import { logAudit } from "../services/audit/log";
import type { AuthUser } from "../middleware/auth";

function formatDraft(row: {
  id: string;
  leadId: string;
  campaignId: string;
  templateId: string;
  subject: string;
  body: string;
  confidenceScore: number;
  scoreBreakdown: { painPointFit: number; campaignAlignment: number; personalisationQuality: number; lengthCompliance: number } | null;
  status: string;
  createdAt: Date;
  leadName: string | null;
  leadRole: string | null;
  campaignName: string;
}) {
  return {
    id: row.id,
    lead_id: row.leadId,
    lead_name: row.leadName ?? "",
    lead_role: row.leadRole ?? "",
    campaign_id: row.campaignId,
    campaign_name: row.campaignName,
    template_id: row.templateId,
    subject: row.subject,
    body: row.body,
    confidence_score: row.confidenceScore,
    score_breakdown: row.scoreBreakdown,
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
      scoreBreakdown: emailDrafts.scoreBreakdown,
      status: emailDrafts.status,
      createdAt: emailDrafts.createdAt,
      leadName: sql<string | null>`NULLIF(CONCAT_WS(' ', ${leads.firstName}, ${leads.lastName}), '')`,
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

export const draftsRouter = new Hono<{ Variables: { user: AuthUser } }>();

// GET /drafts?status=scheduled|sent  — for the scheduled/sent views in the UI.
// Returns drafts grouped by campaign_id (client sorts/groups from the flat array).
const ALLOWED_LIST_STATUSES = ["scheduled", "sent"] as const;
type ListStatus = (typeof ALLOWED_LIST_STATUSES)[number];

draftsRouter.get("/", async (c) => {
  const statusParam = c.req.query("status") as ListStatus | undefined;
  if (!statusParam || !ALLOWED_LIST_STATUSES.includes(statusParam)) {
    return c.json({ error: "status query param must be 'scheduled' or 'sent'" }, 400);
  }

  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50));
  const offset = (page - 1) * limit;

  const where = eq(emailDrafts.status, statusParam);

  const [countRow] = await db
    .select({ total: count() })
    .from(emailDrafts)
    .where(where);
  const total = Number(countRow?.total ?? 0);

  const rows = await db
    .select({
      id: emailDrafts.id,
      leadId: emailDrafts.leadId,
      campaignId: emailDrafts.campaignId,
      templateId: emailDrafts.templateId,
      subject: emailDrafts.subject,
      body: emailDrafts.body,
      confidenceScore: emailDrafts.confidenceScore,
      scoreBreakdown: emailDrafts.scoreBreakdown,
      status: emailDrafts.status,
      createdAt: emailDrafts.createdAt,
      leadName: sql<string | null>`NULLIF(CONCAT_WS(' ', ${leads.firstName}, ${leads.lastName}), '')`,
      leadRole: leads.role,
      campaignName: campaigns.name,
    })
    .from(emailDrafts)
    .innerJoin(leads, eq(emailDrafts.leadId, leads.id))
    .innerJoin(campaigns, eq(emailDrafts.campaignId, campaigns.id))
    .where(where)
    .orderBy(campaigns.name, emailDrafts.createdAt)
    .limit(limit)
    .offset(offset);

  return c.json({
    data: rows.map(formatDraft),
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
  });
});

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
      scoreBreakdown: emailDrafts.scoreBreakdown,
      status: emailDrafts.status,
      createdAt: emailDrafts.createdAt,
      leadName: sql<string | null>`NULLIF(CONCAT_WS(' ', ${leads.firstName}, ${leads.lastName}), '')`,
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
  await logAudit({
    actor: c.get("user"),
    action: "draft.approve",
    targetId: draftId,
    targetType: "email_draft",
    ipAddress: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? null,
  });
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
  await logAudit({
    actor: c.get("user"),
    action: "draft.reject",
    targetId: draftId,
    targetType: "email_draft",
    ipAddress: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? null,
  });
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
  await logAudit({
    actor: c.get("user"),
    action: "draft.edit",
    targetId: draftId,
    targetType: "email_draft",
    ipAddress: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? null,
    metadata: { changed: Object.keys(updates).filter((k) => k !== "status") },
  });
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
