import { Hono } from "hono";
import { db } from "../db";
import { sourceRegistry, suppressionList, promptTemplates, emailDrafts, campaigns, normalizeVertical, normalizeGeo } from "../db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logAudit } from "../services/audit/log";
import { DIRECTORY_CONFIGS, discoverSources, getDirectoryConfig } from "../services/sourceRegistry";

export const adminRouter = new Hono();

adminRouter.get("/registry/sources", async (c) => {
  const rows = await db.select().from(sourceRegistry).orderBy(sourceRegistry.createdAt);
  return c.json(rows.map((r) => ({
    id: r.id,
    name: r.name,
    vertical: r.vertical,
    geo: r.geo,
    url: r.url,
    scraper_type: r.scraperType,
    legal_flag: r.legalFlag,
    selectors: r.selectors,
    active: r.active,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  })));
});

adminRouter.post("/registry/sources", async (c) => {
  const body = await c.req.json<{
    name?: string;
    vertical?: string;
    geo?: string;
    url?: string;
    scraper_type?: string;
    legal_flag?: boolean;
    selectors?: Record<string, string>;
    active?: boolean;
  }>();

  if (!body.name || !body.vertical || !body.geo || !body.url || !body.scraper_type) {
    return c.json({ error: "name, vertical, geo, url, scraper_type are required" }, 400);
  }

  const scraperType = body.scraper_type as "crawl4ai" | "cheerio" | "api";

  const [row] = await db
    .insert(sourceRegistry)
    .values({
      name: body.name,
      vertical: normalizeVertical(body.vertical),
      geo: normalizeGeo(body.geo),
      url: body.url,
      scraperType,
      legalFlag: body.legal_flag ?? false,
      selectors: body.selectors ?? {},
      active: body.active ?? true,
    })
    .returning();

  return c.json(row, 201);
});

// ---------------------------------------------------------------------------
// Tavily-driven source discovery
// ---------------------------------------------------------------------------

// Public-facing view of DIRECTORY_CONFIGS so the registry UI can render which
// (vertical, geo) tuples have auto-discovery wired up.
adminRouter.get("/registry/directory-configs", async (c) => {
  const items = Object.entries(DIRECTORY_CONFIGS).map(([key, cfg]) => {
    const [vertical, geo] = key.split(":");
    return { vertical, geo, query: cfg.query, domains: cfg.domains };
  });
  return c.json(items);
});

// Rate-limit manual refresh to 1 req / 60s per (vertical, geo). In-memory is
// fine for a single-instance Lightsail deploy; if we go multi-instance,
// swap for Redis.
const refreshLastTriggered = new Map<string, number>();
const REFRESH_COOLDOWN_MS = 60_000;

adminRouter.post("/registry/discover", async (c) => {
  const body = await c.req.json<{ vertical?: string; geo?: string }>();
  if (!body.vertical || !body.geo) {
    return c.json({ error: "vertical and geo are required" }, 400);
  }

  const vertical = normalizeVertical(body.vertical);
  const geo = normalizeGeo(body.geo);
  const key = `${vertical}:${geo}`;

  const config = getDirectoryConfig(vertical, geo);
  if (!config) {
    return c.json(
      {
        status: "skipped_no_config",
        message: `No directory config for ${key}. Add a config to sourceRegistry/index.ts or seed sources manually.`,
      },
      400,
    );
  }

  const last = refreshLastTriggered.get(key) ?? 0;
  const sinceLast = Date.now() - last;
  if (sinceLast < REFRESH_COOLDOWN_MS) {
    const retryAfter = Math.ceil((REFRESH_COOLDOWN_MS - sinceLast) / 1000);
    c.header("Retry-After", String(retryAfter));
    return c.json(
      { error: `Cooldown active. Try again in ${retryAfter}s.`, retry_after_seconds: retryAfter },
      429,
    );
  }
  refreshLastTriggered.set(key, Date.now());

  // No campaignId here — manual refresh isn't anchored to a campaign. The
  // discoverSources signature still expects one for the `generated_by` FK;
  // pass the first active campaign matching (vertical, geo) so lineage is
  // meaningful, or null when no match exists.
  const [anyCampaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.vertical, vertical), eq(campaigns.status, "active")))
    .limit(1);

  void discoverSources(vertical, geo, anyCampaign?.id ?? null).catch((err) => {
    console.error(`[discovery] manual refresh ${key} failed:`, err);
  });

  await logAudit({
    actor: "user",
    action: "registry.discover_refresh",
    targetType: "source_registry",
    ipAddress:
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      null,
    metadata: { vertical, geo, domains: config.domains },
  });

  return c.json(
    {
      status: "triggered",
      message: `Discovering sources from ${config.domains.join(", ")}. Refresh the table in ~30s.`,
      domains: config.domains,
    },
    202,
  );
});

// Convenience: returns (vertical, geo) tuples currently used by any active
// campaign. The UI uses this to render a "Refresh" button per active
// combination, regardless of whether DIRECTORY_CONFIGS has them.
adminRouter.get("/registry/active-combinations", async (c) => {
  const rows = await db
    .selectDistinct({ vertical: campaigns.vertical, geography: campaigns.geography })
    .from(campaigns)
    .where(inArray(campaigns.status, ["active", "paused"]));

  // geography is comma-separated → expand to (vertical, geo) pairs
  const pairs = new Set<string>();
  for (const row of rows) {
    for (const g of row.geography.split(",")) {
      const geo = g.trim();
      if (geo) pairs.add(`${row.vertical}:${geo}`);
    }
  }

  return c.json(
    Array.from(pairs).map((p) => {
      const [vertical, geo] = p.split(":");
      return { vertical, geo, has_config: !!getDirectoryConfig(vertical!, geo!) };
    }),
  );
});

