import { auth } from "@/auth";
import { NextResponse } from "next/server";

export const proxy = auth((req) => {
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
});

export const config = {
  // Skip auth for: login, NextAuth internals, Next.js build assets,
  // public static files (images, fonts, SVGs, HTML), and the unsubscribe
  // API route (linked from outbound emails — recipients have no session).
  matcher: [
    "/((?!login|api/auth|api/unsubscribe|_next/static|_next/image|[^?]*\\.(?:html?|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|css|js(?!on))).*)",
  ],
};
