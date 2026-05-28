import { describe, it, expect, mock, beforeEach } from "bun:test";

// Configurable mock response — changed per test
let mockHtml = `<html><head><title>Acme Corp</title></head><body><a href="mailto:ceo@acme.com">email</a></body></html>`;
let mockOk = true;

mock.module("node-fetch", () => ({
  default: mock(async (_url: string) => {
    if (!mockOk) return { ok: false, status: 503 };
    return { ok: true, text: async () => mockHtml };
  }),
}));

const { scrapeWebsite } = await import("../src/services/scrapers/cheerioScraper");

describe("cheerioScraper — scrapeWebsite", () => {
  beforeEach(() => {
    mockOk = true;
    mockHtml = `<html><head><title>Acme Corp</title></head><body><a href="mailto:ceo@acme.com">email</a></body></html>`;
  });

  it("extracts company name from <title> and email from mailto", async () => {
    const leads = await scrapeWebsite("https://acme.com");
    expect(leads).toHaveLength(1);
    expect(leads[0]!.company).toBe("Acme Corp");
    expect(leads[0]!.email).toBe("ceo@acme.com");
    expect(leads[0]!.website).toBe("https://acme.com");
  });

  it("extracts multiple unique emails from mailto links AND plain text", async () => {
    mockHtml = `<html><head><title>Multi Co</title></head><body>
      <a href="mailto:alice@multi.com">Alice</a>
      <a href="mailto:bob@multi.com?subject=Hi">Bob</a>
      <p>Sales: sales@multi.com</p>
      <p>Sales: sales@multi.com</p>
    </body></html>`;
    const leads = await scrapeWebsite("https://multi.com");
    expect(leads).toHaveLength(3);
    const emails = leads.map((l) => l.email).sort();
    expect(emails).toEqual(["alice@multi.com", "bob@multi.com", "sales@multi.com"]);
    for (const lead of leads) {
      expect(lead.company).toBe("Multi Co");
      expect(lead.website).toBe("https://multi.com");
    }
  });

  it("returns empty array when no emails found", async () => {
    mockHtml = `<html><head><title>No Email Co</title></head><body><p>no contact</p></body></html>`;
    const leads = await scrapeWebsite("https://noemail.com");
    expect(leads).toEqual([]);
  });

  it("returns undefined company when <title> is empty (still extracts emails)", async () => {
    mockHtml = `<html><head><title></title></head><body><a href="mailto:hi@x.com">e</a></body></html>`;
    const leads = await scrapeWebsite("https://notitle.com");
    expect(leads).toHaveLength(1);
    expect(leads[0]!.company).toBeUndefined();
    expect(leads[0]!.email).toBe("hi@x.com");
  });

  it("lowercases extracted emails", async () => {
    mockHtml = `<html><head><title>Case Co</title></head><body><a href="mailto:CEO@CASE.COM">e</a></body></html>`;
    const leads = await scrapeWebsite("https://case.com");
    expect(leads[0]!.email).toBe("ceo@case.com");
  });

  it("throws when fetch returns a non-ok status", async () => {
    mockOk = false;
    expect(scrapeWebsite("https://broken.com")).rejects.toThrow();
  });
});