adminRouter.get("/suppression", async (c) => {
  const rows = await db.select().from(suppressionList).orderBy(suppressionList.addedAt);
  return c.json(rows.map((r) => ({
    id: r.id,
    email: r.email,
    reason: r.reason,
    added_at: r.addedAt.toISOString(),
  })));
});

adminRouter.post("/suppression", async (c) => {
  const body = await c.req.json<{ email?: string; reason?: string }>();

  if (!body.email || !body.reason) {
    return c.json({ error: "email and reason are required" }, 400);
  }

  const reason = body.reason as "unsubscribed" | "spam_complaint" | "hostile" | "manual";

  const [row] = await db
    .insert(suppressionList)
    .values({ email: body.email, reason })
    .onConflictDoNothing()
    .returning();

  if (!row) return c.json({ message: "Email already suppressed" }, 200);
  return c.json({ id: row.id, email: row.email, reason: row.reason, added_at: row.addedAt.toISOString() }, 201);
});

// ---------------------------------------------------------------------------
// Prompt templates — admin CRUD. system_prompt is IMMUTABLE after create so
// engagement comparisons aren't corrupted by silent edits. To iterate, the
// rep duplicates an existing template (parent_template_id captures lineage).
// ---------------------------------------------------------------------------

function formatTemplate(row: typeof promptTemplates.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    system_prompt: row.systemPrompt,
    weight: row.weight,
    active: row.active,
    parent_template_id: row.parentTemplateId,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

adminRouter.get("/templates", async (c) => {
  const rows = await db.select().from(promptTemplates).orderBy(promptTemplates.createdAt);
  return c.json(rows.map(formatTemplate));
});

adminRouter.post("/templates", async (c) => {
  const body = await c.req.json<{
    name?: string;
    description?: string;
    system_prompt?: string;
    weight?: number;
    active?: boolean;
    parent_template_id?: string | null;
  }>();

  if (!body.name?.trim() || !body.system_prompt?.trim()) {
    return c.json({ error: "name and system_prompt are required" }, 400);
  }

  const [row] = await db
    .insert(promptTemplates)
    .values({
      name: body.name.trim(),
      description: body.description?.trim() || null,
      systemPrompt: body.system_prompt,
      weight: body.weight ?? 1,
      active: body.active ?? true,
      parentTemplateId: body.parent_template_id ?? null,
      createdBy: "user",
    })
    .returning();

  await logAudit({
    actor: "user",
    action: "template.create",
    targetId: row!.id,
    targetType: "prompt_template",
    metadata: { name: row!.name, parent_template_id: row!.parentTemplateId },
  });

  return c.json(formatTemplate(row!), 201);
});

// Metadata-only edit. system_prompt is intentionally NOT accepted here — to
// change the prompt the rep must POST a new template (typically pre-filling
// from the original via the UI's Duplicate action).
adminRouter.patch("/templates/:id", async (c) => {
  const id = c.req.param("id");
  const [existing] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, id)).limit(1);
  if (!existing) return c.json({ error: "Template not found" }, 404);

  const body = await c.req.json<{
    name?: string;
    description?: string | null;
    weight?: number;
    active?: boolean;
  }>();

  const updates: Partial<typeof promptTemplates.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) {
    const trimmed = body.name.trim();
    if (!trimmed) return c.json({ error: "name cannot be empty" }, 400);
    updates.name = trimmed;
  }
  if (body.description !== undefined) updates.description = body.description?.trim() || null;
  if (body.weight !== undefined) {
    if (body.weight < 0) return c.json({ error: "weight must be >= 0" }, 400);
    updates.weight = body.weight;
  }
  if (body.active !== undefined) updates.active = body.active;

  const [updated] = await db.update(promptTemplates).set(updates).where(eq(promptTemplates.id, id)).returning();

  await logAudit({
    actor: "user",
    action: "template.update",
    targetId: id,
    targetType: "prompt_template",
    metadata: {
      changed: Object.keys(updates).filter((k) => k !== "updatedAt"),
    },
  });

  return c.json(formatTemplate(updated!));
});

// Soft-protect deletes: refuse if any draft references this template. The rep
// can deactivate instead, preserving the engagement history.
adminRouter.delete("/templates/:id", async (c) => {
  const id = c.req.param("id");
  const [existing] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, id)).limit(1);
  if (!existing) return c.json({ error: "Template not found" }, 404);

  const [usage] = await db
    .select({ id: emailDrafts.id })
    .from(emailDrafts)
    .where(eq(emailDrafts.templateId, id))
    .limit(1);
  if (usage) {
    return c.json({
      error: "Cannot delete: drafts reference this template. Deactivate instead to preserve engagement history.",
    }, 409);
  }

  await db.delete(promptTemplates).where(eq(promptTemplates.id, id));
  await logAudit({
    actor: "user",
    action: "template.delete",
    targetId: id,
    targetType: "prompt_template",
    metadata: { name: existing.name },
  });
  return c.json({ ok: true });
});
