import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

process.env.AWS_ACCESS_KEY_ID = "test_access_key";
process.env.AWS_SECRET_ACCESS_KEY = "test_secret_key";
process.env.AWS_SES_FROM_ADDRESS = "outreach@blueocean.com";
process.env.NEXT_PUBLIC_API_URL = "http://localhost:3001";

mock.module("@aws-sdk/client-ses", () => ({
  SESClient: class {
    send(_cmd: object) {
      return Promise.resolve({ MessageId: "ses_msg_test_001" });
    }
  },
  SendEmailCommand: class {
    constructor(public input: object) {}
  },
}));

const { shouldQueueForReview, pickVariant, sendDraft, setTotalSent } = await import(
  "../src/services/sender/index"
);
const { suppressionList } = await import("../src/routes/replies");
const { createDraft, drafts } = await import("../src/routes/drafts");

function makeScheduledDraft(overrides: Partial<Parameters<typeof createDraft>[0]> = {}) {
  const d = createDraft({
    leadId: "test_lead",
    campaignId: "test_campaign",
    persona: "technical",
    subject: "Test subject",
    body: "Test email body content.",
    confidenceScore: 80,
    ...overrides,
  });
  d.status = "scheduled";
  drafts.set(d.id, d);
  return d;
}

describe("sender service", () => {
  afterEach(() => {
    suppressionList.clear();
    drafts.clear();
    setTotalSent(0);
  });

  // ── shouldQueueForReview ──────────────────────────────────────────────────

  describe("shouldQueueForReview", () => {
    it("always returns true when total sent < 500", () => {
      setTotalSent(0);
      expect(shouldQueueForReview(99)).toBe(true);
      expect(shouldQueueForReview(0)).toBe(true);
    });

    it("returns true when total sent = 499 (boundary)", () => {
      setTotalSent(499);
      expect(shouldQueueForReview(95)).toBe(true);
    });

    it("returns false when total sent >= 500 and confidence >= 70", () => {
      setTotalSent(500);
      expect(shouldQueueForReview(70)).toBe(false);
      expect(shouldQueueForReview(100)).toBe(false);
    });

    it("returns true when total sent >= 500 but confidence < 70", () => {
      setTotalSent(500);
      expect(shouldQueueForReview(69)).toBe(true);
      expect(shouldQueueForReview(0)).toBe(true);
    });
  });

  // ── pickVariant ───────────────────────────────────────────────────────────

  describe("pickVariant", () => {
    it("only returns 'control' or 'experimental'", () => {
      const variants = new Set(Array.from({ length: 100 }, () => pickVariant()));
      expect([...variants].every((v) => v === "control" || v === "experimental")).toBe(true);
    });

    it("control appears roughly 80% of the time over many trials", () => {
      const trials = 2000;
      const controlCount = Array.from({ length: trials }, () => pickVariant()).filter(
        (v) => v === "control"
      ).length;
      const ratio = controlCount / trials;
      expect(ratio).toBeGreaterThan(0.70);
      expect(ratio).toBeLessThan(0.90);
    });
  });

  // ── sendDraft hard gates ──────────────────────────────────────────────────

  describe("sendDraft", () => {
    it("blocks when the email is on the suppression list", async () => {
      const d = makeScheduledDraft();
      suppressionList.add("blocked@example.com");

      const result = await sendDraft({
        draftId: d.id,
        toEmail: "blocked@example.com",
        leadId: "test_lead",
        isVerified: true,
        hasRiskFlags: false,
      });

      expect(result.status).toBe("blocked");
      expect(result.reason).toBe("suppression_list");
    });

    it("blocks when lead has risk flags", async () => {
      const d = makeScheduledDraft();

      const result = await sendDraft({
        draftId: d.id,
        toEmail: "risky@example.com",
        leadId: "test_lead",
        isVerified: true,
        hasRiskFlags: true,
      });

      expect(result.status).toBe("blocked");
      expect(result.reason).toBe("risk_flags");
    });

    it("blocks when email is not verified", async () => {
      const d = makeScheduledDraft();

      const result = await sendDraft({
        draftId: d.id,
        toEmail: "unverified@example.com",
        leadId: "test_lead",
        isVerified: false,
        hasRiskFlags: false,
      });

      expect(result.status).toBe("blocked");
      expect(result.reason).toBe("unverified_email");
    });

    it("blocks when last sent was within 90 days", async () => {
      const d = makeScheduledDraft();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const result = await sendDraft({
        draftId: d.id,
        toEmail: "recent@example.com",
        leadId: "test_lead",
        lastSentAt: thirtyDaysAgo,
        isVerified: true,
        hasRiskFlags: false,
      });

      expect(result.status).toBe("blocked");
      expect(result.reason).toBe("90_day_rule");
    });

    it("does not block when last sent was more than 90 days ago", async () => {
      const d = makeScheduledDraft();
      const ninetyFiveDaysAgo = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString();

      const result = await sendDraft({
        draftId: d.id,
        toEmail: "old@example.com",
        leadId: "test_lead",
        lastSentAt: ninetyFiveDaysAgo,
        isVerified: true,
        hasRiskFlags: false,
      });

      expect(result.status).toBe("sent");
    });

    it("blocks when draft does not exist", async () => {
      const result = await sendDraft({
        draftId: "nonexistent-id",
        toEmail: "someone@example.com",
        leadId: "test_lead",
        isVerified: true,
        hasRiskFlags: false,
      });

      expect(result.status).toBe("blocked");
      expect(result.reason).toBe("draft_not_found");
    });

    it("returns sent status with SES messageId on successful send", async () => {
      const d = makeScheduledDraft();

      const result = await sendDraft({
        draftId: d.id,
        toEmail: "valid@example.com",
        leadId: "test_lead",
        isVerified: true,
        hasRiskFlags: false,
      });

      expect(result.status).toBe("sent");
      expect(result.messageId).toBe("ses_msg_test_001");
    });

    it("marks the draft as 'sent' in the store after a successful send", async () => {
      const d = makeScheduledDraft();

      await sendDraft({
        draftId: d.id,
        toEmail: "valid2@example.com",
        leadId: "test_lead",
        isVerified: true,
        hasRiskFlags: false,
      });

      expect(drafts.get(d.id)?.status).toBe("sent");
    });

    it("suppression list check takes priority over 90-day rule", async () => {
      const d = makeScheduledDraft();
      suppressionList.add("priority@example.com");
      const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

      const result = await sendDraft({
        draftId: d.id,
        toEmail: "priority@example.com",
        leadId: "test_lead",
        lastSentAt: recentDate,
        isVerified: true,
        hasRiskFlags: false,
      });

      expect(result.reason).toBe("suppression_list");
    });
  });
});
