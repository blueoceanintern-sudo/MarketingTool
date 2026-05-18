import { Hono } from "hono";
import { db } from "../db";
import { emailDrafts, emailEvents, leads, demos, suppressionList, templatePerformance } from "../db/schema";
import { isNotNull, count, ne, eq } from "drizzle-orm";

export const analyticsRouter = new Hono();

analyticsRouter.get("/overview", async (c) => {
  const [
    leadsContactedRow,
    sentRow,
    openedRow,
    repliedRow,
    demosRow,
    pendingRow,
    suppressedRow,
  ] = await Promise.all([
    db.select({ total: count() }).from(leads).where(ne(leads.status, "new")),
    db.select({ total: count() }).from(emailEvents).where(isNotNull(emailEvents.sentAt)),
    db.select({ total: count() }).from(emailEvents).where(isNotNull(emailEvents.openedAt)),
    db.select({ total: count() }).from(emailEvents).where(isNotNull(emailEvents.repliedAt)),
    db.select({ total: count() }).from(demos),
    db.select({ total: count() }).from(emailDrafts).where(eq(emailDrafts.status, "pending_review")),
    db.select({ total: count() }).from(suppressionList),
  ]);

  const totalSent = Number(sentRow[0]?.total ?? 0);
  const totalOpened = Number(openedRow[0]?.total ?? 0);
  const totalReplied = Number(repliedRow[0]?.total ?? 0);

  return c.json({
    total_leads_contacted: Number(leadsContactedRow[0]?.total ?? 0),
    total_sent: totalSent,
    total_opened: totalOpened,
    total_replied: totalReplied,
    total_demos: Number(demosRow[0]?.total ?? 0),
    pending_review: Number(pendingRow[0]?.total ?? 0),
    total_suppressions: Number(suppressedRow[0]?.total ?? 0),
    open_rate: totalSent > 0 ? Math.round((totalOpened / totalSent) * 1000) / 10 : 0,
    reply_rate: totalSent > 0 ? Math.round((totalReplied / totalSent) * 1000) / 10 : 0,
  });
});

analyticsRouter.get("/templates", async (c) => {
  const rows = await db.select().from(templatePerformance).orderBy(templatePerformance.replyRate);
  return c.json(rows.map((r) => ({
    id: r.id,
    campaign_id: r.campaignId,
    persona: r.persona,
    open_rate: r.openRate,
    reply_rate: r.replyRate,
    last_calculated_at: r.lastCalculatedAt.toISOString(),
  })));
});

analyticsRouter.get("/export", async (c) => {
  const rows = await db
    .select({
      id: emailDrafts.id,
      leadId: emailDrafts.leadId,
      campaignId: emailDrafts.campaignId,
      persona: emailDrafts.persona,
      status: emailDrafts.status,
      confidenceScore: emailDrafts.confidenceScore,
      createdAt: emailDrafts.createdAt,
    })
    .from(emailDrafts)
    .orderBy(emailDrafts.createdAt);

  const csv = [
    "id,lead_id,campaign_id,persona,status,confidence_score,created_at",
    ...rows.map((r) =>
      [r.id, r.leadId, r.campaignId, r.persona, r.status, r.confidenceScore, r.createdAt.toISOString()].join(",")
    ),
  ].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=drafts-export.csv",
    },
  });
});
