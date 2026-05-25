import { scrapeWebsite } from "./services/scrapers/cheerioScraper";
import { campaignsRouter } from "./routes/campaigns";
import { leadsRouter, allLeadsRouter } from "./routes/leads";
import { draftsRouter } from "./routes/drafts";
import { repliesRouter } from "./routes/replies";
import { demosRouter } from "./routes/demos";
import { analyticsRouter } from "./routes/analytics";
import { adminRouter } from "./routes/admin";
import "./workers";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { db } from "./db";
import { leads, suppressionList } from "./db/schema";
import { eq } from "drizzle-orm";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

app.route("/api/v1/campaigns", campaignsRouter);
app.route("/api/v1/campaigns", leadsRouter);
app.route("/api/v1/leads", allLeadsRouter);
app.route("/api/v1/drafts", draftsRouter);
app.route("/api/v1", repliesRouter);
app.route("/api/v1/demos", demosRouter);
app.route("/api/v1/analytics", analyticsRouter);
app.route("/api/v1", adminRouter);

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

// One-click unsubscribe — SES links here; adds email to suppression list then redirects to confirmation page
app.get("/unsubscribe", async (c) => {
  const leadId = c.req.query("id");
  if (!leadId) return c.text("Invalid unsubscribe link.", 400);

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return c.text("Unsubscribe link not recognised.", 404);

  await db
    .insert(suppressionList)
    .values({ email: lead.email, reason: "unsubscribed" })
    .onConflictDoNothing();

  await db
    .update(leads)
    .set({ status: "suppressed" })
    .where(eq(leads.id, leadId));

  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
  return c.redirect(`${frontendUrl}/unsubscribe.html`, 302);
});

export default app;
