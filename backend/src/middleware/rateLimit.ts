import type { Context, Next } from "hono";

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

function consume(key: string, max: number): boolean {
  const now = Date.now();
  let w = windows.get(key);
  if (!w || now >= w.resetAt) {
    w = { count: 0, resetAt: now + 60_000 };
    windows.set(key, w);
  }
  w.count++;
  return w.count <= max;
}

// Rate limit by authenticated user email. Namespace lets different limits keep
// separate counters for the same user (e.g. "api" vs "csv").
export function rateLimitByUser(maxPerMin: number, namespace = "api") {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as { email: string } | undefined;
    const key = `${namespace}:${user?.email ?? "anon"}`;
    if (!consume(key, maxPerMin)) {
      c.header("Retry-After", "60");
      return c.json({ error: "Too many requests" }, 429);
    }
    await next();
  };
}

// Rate limit by client IP. Used for unauthenticated endpoints (e.g. SNS webhook).
export function rateLimitByIp(maxPerMin: number) {
  return async (c: Context, next: Next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown";
    if (!consume(`ip:${ip}`, maxPerMin)) {
      c.header("Retry-After", "60");
      return c.json({ error: "Too many requests" }, 429);
    }
    await next();
  };
}
