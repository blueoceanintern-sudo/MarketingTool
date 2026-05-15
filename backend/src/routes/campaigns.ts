import { Hono } from "hono";

type CampaignStatus = "draft" | "active" | "paused" | "complete";
type CompanySize = "small" | "medium" | "large" | "enterprise";

interface Campaign {
  id: string;
  name: string;
  vertical: string;
  geography: string;
  companySizeTarget: CompanySize;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
}

const campaigns = new Map<string, Campaign>();

export const campaignsRouter = new Hono();

campaignsRouter.post("/", async (c) => {
  const body = await c.req.json<Partial<Campaign>>();

  if (!body.name || !body.vertical || !body.geography || !body.companySizeTarget) {
    return c.json({ error: "name, vertical, geography, companySizeTarget are required" }, 400);
  }

  const campaign: Campaign = {
    id: crypto.randomUUID(),
    name: body.name,
    vertical: body.vertical,
    geography: body.geography,
    companySizeTarget: body.companySizeTarget,
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  campaigns.set(campaign.id, campaign);
  return c.json(campaign, 201);
});

campaignsRouter.get("/", (c) => {
  return c.json(Array.from(campaigns.values()));
});

campaignsRouter.get("/:id", (c) => {
  const campaign = campaigns.get(c.req.param("id"));
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);
  return c.json(campaign);
});

campaignsRouter.patch("/:id/status", async (c) => {
  const campaign = campaigns.get(c.req.param("id"));
  if (!campaign) return c.json({ error: "Campaign not found" }, 404);

  const body = await c.req.json<{ status: CampaignStatus }>();
  const validStatuses: CampaignStatus[] = ["draft", "active", "paused", "complete"];

  if (!validStatuses.includes(body.status)) {
    return c.json({ error: `status must be one of: ${validStatuses.join(", ")}` }, 400);
  }

  campaign.status = body.status;
  campaign.updatedAt = new Date().toISOString();
  campaigns.set(campaign.id, campaign);

  return c.json(campaign);
});
