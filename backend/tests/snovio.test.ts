import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { EnrichmentInput } from "../src/services/enrichment/types";

process.env.SNOVIO_CLIENT_ID = "test_client_id";
process.env.SNOVIO_CLIENT_SECRET = "test_client_secret";

const fetchCalls: string[] = [];

const mockResponses: Record<string, object> = {
  "oauth/access_token": { access_token: "tok_test_abc", expires_in: 3600 },
  "domain-emails-with-info": {
    data: {
      emails: [
        { email: "ceo@domain.com", first_name: "Alice", last_name: "Wong", position: "CEO", verified: true },
      ],
    },
  },
  "get-emails-verification-status": { data: { status: "valid" } },
};

global.fetch = mock(async (url: string) => {
  fetchCalls.push(url);
  const key = Object.keys(mockResponses).find((k) => url.includes(k));
  if (!key) throw new Error(`No fetch mock registered for: ${url}`);
  return { ok: true, json: async () => mockResponses[key] };
}) as unknown as typeof fetch;

const { snovioProvider } = await import("../src/services/enrichment/snovio");

function input(seed: Partial<EnrichmentInput["seed"]>): EnrichmentInput {
  return {
    leadId: "lead-1",
    campaignId: null,
    market: "SG",
    seed: {
      name: null,
      email: null,
      role: null,
      companyName: "Acme",
      companyWebsite: null,
      industry: null,
      region: "SG",
      ...seed,
    },
  };
}

describe("snovioProvider", () => {
  beforeEach(() => { fetchCalls.length = 0; });

  it("returns null when neither email nor website is provided", async () => {
    const result = await snovioProvider.enrich(input({}));
    expect(result).toBeNull();
    expect(fetchCalls.length).toBe(0);
  });

  it("verifies an existing email and returns email_status=verified when valid", async () => {
    const result = await snovioProvider.enrich(input({ email: "ceo@domain.com", companyWebsite: "https://domain.com" }));
    expect(result?.contact?.email).toBe("ceo@domain.com");
    expect(result?.contact?.email_status).toBe("verified");
  });

  it("returns email_status=pattern_guessed when verification status is not 'valid'", async () => {
    (mockResponses as any)["get-emails-verification-status"] = { data: { status: "invalid" } };
    const result = await snovioProvider.enrich(input({ email: "bad@domain.com", companyWebsite: "https://domain.com" }));
    expect(result?.contact?.email_status).toBe("pattern_guessed");
    (mockResponses as any)["get-emails-verification-status"] = { data: { status: "valid" } };
  });

  it("enriches by domain when no email is present", async () => {
    const result = await snovioProvider.enrich(input({ companyWebsite: "https://domain.com" }));
    expect(result?.contact?.email).toBe("ceo@domain.com");
    expect(result?.contact?.first_name).toBe("Alice");
    expect(result?.contact?.full_name).toBe("Alice Wong");
    expect(result?.contact?.role).toBe("CEO");
    expect(result?.contact?.email_status).toBe("verified");
  });

  it("returns null when domain search yields no emails", async () => {
    (mockResponses as any)["domain-emails-with-info"] = { data: { emails: [] } };
    const result = await snovioProvider.enrich(input({ companyWebsite: "https://empty.com" }));
    expect(result).toBeNull();
    (mockResponses as any)["domain-emails-with-info"] = {
      data: {
        emails: [{ email: "ceo@domain.com", first_name: "Alice", last_name: "Wong", position: "CEO", verified: true }],
      },
    };
  });

  it("fetches the OAuth token at most once across multiple consecutive calls", async () => {
    fetchCalls.length = 0;
    await snovioProvider.enrich(input({ email: "a@domain.com", companyWebsite: "https://domain.com" }));
    await snovioProvider.enrich(input({ email: "b@domain.com", companyWebsite: "https://domain.com" }));
    const oauthCalls = fetchCalls.filter((u) => u.includes("oauth")).length;
    expect(oauthCalls).toBeLessThanOrEqual(1);
  });
});
