import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// 1x1 transparent GIF — returned regardless of backend reachability.
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

const PIXEL_HEADERS = {
  "Content-Type": "image/gif",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Pragma": "no-cache",
};

// Public route — loaded by email clients when they render the tracking pixel.
// Proxies to the backend (port 3001 is firewalled externally) to record the open.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    await fetch(`${BACKEND}/track/open/${encodeURIComponent(eventId)}`);
  } catch {
    // fire-and-forget — always return the pixel
  }
  return new NextResponse(TRANSPARENT_GIF, { headers: PIXEL_HEADERS });
}
