import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Public route — linked from outbound emails. Proxies to the backend on
// localhost (port 3001 is firewalled externally) then redirects to the
// static confirmation page.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const campaign = searchParams.get("campaign");

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

  return NextResponse.redirect(new URL("/unsubscribe.html", req.url));
}
