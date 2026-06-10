import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribeJobEvents } from "../services/events";

export const eventsRouter = new Hono();

// GET /api/v1/events — Server-Sent Events stream of job-completion events.
// The browser opens one EventSource; the frontend maps each event to a
// react-query invalidation (and component listeners).
eventsRouter.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    let abortResolve!: () => void;
    const aborted = new Promise<void>((r) => { abortResolve = r; });

    const unsubscribe = subscribeJobEvents((event) => {
      void stream.writeSSE({ event: "job", data: JSON.stringify(event) }).catch(() => {});
    });

    stream.onAbort(() => {
      abortResolve();
    });

    try {
      await stream.writeSSE({ event: "ready", data: "ok" }).catch(() => {});
      // Keepalive so idle connections aren't dropped by proxies/timeouts.
      // Race against aborted so we exit immediately on disconnect (not after 25s).
      while (true) {
        const result = await Promise.race([
          stream.sleep(25_000).then(() => "ping" as const),
          aborted.then(() => "abort" as const),
        ]);
        if (result === "abort") break;
        await stream.writeSSE({ event: "ping", data: String(Date.now()) }).catch(() => {});
      }
    } finally {
      unsubscribe();
    }
  }),
);
