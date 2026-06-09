import { auth } from "@/auth";

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Proxies the backend SSE stream. EventSource can't set headers, so we read
// the session from the NextAuth httpOnly cookie server-side and add the
// Authorization header before forwarding.
export async function GET() {
  const session = await auth();
  if (!session?.backendToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const upstream = await fetch(`${BACKEND}/api/v1/events`, {
    headers: { Authorization: `Bearer ${session.backendToken}` },
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Backend unavailable", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
