import { describe, it, expect, setDefaultTimeout } from "bun:test";
import { classifyReply } from "../src/services/reply-classifier";

// Live API test — requires ANTHROPIC_API_KEY
// Run with: ANTHROPIC_API_KEY=... bun test tests/reply-classifier.test.ts

setDefaultTimeout(20000);

// ── Positive ──────────────────────────────────────────────────────────────────

describe("positive", () => {
  it("explicit interest in learning more", async () => {
    const result = await classifyReply("I'd love to learn more. Can we set up a call?");
    expect(result.category).toBe("positive");
    expect(result.risk_flag).toBe(false);
    expect(result.return_date).toBeNull();
  });

  it("pricing / info request", async () => {
    const result = await classifyReply("What are your rates? Please send me more details.");
    expect(result.category).toBe("positive");
  });

  it("scheduling intent", async () => {
    const result = await classifyReply("Sure, let's set up a call. What times work for you?");
    expect(result.category).toBe("positive");
  });

  it("brief info request is still positive", async () => {
    const result = await classifyReply("Can you explain what you offer?");
    expect(result.category).toBe("positive");
  });
});

// ── Negative ──────────────────────────────────────────────────────────────────

describe("negative", () => {
  it("plain unsubscribe request", async () => {
    const result = await classifyReply("Please remove me from your list.");
    expect(result.category).toBe("negative");
    expect(result.risk_flag).toBe(false);
  });

  it("hostile with PDPA threat sets risk_flag", async () => {
    const result = await classifyReply(
      "Stop emailing me or I will file a complaint with the PDPA authorities and forward this to our legal team."
    );
    expect(result.category).toBe("negative");
    expect(result.risk_flag).toBe(true);
  });

  it("cease and desist sets risk_flag", async () => {
    const result = await classifyReply(
      "This is a cease and desist. Do not contact us again or we will pursue legal action."
    );
    expect(result.category).toBe("negative");
    expect(result.risk_flag).toBe(true);
  });

  it('"thanks but not interested" is negative not neutral', async () => {
    const result = await classifyReply("Thanks, but we're not interested.");
    expect(result.category).toBe("negative");
  });

  it("delivery failure / mailbox full is negative", async () => {
    const result = await classifyReply(
      "Delivery Status Notification: Mailbox full. Your message to carol@gamma.edu.sg could not be delivered."
    );
    expect(result.category).toBe("negative");
  });

  it("stop contacting me without legal threat is negative, no risk_flag", async () => {
    const result = await classifyReply("Stop emailing me. I am not interested.");
    expect(result.category).toBe("negative");
    expect(result.risk_flag).toBe(false);
  });
});

// ── Out of Office ─────────────────────────────────────────────────────────────

describe("out_of_office", () => {
  it("OOO with explicit ISO return date extracts the date", async () => {
    const result = await classifyReply(
      "I am out of the office until 2026-07-15. I will respond when I return."
    );
    expect(result.category).toBe("out_of_office");
    expect(result.return_date).toBe("2026-07-15");
    expect(result.risk_flag).toBe(false);
  });

  it("OOO with natural language date extracts and formats it", async () => {
    const result = await classifyReply(
      "Hi, I'm on leave until July 20th 2026 and will reply once I'm back."
    );
    expect(result.category).toBe("out_of_office");
    expect(result.return_date).toBe("2026-07-20");
  });

  it("OOO without any return date returns null", async () => {
    const result = await classifyReply(
      "I am currently out of the office. I will reply when I am back."
    );
    expect(result.category).toBe("out_of_office");
    expect(result.return_date).toBeNull();
  });

  it("auto-reply vacation message is out_of_office", async () => {
    const result = await classifyReply(
      "Auto-reply: I am away on vacation and will have limited access to email."
    );
    expect(result.category).toBe("out_of_office");
  });
});

// ── Neutral ───────────────────────────────────────────────────────────────────

describe("neutral", () => {
  it("polite timing deflection is neutral not negative", async () => {
    const result = await classifyReply("No budget right now, maybe circle back next quarter.");
    expect(result.category).toBe("neutral");
    expect(result.risk_flag).toBe(false);
  });

  it("capacity deflection is neutral not negative", async () => {
    const result = await classifyReply("We're already sorted for now, but reach out next year.");
    expect(result.category).toBe("neutral");
  });

  it('"thanks" alone is neutral not positive', async () => {
    const result = await classifyReply("Thanks.");
    expect(result.category).toBe("neutral");
  });

  it('"noted" alone is neutral', async () => {
    const result = await classifyReply("Noted.");
    expect(result.category).toBe("neutral");
  });

  it("who are you / how did you get my email is neutral", async () => {
    const result = await classifyReply("Who are you? How did you get my email?");
    expect(result.category).toBe("neutral");
  });

  it("not the right fit is neutral", async () => {
    const result = await classifyReply("Not the right time for us right now.");
    expect(result.category).toBe("neutral");
  });
});

// ── Edge Cases ────────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("OOO + unsubscribe: negative wins over out_of_office", async () => {
    const result = await classifyReply(
      "I'm out until 2026-07-15. Not interested, please don't email me again."
    );
    expect(result.category).toBe("negative");
  });

  it("OOO + positive: out_of_office wins over positive", async () => {
    const result = await classifyReply(
      "I'm out of office until 2026-07-10. I'd love to chat when I'm back — please follow up then."
    );
    expect(result.category).toBe("out_of_office");
    expect(result.return_date).toBe("2026-07-10");
  });

  it("ignores quoted original email below reply divider", async () => {
    const result = await classifyReply(
      "Please remove me from your list.\r\n\r\n-----Original Message-----\r\nFrom: outreach@blueocean.com\r\nSubject: Helping SG schools\r\n\r\nHi Carol, I wanted to reach out about saving admin time..."
    );
    expect(result.category).toBe("negative");
  });

  it("positive content above divider is not contaminated by unrelated quoted text below", async () => {
    const result = await classifyReply(
      "I'd love to learn more!\r\n\r\nOn Mon, Jun 23 2026 outreach@blueocean.com wrote:\r\n> Hi Carol, remove me from your list if needed..."
    );
    expect(result.category).toBe("positive");
  });

  it("GDPR regulatory complaint threat sets risk_flag", async () => {
    const result = await classifyReply(
      "I am reporting this email to the ICO as a GDPR violation. Do not contact me again."
    );
    expect(result.category).toBe("negative");
    expect(result.risk_flag).toBe(true);
  });

  it("pricing question mixed with timing hesitation is positive", async () => {
    const result = await classifyReply(
      "Interesting. We don't have budget right now but what are your pricing plans?"
    );
    expect(result.category).toBe("positive");
  });
});
