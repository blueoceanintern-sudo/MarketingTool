import type { EnrichmentInput, EnrichmentProvider, ProviderResult } from "./types";

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
  if (!body.access_token) throw new Error("Snov.io auth failed: no access_token in response");
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

export const snovioProvider: EnrichmentProvider = {
  name: "snovio",

  async enrich(input: EnrichmentInput): Promise<ProviderResult | null> {
    const seed = input.seed;
    if (!seed.email && !seed.companyWebsite) return null;

    const { SNOVIO_CLIENT_ID: id, SNOVIO_CLIENT_SECRET: secret } = process.env;
    if (!id || !secret) return null;

    const token = await getAccessToken();

    if (seed.email) {
      const verified = await verifyEmail(seed.email, token);
      return {
        source: "snovio",
        contact: {
          email: seed.email,
          email_status: verified ? "verified" : "pattern_guessed",
          full_name: joinName(seed.firstName, seed.lastName),
          first_name: seed.firstName,
          role: seed.role,
        },
      };
    }

    let domain: string;
    try {
      domain = new URL(seed.companyWebsite!).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
    const results = await findByDomain(domain, token);
    if (results.length === 0) return null;

    const best = results[0]!;
    return {
      source: "snovio",
      contact: {
        email: best.email,
        email_status: best.verified ? "verified" : "pattern_guessed",
        full_name: joinName(best.first_name ?? null, best.last_name ?? null),
        first_name: best.first_name ?? null,
        role: best.position ?? null,
      },
    };
  },
};

function joinName(first: string | null, last: string | null): string | null {
  const parts = [first, last].filter((p): p is string => Boolean(p?.trim()));
  return parts.length > 0 ? parts.join(" ") : null;
}
