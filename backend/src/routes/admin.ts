import { Hono } from "hono";
import { db } from "../db";
import { sourceRegistry, suppressionList, promptTemplates, emailDrafts, normalizeVertical, normalizeGeo } from "../db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "../services/audit/log";

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
