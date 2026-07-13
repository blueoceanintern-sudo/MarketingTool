import { scrapeWebsite } from "./services/scrapers/cheerioScraper";
import { campaignsRouter } from "./routes/campaigns";
import { leadsRouter, allLeadsRouter } from "./routes/leads";
import { draftsRouter } from "./routes/drafts";
import { repliesRouter } from "./routes/replies";
import { demosRouter } from "./routes/demos";
import { analyticsRouter } from "./routes/analytics";
import { adminRouter } from "./routes/admin";
import { eventsRouter } from "./routes/events";
import { geoRouter } from "./routes/geo";
import { startJobEventListener } from "./services/events";
import "./workers";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { db } from "./db";
import { leads, suppressionList, campaignLeadExclusions } from "./db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "./middleware/auth";

const app = new Hono();

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// All /api/v1/* routes require a valid session token.
const api = new Hono();
api.use("*", requireAuth);
api.route("/campaigns", campaignsRouter);
api.route("/campaigns", leadsRouter);
api.route("/leads", allLeadsRouter);
api.route("/drafts", draftsRouter);
api.route("", repliesRouter);
api.route("/demos", demosRouter);
api.route("/analytics", analyticsRouter);
api.route("", adminRouter);
api.route("", eventsRouter);
api.route("", geoRouter);

app.route("/api/v1", api);

// Start the Postgres LISTEN connection that fans job events out to SSE clients.
void startJobEventListener();

app.get("/", (c) => c.text("Backend running"));

app.get("/health", (c) =>
  c.json({ status: "ok", message: "Server healthy" })
);

app.get("/scrape", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ error: "Missing url query param" }, 400);

  try {
    const result = await scrapeWebsite(url);
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

// One-click unsubscribe — SES links here with lead + campaign context.
// Suppresses the lead for that campaign only and excludes them from future
// scrape/CSV re-adds for the same campaign.
app.get("/unsubscribe", async (c) => {
  const leadId = c.req.query("id");
  const campaignId = c.req.query("campaign");
  if (!leadId || !campaignId) return c.text("Invalid unsubscribe link.", 400);

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return c.text("Unsubscribe link not recognised.", 404);

  await Promise.all([
    db
      .insert(suppressionList)
      .values({ email: lead.email, campaignId, reason: "unsubscribed" })
      .onConflictDoNothing(),
    db
      .insert(campaignLeadExclusions)
      .values({ leadId, campaignId, excludedBy: "unsubscribe", reason: "unsubscribed" })
      .onConflictDoNothing(),
  ]);

  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
  return c.redirect(`${frontendUrl}/unsubscribe.html`, 302);
});

export default {
  port: Number(process.env.PORT ?? 3001),
  fetch: app.fetch,
  // SSE keepalive pings every 25s — idle timeout must exceed that.
  // 0 = no timeout (safe for an internal tool).
  idleTimeout: 0,
};
