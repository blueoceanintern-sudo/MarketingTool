import type { Lead } from "../scrapers/cheerioScraper";

export interface EnrichedLead extends Lead {
  firstName?: string;
  lastName?: string;
  role?: string;
  isVerified: boolean;
}

interface SnovioTokenResponse {
  access_token: string;
  expires_in: number;
}

interface SnovioEmailResult {
  email: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  verified?: boolean;
}

interface SnovioFindResponse {
  data: { emails: SnovioEmailResult[] };
}

interface SnovioVerifyResponse {
  data: { status: string };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const { SNOVIO_CLIENT_ID: id, SNOVIO_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error("SNOVIO_CLIENT_ID and SNOVIO_CLIENT_SECRET are required");

  const res = await fetch(
    `https://api.snov.io/v1/oauth/access_token?grant_type=client_credentials&client_id=${id}&client_secret=${secret}`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error(`Snov.io auth failed: ${res.status}`);

  const body = (await res.json()) as SnovioTokenResponse;
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 - 60_000 };
  return cachedToken.value;
}

async function findByDomain(domain: string, token: string): Promise<SnovioEmailResult[]> {
  const res = await fetch(
    `https://api.snov.io/v2/domain-emails-with-info?domain=${encodeURIComponent(domain)}&type=all&limit=10`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return [];
  const body = (await res.json()) as SnovioFindResponse;
  return body.data?.emails ?? [];
}

async function verifyEmail(email: string, token: string): Promise<boolean> {
  const res = await fetch(
    `https://api.snov.io/v1/get-emails-verification-status?emails[]=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return false;
  const body = (await res.json()) as SnovioVerifyResponse;
  return body.data?.status === "valid";
}

export async function enrichLead(lead: Lead): Promise<EnrichedLead> {
  if (!lead.email && !lead.website) return { ...lead, isVerified: false };

  const token = await getAccessToken();

  if (lead.email) {
    const verified = await verifyEmail(lead.email, token);
    return { ...lead, isVerified: verified };
  }

  const domain = new URL(lead.website).hostname.replace(/^www\./, "");
  const results = await findByDomain(domain, token);
  if (results.length === 0) return { ...lead, isVerified: false };

  const best = results[0]!;
  return {
    ...lead,
    email: best.email,
    firstName: best.first_name,
    lastName: best.last_name,
    role: best.position,
    isVerified: best.verified ?? false,
  };
}
