import { auth } from "@/auth";
import { NextResponse } from "next/server";

export const proxy = auth((req) => {
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
});

export const config = {
  // Skip auth for: login, NextAuth internals, Next.js build assets,
  // and any public static file (images, fonts, SVGs, HTML).
  // unsubscribe.html must be open because it is linked from outbound emails.
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|[^?]*\\.(?:html?|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|css|js(?!on))).*)",
  ],
};
