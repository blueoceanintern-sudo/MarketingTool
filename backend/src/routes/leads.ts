import { Hono } from "hono";
import { db } from "../db";
import { leads, companies, campaigns, suppressionList, enrichmentRecords } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { enrichLead } from "../services/enrichment/orchestrator";

function formatLead(row: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: string | null;
  isVerified: boolean;
  status: string;
  emailStatus: string | null;
  enrichmentSource: string | null;
  routing: string | null;
  enrichedAt: Date | null;
  campaignId: string | null;
  createdAt: Date;
  companyName: string;
  campaignName: string | null;
}) {
  return {
    id: row.id,
    first_name: row.firstName ?? "",
    last_name: row.lastName ?? "",
    email: row.email,
    role: row.role ?? "",
    is_verified: row.isVerified,
    email_status: row.emailStatus,
    enrichment_source: row.enrichmentSource,
    routing: row.routing,
    enriched_at: row.enrichedAt?.toISOString() ?? null,
    status: row.status,
    company_name: row.companyName,
    campaign_id: row.campaignId ?? undefined,
    campaign_name: row.campaignName ?? undefined,
    created_at: row.createdAt.toISOString(),
  };
}

// Mounted at /api/v1/leads — all leads, no campaign filter
export const allLeadsRouter = new Hono();

allLeadsRouter.get("/", async (c) => {
  const rows = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      role: leads.role,
      isVerified: leads.isVerified,
      status: leads.status,
      emailStatus: leads.emailStatus,
      enrichmentSource: leads.enrichmentSource,
      routing: leads.routing,
      enrichedAt: leads.enrichedAt,
      campaignId: leads.campaignId,
      createdAt: leads.createdAt,
      companyName: companies.name,
      campaignName: campaigns.name,
    })
    .from(leads)
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .leftJoin(campaigns, eq(leads.campaignId, campaigns.id))
    .orderBy(leads.createdAt);

  return c.json(rows.map(formatLead));
});

// Mounted at /api/v1/campaigns — campaign-scoped lead endpoints
export const leadsRouter = new Hono();

leadsRouter.get("/:id/leads", async (c) => {
  const campaignId = c.req.param("id");

  const rows = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      role: leads.role,
      isVerified: leads.isVerified,
      status: leads.status,
      emailStatus: leads.emailStatus,
      enrichmentSource: leads.enrichmentSource,
      routing: leads.routing,
      enrichedAt: leads.enrichedAt,
      campaignId: leads.campaignId,
      createdAt: leads.createdAt,
      companyName: companies.name,
      campaignName: campaigns.name,
    })
    .from(leads)
    .innerJoin(companies, eq(leads.companyId, companies.id))
    .leftJoin(campaigns, eq(leads.campaignId, campaigns.id))
    .where(eq(leads.campaignId, campaignId))
    .orderBy(leads.createdAt);

  return c.json(rows.map(formatLead));
});

leadsRouter.post("/:id/leads/import", async (c) => {
  const campaignId = c.req.param("id");
  const text = await c.req.text();

  const rows = text.trim().split("\n");
  if (rows.length < 2) {
    return c.json({ error: "CSV must have a header row and at least one data row" }, 400);
  }

  const headers = (rows[0] ?? "").split(",").map((h) => h.trim().toLowerCase());
  const required = ["contact_name", "role", "email", "company_name", "industry", "market"];
  const missing = required.filter((f) => !headers.includes(f));
  if (missing.length > 0) {
    return c.json({ error: `Missing required columns: ${missing.join(", ")}` }, 400);
  }

  const imported: string[] = [];
  const skipped: string[] = [];
  const enrichmentQueue: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const values = (rows[i] ?? "").split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ""; });

    const email = row["email"] ?? "";
    if (!email) { skipped.push(`row ${i + 1}: missing email`); continue; }

    // Block suppressed emails — they opted out and must not be re-collected
    const [suppressed] = await db.select({ id: suppressionList.id }).from(suppressionList).where(eq(suppressionList.email, email)).limit(1);
    if (suppressed) { skipped.push(email); continue; }

    // Check for duplicate email
    const [existing] = await db.select({ id: leads.id }).from(leads).where(eq(leads.email, email)).limit(1);
    if (existing) { skipped.push(email); continue; }

    // Upsert company
    const companyName = row["company_name"] ?? "";
    let [company] = await db.select().from(companies).where(eq(companies.name, companyName)).limit(1);
    if (!company) {
      const size = (() => {
        const m = row["market"]?.toLowerCase() ?? "";
        if (m.includes("enterprise")) return "enterprise";
        if (m.includes("large")) return "large";
        if (m.includes("medium")) return "medium";
        return "small";
      })() as "small" | "medium" | "large" | "enterprise";

      const [inserted] = await db.insert(companies).values({
        name: companyName,
        industry: row["industry"] ?? "Unknown",
        companySize: size,
        location: row["market"] ?? "",
      }).returning();
      company = inserted!;
    }

    const nameParts = (row["contact_name"] ?? "").trim().split(/\s+/);
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.slice(1).join(" ") || "";

    const [lead] = await db.insert(leads).values({
      companyId: company.id,
      campaignId,
      firstName,
      lastName,
      email,
      role: row["role"] ?? "",
      isVerified: false,
      emailStatus: "pattern_guessed",
      status: "new",
    }).returning();

    imported.push(email);
    if (lead) enrichmentQueue.push(lead.id);
  }

  // Enrichment runs async — orchestrator owns pipeline_flags + routing.
  // Worker `enrichment-retry` catches any failures.
  for (const leadId of enrichmentQueue) {
    void enrichLead(leadId).catch((err) => {
      console.error(`[leads/import] enrichment failed for ${leadId}:`, err);
    });
  }

  return c.json(
    { imported: imported.length, skipped: skipped.length, enrichment_queued: enrichmentQueue.length },
    201,
  );
});

allLeadsRouter.get("/:id/enrichment", async (c) => {
  const leadId = c.req.param("id");
  const [record] = await db
    .select()
    .from(enrichmentRecords)
    .where(eq(enrichmentRecords.leadId, leadId))
    .orderBy(desc(enrichmentRecords.enrichedAt))
    .limit(1);

  if (!record) return c.json({ error: "No enrichment record for this lead" }, 404);

  return c.json({
    lead_id: record.leadId,
    enriched_at: record.enrichedAt.toISOString(),
    enrichment_source: record.enrichmentSource,
    market: record.market,
    institution: record.institution,
    contact: record.contact,
    pipeline_flags: record.pipelineFlags,
    routing: record.routing,
    routing_reason: record.routingReason,
  });
});
