import { Hono } from "hono";
import { drafts } from "./drafts";
import { suppressionList } from "./replies";

export const analyticsRouter = new Hono();

analyticsRouter.get("/overview", (c) => {
  const all = Array.from(drafts.values());
  return c.json({
    totalDrafts: all.length,
    pendingReview: all.filter((d) => d.status === "pending_review").length,
    scheduled: all.filter((d) => d.status === "scheduled").length,
    sent: all.filter((d) => d.status === "sent").length,
    rejected: all.filter((d) => d.status === "rejected").length,
    suppressed: suppressionList.size,
  });
});

analyticsRouter.get("/templates", (c) => {
  const all = Array.from(drafts.values());
  const byPersona = new Map<string, { sent: number; persona: string }>();

  for (const draft of all) {
    if (draft.status !== "sent") continue;
    const existing = byPersona.get(draft.persona) ?? { sent: 0, persona: draft.persona };
    existing.sent++;
    byPersona.set(draft.persona, existing);
  }

  return c.json(Array.from(byPersona.values()));
});

analyticsRouter.get("/export", (c) => {
  const all = Array.from(drafts.values());
  const rows = [
    "id,leadId,campaignId,persona,status,confidenceScore,createdAt",
    ...all.map((d) =>
      [d.id, d.leadId, d.campaignId, d.persona, d.status, d.confidenceScore, d.createdAt].join(",")
    ),
  ].join("\n");

  return new Response(rows, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=drafts-export.csv",
    },
  });
});
