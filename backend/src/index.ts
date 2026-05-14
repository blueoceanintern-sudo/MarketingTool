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

export default app;