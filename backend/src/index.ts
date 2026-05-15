import { scrapeWebsite } from "./services/scrapers/cheerioScraper";

import { Hono } from "hono";

const app = new Hono();

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