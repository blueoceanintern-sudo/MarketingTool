import { scrapeWebsite } from "./services/scrapers/cheerioScraper";
import { campaignsRouter } from "./routes/campaigns";
import { leadsRouter } from "./routes/leads";
import { draftsRouter } from "./routes/drafts";
import { repliesRouter } from "./routes/replies";
import { demosRouter } from "./routes/demos";
import { analyticsRouter } from "./routes/analytics";
import { adminRouter } from "./routes/admin";
import "./workers";

import { Hono } from "hono";

const app = new Hono();

app.route("/api/v1/campaigns", campaignsRouter);
app.route("/api/v1/campaigns", leadsRouter);
app.route("/api/v1/drafts", draftsRouter);
app.route("/api/v1", repliesRouter);
app.route("/api/v1/demos", demosRouter);
app.route("/api/v1/analytics", analyticsRouter);
app.route("/api/v1", adminRouter);

app.get("/", (c) => {
  return c.text("Backend running");
});

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    message: "Server healthy",
  });
});

app.get("/scrape", async (c) => {
  const url = c.req.query("url");

  if (!url) {
    return c.json(
      {
        error: "Missing url query param",
      },
      400
    );
  }

  try {
    const result = await scrapeWebsite(url);

    return c.json(result);
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      500
    );
  }
});

export default app;