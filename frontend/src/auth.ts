import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { SignJWT } from "jose";
import type { Role } from "@/types/auth";

const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

let _secret: Uint8Array | undefined;
function getSecret(): Uint8Array {
  if (!_secret) {
    const s = process.env.AUTH_SECRET;
    if (!s) throw new Error("AUTH_SECRET is not set");
    _secret = new TextEncoder().encode(s);
  }
  return _secret;
}

// Backend tokens are short-lived so a re-minted token (with updated role)
// reaches the client quickly after an env-var change.
const BACKEND_TOKEN_TTL = "1h";
const BACKEND_TOKEN_TTL_SECONDS = 3600;
// Refresh the backend token when less than this many seconds remain.
const REFRESH_BEFORE_EXPIRY = 300;

async function mintBackendToken(email: string, role: Role): Promise<string> {
  return new SignJWT({ email, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(BACKEND_TOKEN_TTL)
    .sign(getSecret());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      issuer: "https://accounts.google.com",
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      console.log("=== SIGNIN CALLBACK ===");
      console.log("user:", JSON.stringify(user));
      console.log("account:", JSON.stringify(account));
      console.log("profile:", JSON.stringify(profile));
      return true;
    },
    async jwt({ token, user }) {
      const email = (user?.email ?? token.email) as string | undefined;
      if (!email) return token;

      // Re-check allowlist on every JWT refresh so revoked users are signed
      // out on their next page load without waiting for session expiry.
      if (allowedEmails.length > 0 && !allowedEmails.includes(email)) {
        // Returning a token with a past expiry forces Auth.js to treat the
        // session as invalid and redirect to the sign-in page.
        return { ...token, exp: 0 };
      }

      // Re-evaluate role from env on every refresh — role changes in
      // ADMIN_EMAILS take effect on the user's next page navigation.
      const role: Role = adminEmails.includes(email) ? "admin" : "rep";
      const now = Math.floor(Date.now() / 1000);
      const backendTokenExp = token.backendTokenExp as number | undefined;
      const roleChanged = token.role !== role;
      const nearExpiry = !backendTokenExp || backendTokenExp - now < REFRESH_BEFORE_EXPIRY;

      if (user || roleChanged || nearExpiry) {
        token.role = role;
        token.backendToken = await mintBackendToken(email, role);
        token.backendTokenExp = now + BACKEND_TOKEN_TTL_SECONDS;
      }

      return token;
    },
    async session({ session, token }) {
      session.user.role = token.role as Role;
      session.backendToken = token.backendToken as string;
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
