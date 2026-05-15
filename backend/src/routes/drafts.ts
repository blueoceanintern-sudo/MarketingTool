import { Hono } from "hono";

type DraftStatus = "pending_review" | "approved" | "rejected" | "scheduled" | "sent";
type Persona = "technical" | "executive" | "ops";

interface Draft {
  id: string;
  leadId: string;
  campaignId: string;
  persona: Persona;
  subject: string;
  body: string;
  confidenceScore: number;
  status: DraftStatus;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export const drafts = new Map<string, Draft>();

export function createDraft(data: Omit<Draft, "id" | "status" | "createdAt" | "updatedAt">): Draft {
  const draft: Draft = {
    ...data,
    id: crypto.randomUUID(),
    status: "pending_review",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  drafts.set(draft.id, draft);
  return draft;
}

export const draftsRouter = new Hono();

draftsRouter.get("/queue", (c) => {
  const queue = Array.from(drafts.values()).filter((d) => d.status === "pending_review");
  return c.json(queue);
});

draftsRouter.patch("/:id/approve", (c) => {
  const draft = drafts.get(c.req.param("id"));
  if (!draft) return c.json({ error: "Draft not found" }, 404);
  if (draft.status !== "pending_review") {
    return c.json({ error: `Cannot approve a draft with status '${draft.status}'` }, 409);
  }

  draft.status = "scheduled";
  draft.updatedAt = new Date().toISOString();
  drafts.set(draft.id, draft);
  return c.json(draft);
});

draftsRouter.patch("/:id/reject", async (c) => {
  const draft = drafts.get(c.req.param("id"));
  if (!draft) return c.json({ error: "Draft not found" }, 404);
  if (draft.status !== "pending_review") {
    return c.json({ error: `Cannot reject a draft with status '${draft.status}'` }, 409);
  }

  const body = await c.req.json<{ reason?: string }>();
  draft.status = "rejected";
  draft.rejectionReason = body.reason;
  draft.updatedAt = new Date().toISOString();
  drafts.set(draft.id, draft);
  return c.json(draft);
});

draftsRouter.patch("/:id/edit", async (c) => {
  const draft = drafts.get(c.req.param("id"));
  if (!draft) return c.json({ error: "Draft not found" }, 404);
  if (draft.status === "sent") {
    return c.json({ error: "Cannot edit a sent draft" }, 409);
  }

  const body = await c.req.json<{ subject?: string; body?: string }>();
  if (!body.subject && !body.body) {
    return c.json({ error: "Provide subject or body to edit" }, 400);
  }

  if (body.subject) draft.subject = body.subject;
  if (body.body) {
    draft.body = body.body;
    draft.confidenceScore = scoreBody(body.body);
  }
  draft.status = "pending_review";
  draft.updatedAt = new Date().toISOString();
  drafts.set(draft.id, draft);
  return c.json(draft);
});

function scoreBody(body: string): number {
  const wordCount = body.trim().split(/\s+/).length;
  if (wordCount > 125) return 40;
  if (wordCount < 20) return 50;
  return 75;
}
