import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Public route — linked from outbound emails. Proxies to the backend on
// localhost (port 3001 is firewalled externally) then redirects to the
// static confirmation page.
//
// POST is for RFC 8058 one-click unsubscribe (Gmail sends a POST with
// List-Unsubscribe=One-Click in the body when the user hits "Unsubscribe"
// in Gmail's UI). GET is for the regular link click.

async function handleUnsubscribe(id: string | null, campaign: string | null) {
  if (!id || !campaign) {
    return new NextResponse("Invalid unsubscribe link.", { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(
      `${BACKEND}/unsubscribe?id=${encodeURIComponent(id)}&campaign=${encodeURIComponent(campaign)}`,
      { redirect: "manual" }
    );
  } catch {
    return new NextResponse("Service unavailable.", { status: 502 });
  }

  if (res.status === 404) {
    return new NextResponse("Unsubscribe link not recognised.", { status: 404 });
  }

  return new NextResponse(null, { status: 200 });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const res = await handleUnsubscribe(searchParams.get("id"), searchParams.get("campaign"));
  if (!res.ok) return res;
  return NextResponse.redirect(new URL("/unsubscribe.html", APP_URL));
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return handleUnsubscribe(searchParams.get("id"), searchParams.get("campaign"));
}
