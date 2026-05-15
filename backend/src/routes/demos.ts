import { Hono } from "hono";

type DemoStatus = "pending" | "scheduled" | "completed" | "cancelled";

interface Demo {
  id: string;
  leadId: string;
  campaignId: string;
  replyId: string;
  assignedTo?: string;
  status: DemoStatus;
  createdAt: string;
  updatedAt: string;
}

const demos = new Map<string, Demo>();

export function createDemo(data: Pick<Demo, "leadId" | "campaignId" | "replyId">): Demo {
  const demo: Demo = {
    ...data,
    id: crypto.randomUUID(),
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  demos.set(demo.id, demo);
  return demo;
}

export const demosRouter = new Hono();

demosRouter.post("/", async (c) => {
  const body = await c.req.json<Pick<Demo, "leadId" | "campaignId" | "replyId">>();

  if (!body.leadId || !body.campaignId || !body.replyId) {
    return c.json({ error: "leadId, campaignId, replyId are required" }, 400);
  }

  const demo = createDemo(body);
  return c.json(demo, 201);
});

demosRouter.get("/", (c) => {
  return c.json(Array.from(demos.values()));
});

demosRouter.patch("/:id/assign", async (c) => {
  const demo = demos.get(c.req.param("id"));
  if (!demo) return c.json({ error: "Demo not found" }, 404);

  const body = await c.req.json<{ assignedTo: string }>();
  if (!body.assignedTo) return c.json({ error: "assignedTo is required" }, 400);

  demo.assignedTo = body.assignedTo;
  demo.status = "scheduled";
  demo.updatedAt = new Date().toISOString();
  demos.set(demo.id, demo);
  return c.json(demo);
});
