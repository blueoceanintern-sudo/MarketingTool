import { Hono } from "hono";
import { db } from "../db";
import { emailDrafts, emailEvents, demos, suppressionList, promptTemplates } from "../db/schema";
import { isNotNull, count, eq, and, gte, sql } from "drizzle-orm";

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
    db.select({ total: sql<number>`count(DISTINCT ${emailEvents.leadId})` }).from(emailEvents).where(isNotNull(emailEvents.sentAt)),
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

analyticsRouter.get("/daily-sends", async (c) => {
  const daysParam = c.req.query("days");
  const days = Math.min(Math.max(parseInt(daysParam ?? "30", 10) || 30, 1), 90);

  const since = new Date();
  since.setDate(since.getDate() - days + 1);
  since.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${emailEvents.sentAt}), 'YYYY-MM-DD')`,
      total: count(),
    })
    .from(emailEvents)
    .where(and(isNotNull(emailEvents.sentAt), gte(emailEvents.sentAt, since)))
    .groupBy(sql`date_trunc('day', ${emailEvents.sentAt})`)
    .orderBy(sql`date_trunc('day', ${emailEvents.sentAt})`);

  const countByDate = new Map(rows.map((r) => [r.date, Number(r.total)]));
  const data = Array.from({ length: days }, (_, i) => {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    return { date: dateStr, count: countByDate.get(dateStr) ?? 0 };
  });

  return c.json({ data });
});

// Engagement comparison across prompt templates. Computed live by joining
// email_drafts → email_events; cheap because the data is small. If volume
// grows to where this is slow, add a template_performance cache table fed by
// a daily cron.
analyticsRouter.get("/templates", async (c) => {
  const templates = await db
    .select({
      id: promptTemplates.id,
      name: promptTemplates.name,
      description: promptTemplates.description,
      weight: promptTemplates.weight,
      active: promptTemplates.active,
      createdBy: promptTemplates.createdBy,
      parentTemplateId: promptTemplates.parentTemplateId,
    })
    .from(promptTemplates);

  if (templates.length === 0) return c.json([]);

  const stats = await db
    .select({
      templateId: emailDrafts.templateId,
      sent: sql<string>`count(*) FILTER (WHERE ${emailEvents.sentAt} IS NOT NULL)`,
      opened: sql<string>`count(*) FILTER (WHERE ${emailEvents.openedAt} IS NOT NULL)`,
      replied: sql<string>`count(*) FILTER (WHERE ${emailEvents.repliedAt} IS NOT NULL)`,
    })
    .from(emailDrafts)
    .leftJoin(emailEvents, eq(emailEvents.draftId, emailDrafts.id))
    .groupBy(emailDrafts.templateId);

  const statsByTemplate = new Map(stats.map((s) => [s.templateId, s]));

  return c.json(
    templates.map((t) => {
      const s = statsByTemplate.get(t.id);
      const sent = Number(s?.sent ?? 0);
      const opened = Number(s?.opened ?? 0);
      const replied = Number(s?.replied ?? 0);
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        weight: t.weight,
        active: t.active,
        created_by: t.createdBy,
        parent_template_id: t.parentTemplateId,
        sent,
        opened,
        replied,
        open_rate: sent > 0 ? Math.round((opened / sent) * 1000) / 10 : 0,
        reply_rate: sent > 0 ? Math.round((replied / sent) * 1000) / 10 : 0,
      };
    }),
  );
});

analyticsRouter.get("/export", async (c) => {
  const since = new Date();
  since.setDate(since.getDate() - 29);
  since.setHours(0, 0, 0, 0);

  const [
    leadsContactedRow,
    sentRow,
    openedRow,
    repliedRow,
    demosRow,
    pendingRow,
    suppressedRow,
    dailyRows,
  ] = await Promise.all([
    db.select({ total: sql<number>`count(DISTINCT ${emailEvents.leadId})` }).from(emailEvents).where(isNotNull(emailEvents.sentAt)),
    db.select({ total: count() }).from(emailEvents).where(isNotNull(emailEvents.sentAt)),
    db.select({ total: count() }).from(emailEvents).where(isNotNull(emailEvents.openedAt)),
    db.select({ total: count() }).from(emailEvents).where(isNotNull(emailEvents.repliedAt)),
    db.select({ total: count() }).from(demos),
    db.select({ total: count() }).from(emailDrafts).where(eq(emailDrafts.status, "pending_review")),
    db.select({ total: count() }).from(suppressionList),
    db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${emailEvents.sentAt}), 'YYYY-MM-DD')`,
        total: count(),
      })
      .from(emailEvents)
      .where(and(isNotNull(emailEvents.sentAt), gte(emailEvents.sentAt, since)))
      .groupBy(sql`date_trunc('day', ${emailEvents.sentAt})`)
      .orderBy(sql`date_trunc('day', ${emailEvents.sentAt})`),
  ]);

  const totalSent = Number(sentRow[0]?.total ?? 0);
  const totalOpened = Number(openedRow[0]?.total ?? 0);
  const totalReplied = Number(repliedRow[0]?.total ?? 0);
  const openRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 1000) / 10 : 0;
  const replyRate = totalSent > 0 ? Math.round((totalReplied / totalSent) * 1000) / 10 : 0;

  const countByDate = new Map(dailyRows.map((r) => [r.date, Number(r.total)]));
  const dailySection = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    return `${dateStr},${countByDate.get(dateStr) ?? 0}`;
  });

  const csv = [
    "Overview",
    "metric,value",
    `Total Leads Contacted,${Number(leadsContactedRow[0]?.total ?? 0)}`,
    `Total Emails Sent,${totalSent}`,
    `Total Opened,${totalOpened}`,
    `Total Replied,${totalReplied}`,
    `Total Demos Booked,${Number(demosRow[0]?.total ?? 0)}`,
    `Open Rate (%),${openRate}`,
    `Reply Rate (%),${replyRate}`,
    `Pending Review,${Number(pendingRow[0]?.total ?? 0)}`,
    `Total Suppressions,${Number(suppressedRow[0]?.total ?? 0)}`,
    "",
    "Daily Sends (Last 30 Days)",
    "date,emails_sent",
    ...dailySection,
  ].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=analytics-export.csv",
    },
  });
});
