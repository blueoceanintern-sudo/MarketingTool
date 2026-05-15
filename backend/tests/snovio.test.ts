import { describe, it, expect, mock, beforeEach } from "bun:test";

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

const { enrichLead } = await import("../src/services/enrichment/snovio");

describe("snovio — enrichLead", () => {
  beforeEach(() => fetchCalls.length = 0);

  it("returns original lead with isVerified=false when neither email nor website is provided", async () => {
    const result = await enrichLead({ website: "" });
    expect(result.isVerified).toBe(false);
    expect(fetchCalls.length).toBe(0);
  });

  it("verifies an existing email and returns isVerified=true when status is valid", async () => {
    const result = await enrichLead({ email: "ceo@domain.com", website: "https://domain.com" });
    expect(result.isVerified).toBe(true);
    expect(result.email).toBe("ceo@domain.com");
  });

  it("returns isVerified=false when verification status is not 'valid'", async () => {
    (mockResponses as any)["get-emails-verification-status"] = { data: { status: "invalid" } };
    const result = await enrichLead({ email: "bad@domain.com", website: "https://domain.com" });
    expect(result.isVerified).toBe(false);
    // Restore
    (mockResponses as any)["get-emails-verification-status"] = { data: { status: "valid" } };
  });

  it("enriches lead by domain when no email is present", async () => {
    const result = await enrichLead({ website: "https://domain.com" });
    expect(result.email).toBe("ceo@domain.com");
    expect(result.firstName).toBe("Alice");
    expect(result.lastName).toBe("Wong");
    expect(result.role).toBe("CEO");
    expect(result.isVerified).toBe(true);
  });

  it("returns isVerified=false when domain search returns no emails", async () => {
    (mockResponses as any)["domain-emails-with-info"] = { data: { emails: [] } };
    const result = await enrichLead({ website: "https://empty.com" });
    expect(result.isVerified).toBe(false);
    expect(result.email).toBeUndefined();
    // Restore
    (mockResponses as any)["domain-emails-with-info"] = {
      data: {
        emails: [{ email: "ceo@domain.com", first_name: "Alice", last_name: "Wong", position: "CEO", verified: true }],
      },
    };
  });

  it("fetches the OAuth token at most once across multiple consecutive calls", async () => {
    fetchCalls.length = 0;
    // Two back-to-back calls — token is cached after the first (or already cached from earlier tests)
    await enrichLead({ email: "a@domain.com", website: "https://domain.com" });
    await enrichLead({ email: "b@domain.com", website: "https://domain.com" });
    const oauthCalls = fetchCalls.filter((u) => u.includes("oauth")).length;
    // 0 = token was pre-cached; 1 = first fetch happened here. Never 2.
    expect(oauthCalls).toBeLessThanOrEqual(1);
  });
});
