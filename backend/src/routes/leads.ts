import { Hono } from "hono";

interface Lead {
  id: string;
  campaignId: string;
  contactName: string;
  role: string;
  email: string;
  companyName: string;
  industry: string;
  market: string;
  flagged: boolean;
  flagReason?: string;
  createdAt: string;
}

// campaignId -> Lead[]
const leadsByCampaign = new Map<string, Lead[]>();

export const leadsRouter = new Hono();

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

  const imported: Lead[] = [];
  const flagged: Lead[] = [];

  for (let i = 1; i < rows.length; i++) {
    const values = (rows[i] ?? "").split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ""; });

    const missingFields = required.filter((f) => !row[f]);
    const lead: Lead = {
      id: crypto.randomUUID(),
      campaignId,
      contactName: row["contact_name"] ?? "",
      role: row["role"] ?? "",
      email: row["email"] ?? "",
      companyName: row["company_name"] ?? "",
      industry: row["industry"] ?? "",
      market: row["market"] ?? "",
      flagged: missingFields.length > 0,
      flagReason: missingFields.length > 0 ? `Missing: ${missingFields.join(", ")}` : undefined,
      createdAt: new Date().toISOString(),
    };

    if (lead.flagged) {
      flagged.push(lead);
    } else {
      imported.push(lead);
    }

    const existing = leadsByCampaign.get(campaignId) ?? [];
    leadsByCampaign.set(campaignId, [...existing, lead]);
  }

  return c.json({ imported: imported.length, flagged: flagged.length, leads: [...imported, ...flagged] }, 201);
});

leadsRouter.get("/:id/leads", (c) => {
  const campaignId = c.req.param("id");
  const leads = leadsByCampaign.get(campaignId) ?? [];
  return c.json(leads);
});
