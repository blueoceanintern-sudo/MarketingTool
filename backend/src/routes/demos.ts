import { Hono } from "hono";
import { db } from "../db";
import { demos, leads, companies, campaigns } from "../db/schema";
import { eq, sql } from "drizzle-orm";

function formatDemo(row: {
  id: string;
  leadId: string;
  campaignId: string;
  assignedTo: string | null;
  status: string;
  createdAt: Date;
  leadName: string | null;
  companyName: string;
}) {
  return {
    id: row.id,
    lead_id: row.leadId,
    lead_name: row.leadName ?? "",
    lead_company: row.companyName,
    campaign_id: row.campaignId,
    assigned_to: row.assignedTo ?? "",
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

const demosJoinQuery = () =>
  db
    .select({
      id: demos.id,
      leadId: demos.leadId,
      campaignId: demos.campaignId,
      assignedTo: demos.assignedTo,
      status: demos.status,
      createdAt: demos.createdAt,
      leadName: leads.name,
      companyName: companies.name,
    })
    .from(demos)
    .innerJoin(leads, eq(demos.leadId, leads.id))
    .innerJoin(companies, eq(leads.companyId, companies.id));

export const demosRouter = new Hono();

demosRouter.get("/", async (c) => {
  const rows = await demosJoinQuery().orderBy(demos.createdAt);
  return c.json(rows.map(formatDemo));
});

demosRouter.post("/", async (c) => {
  const body = await c.req.json<{
    lead_id?: string;
    campaign_id?: string;
    reply_id?: string;
    assigned_to?: string;
  }>();

  if (!body.lead_id || !body.campaign_id || !body.reply_id) {
    return c.json({ error: "lead_id, campaign_id, reply_id are required" }, 400);
  }

  const [row] = await db
    .insert(demos)
    .values({
      leadId: body.lead_id,
      campaignId: body.campaign_id,
      replyId: body.reply_id,
      assignedTo: body.assigned_to ?? null,
      status: "pending",
    })
    .returning();

  if (!row) return c.json({ error: "Failed to create demo" }, 500);

  const [joined] = await demosJoinQuery().where(eq(demos.id, row.id)).limit(1);
  if (!joined) return c.json({ error: "Demo created but join failed" }, 500);

  return c.json(formatDemo(joined), 201);
});

demosRouter.patch("/:id/assign", async (c) => {
  const demoId = c.req.param("id");
  const [demo] = await db.select().from(demos).where(eq(demos.id, demoId)).limit(1);
  if (!demo) return c.json({ error: "Demo not found" }, 404);

  const body = await c.req.json<{ assigned_to?: string }>();
  if (!body.assigned_to) return c.json({ error: "assigned_to is required" }, 400);

  await db
    .update(demos)
    .set({ assignedTo: body.assigned_to, status: "scheduled" })
    .where(eq(demos.id, demoId));

  const [joined] = await demosJoinQuery().where(eq(demos.id, demoId)).limit(1);
  if (!joined) return c.json({ error: "Demo not found after update" }, 500);
  return c.json(formatDemo(joined));
});
