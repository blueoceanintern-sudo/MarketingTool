import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribeJobEvents } from "../services/events";

export const eventsRouter = new Hono();

// GET /api/v1/events — Server-Sent Events stream of job-completion events.
// The browser opens one EventSource; the frontend maps each event to a
// react-query invalidation (and component listeners).
eventsRouter.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    let open = true;

    const unsubscribe = subscribeJobEvents((event) => {
      void stream.writeSSE({ event: "job", data: JSON.stringify(event) });
    });

    stream.onAbort(() => {
      open = false;
    });

    try {
      await stream.writeSSE({ event: "ready", data: "ok" });
      // Keepalive so idle connections aren't dropped by proxies/timeouts.
      while (open) {
        await stream.sleep(25_000);
        if (!open) break;
        await stream.writeSSE({ event: "ping", data: String(Date.now()) });
      }
    } finally {
      unsubscribe();
    }
  }),
);
