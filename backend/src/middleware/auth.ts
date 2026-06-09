import { jwtVerify } from "jose";
import type { Context, Next } from "hono";

function getSecret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

export type Role = "admin" | "rep";

export interface AuthUser {
  email: string;
  role: Role;
}

// Verifies the HS256 backend token minted by the frontend on sign-in.
// Attaches the parsed user to c.var.user for downstream handlers.
export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = header.slice(7);
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.email !== "string" || typeof payload.role !== "string") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("user", { email: payload.email, role: payload.role as Role } satisfies AuthUser);
    await next();
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
}

// Apply after requireAuth to gate a route to admins only.
export async function requireAdmin(c: Context, next: Next) {
  const user = c.get("user") as AuthUser | undefined;
  if (!user || user.role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
}
