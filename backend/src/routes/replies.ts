import { Hono } from "hono";
import PostalMime from "postal-mime";
import { createVerify } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { replies, emailEvents, leads, companies, emailDrafts, campaigns, suppressionList, followUps, demos, riskFlags, promptTemplates, campaignLeads } from "../db/schema";
import { count, eq, and, isNull, inArray, asc, sql } from "drizzle-orm";

// ── SNS types ─────────────────────────────────────────────────────────────────

interface SnsEnvelope {
  Type: "SubscriptionConfirmation" | "Notification" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string;      // present on SubscriptionConfirmation
  Token?: string;
}

interface SesNotification {
  notificationType: "Received" | "Complaint" | "Bounce";
  mail: {
    messageId: string;
    source: string;
    commonHeaders: {
      from?: string[];
      messageId?: string;
      inReplyTo?: string;
      subject?: string;
    };
  };
  content?: string;            // raw MIME — present when SES rule stores inline
  complaint?: {
    complainedRecipients: Array<{ emailAddress: string }>;
    feedbackId?: string;
    complaintFeedbackType?: string;
  };
}

// ── SNS signature verification ────────────────────────────────────────────────
// AWS SDK v3 dropped the built-in SNS validator. We implement per AWS docs:
// https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html

const SNS_CERT_CACHE = new Map<string, string>();

// Fields to include in the signing string, in alphabetical order per AWS docs.
// Subject is optional on Notification messages — filtered out if absent.
// https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
const NOTIFICATION_FIELDS     = ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"];
const CONFIRMATION_FIELDS     = ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];

function buildSigningString(msg: SnsEnvelope): string {
  const fields = msg.Type === "Notification" ? NOTIFICATION_FIELDS : CONFIRMATION_FIELDS;
  const m = msg as unknown as Record<string, unknown>;
  return fields
    .filter((f) => m[f] !== undefined)
    .map((f) => `${f}\n${m[f]}\n`)
    .join("");
}

async function verifySnsSignature(msg: SnsEnvelope): Promise<boolean> {
  const certUrl = msg.SigningCertURL;

  // Cert URL must be HTTPS and served from an official SNS subdomain.
  if (!/^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(certUrl)) return false;

  // Cert is cached in-memory — SNS rotates certs infrequently.
  let cert = SNS_CERT_CACHE.get(certUrl);
  if (!cert) {
    const res = await fetch(certUrl);
    if (!res.ok) return false;
    cert = await res.text();
    SNS_CERT_CACHE.set(certUrl, cert);
  }

  // AWS recommends SHA256 (SignatureVersion "2") over SHA1 ("1").
  // Support both so existing topics on v1 still work during migration.
  const algorithm = msg.SignatureVersion === "2" ? "sha256WithRSAEncryption" : "sha1WithRSAEncryption";

  try {
    const verifier = createVerify(algorithm);
    verifier.update(buildSigningString(msg));
    return verifier.verify(cert, msg.Signature, "base64");
  } catch {
    return false;
  }
}

// ── Reply classification ───────────────────────────────────────────────────────

const anthropic = new Anthropic();

async function classifyReply(body: string): Promise<{ category: string; return_date: string | null; risk_flag: boolean }> {
  const currentDate = new Date().toISOString().split("T")[0];
  const systemPrompt = `You are classifying replies to cold marketing emails. Your job is to categorise the reply into exactly one of four classes, extract any return date if present, and flag legal/hostile language.

Current date: ${currentDate}

## Classes

positive — the recipient shows explicit interest, willingness to continue discussion, a request for more information or pricing, scheduling intent, or openness to evaluating the offer.
Examples: "I'd love to learn more", "Can we set up a call?", "Send me your pricing", "Yes, let's talk", "Please send more details", "Can you explain what you offer?", "What are your rates?"

negative — the recipient explicitly asks to be removed, expresses hostility, uses legal/regulatory language, or the reply is a delivery failure or mailbox error.
Examples: "Please unsubscribe me", "Remove me from your list", "Mailbox full", "Delivery failed", "Stop contacting me or I will file a complaint", "I am forwarding this to our legal team"
IMPORTANT: Polite rejections due to timing, budget, or capacity ("no budget right now", "circle back next quarter", "not in the market", "we already have something similar") are NOT negative — classify them as neutral. Only classify as negative if the recipient explicitly requests removal, expresses hostility, or the message is a delivery failure.

out_of_office — the reply is an automated out-of-office or vacation message, not a human response.
Examples: "I am out of the office until...", "I will be back on...", "I'm on leave", "Auto-reply: away until..."

neutral — the reply does not clearly fit any of the above. This includes: ambiguous or challenging replies, acknowledgements without clear intent, AND polite timing/budget/capacity deflections ("circle back next quarter", "no budget right now", "not the right fit at the moment", "we're already sorted").
Examples: "Who are you?", "How did you get my email?", "What company is this?", "OK", "Thanks", "Noted", "No budget right now", "Reach out next quarter", "Not the right time for us"
Note: "Thanks" and similar pleasantries without engagement signal are neutral, not positive. Polite deflections are neutral, not negative.

## Priority order

When a reply contains multiple signals, apply this priority:
1. negative — wins over out_of_office, positive, and neutral
2. out_of_office — wins over positive and neutral
3. positive
4. neutral

Example: "I'm out until June 20. Not interested." → negative
Example: "Stop emailing me or I'll report this to the authorities." → negative, risk_flag: true
Example: "Out of office until July 1. Please reach out to my colleague instead." → out_of_office
Example: "Thanks, but we're not interested." → negative
Example: "Please send pricing." → positive

## risk_flag

Set risk_flag to true when the reply contains any of: legal threats, cease-and-desist language, explicit accusations of harassment, threats of regulatory complaint (GDPR/PDPA/CAN-SPAM), or demands for legal action. Always negative when risk_flag is true.

## Date extraction

If the class is out_of_office, extract the return date if one is explicitly stated. Format as YYYY-MM-DD using ${currentDate} as reference for relative dates like "next Monday" or "end of the week". If no date is found or the date is ambiguous, return null.

## Instructions

1. Classify the reply into exactly one class, even if multiple signals are present. Follow the priority order above.
2. Ignore all quoted original email text below any reply divider (e.g. "On [date] wrote:", "-----Original Message-----"). Classify only the new reply content.
3. Unsubscribe requests, delivery failures, and mailbox errors are always negative regardless of tone.
4. Requests for pricing, details, or further information are always positive regardless of brevity.
5. When in doubt, classify as neutral.

## Output format

Return only valid JSON. No explanation, no preamble, no markdown fences.

{
  "sentiment": "positive" | "negative" | "out_of_office" | "neutral",
  "return_date": "YYYY-MM-DD" | null,
  "risk_flag": true | false
}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 128,
      system: systemPrompt,
      messages: [{ role: "user", content: `<reply>\n${body}\n</reply>` }],
    });
    const first = response.content[0];
    const text = first?.type === "text" ? first.text : "";
    const parsed = JSON.parse(text) as { sentiment?: string; return_date?: string | null; risk_flag?: boolean };
    return {
      category: parsed.sentiment ?? "neutral",
      return_date: parsed.return_date ?? null,
      risk_flag: parsed.risk_flag ?? false,
    };
  } catch {
    return { category: "neutral", return_date: null, risk_flag: false };
  }
}

function categoryToSentiment(category: string): "positive" | "negative" | "neutral" | "out_of_office" {
  if (category === "positive") return "positive";
  if (category === "negative") return "negative";
  if (category === "out_of_office") return "out_of_office";
  return "neutral";
}

async function deactivateFamily(rootId: string): Promise<void> {
  await db.execute(sql`
    WITH RECURSIVE family AS (
      SELECT id FROM prompt_templates WHERE id = ${rootId}
      UNION ALL
      SELECT pt.id FROM prompt_templates pt
      INNER JOIN family f ON pt.parent_template_id = f.id
    )
    UPDATE prompt_templates SET active = false
    WHERE id IN (SELECT id FROM family)
  `);
}

// ── Format helpers ─────────────────────────────────────────────────────────────

function formatReply(row: {
  id: string;
  body: string;
  sentiment: string;
  category: string;
  receivedAt: Date;
  resolvedAt: Date | null;
  leadId: string;
  leadName: string | null;
  leadEmail: string;
  companyName: string;
  campaignId: string;
  campaignName: string;
}) {
  return {
    id:            row.id,
    lead_id:       row.leadId,
    lead_name:     row.leadName ?? "",
    lead_email:    row.leadEmail,
    lead_company:  row.companyName,
    campaign_id:   row.campaignId,
    campaign_name: row.campaignName,
    body:          row.body,
    sentiment:     row.sentiment,
    category:      row.category,
    received_at:   row.receivedAt.toISOString(),
    resolved_at:   row.resolvedAt?.toISOString() ?? null,
    is_flagged:    (row.category === "positive" || row.category === "neutral") && row.resolvedAt === null,
  };
}

const repliesJoinQuery = () =>
  db
    .select({
      id:            replies.id,
      body:          replies.body,
      sentiment:     replies.sentiment,
      category:      replies.category,
      receivedAt:    replies.receivedAt,
      resolvedAt:    replies.resolvedAt,
      leadId:        leads.id,
      leadName:      leads.name,
      leadEmail:     leads.email,
      companyName:   companies.name,
      campaignId:    campaigns.id,
      campaignName:  campaigns.name,
    })
    .from(replies)
    .innerJoin(emailEvents, eq(replies.emailEventId, emailEvents.id))
    .innerJoin(leads,       eq(emailEvents.leadId,   leads.id))
    .innerJoin(companies,   eq(leads.companyId,      companies.id))
    .innerJoin(emailDrafts, eq(emailEvents.draftId,  emailDrafts.id))
    .innerJoin(campaigns,   eq(emailDrafts.campaignId, campaigns.id));

// ── Router ────────────────────────────────────────────────────────────────────

export const repliesRouter = new Hono();

repliesRouter.get("/replies", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50));
  const offset = (page - 1) * limit;

  const [countRow] = await db.select({ total: count() }).from(replies);
  const total = Number(countRow?.total ?? 0);

  const rows = await repliesJoinQuery()
    .orderBy(replies.receivedAt)
    .limit(limit)
    .offset(offset);

  return c.json({
    data: rows.map(formatReply),
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
  });
});

repliesRouter.get("/replies/flagged", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50));
  const offset = (page - 1) * limit;

  const flaggedWhere = and(isNull(replies.resolvedAt), inArray(replies.category, ["positive", "neutral"]));

  const [countRow] = await db
    .select({ total: count() })
    .from(replies)
    .where(flaggedWhere);
  const total = Number(countRow?.total ?? 0);

  const rows = await repliesJoinQuery()
    .where(flaggedWhere)
    .orderBy(replies.receivedAt)
    .limit(limit)
    .offset(offset);

  return c.json({
    data: rows.map(formatReply),
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
  });
});

repliesRouter.patch("/replies/:id/resolve", async (c) => {
  const [reply] = await db
    .select()
    .from(replies)
    .where(eq(replies.id, c.req.param("id")))
    .limit(1);
  if (!reply) return c.json({ error: "Reply not found" }, 404);

  await db.update(replies).set({ resolvedAt: new Date() }).where(eq(replies.id, reply.id));
  return c.json({ id: reply.id, resolved: true });
});

// POST /webhooks/ses/reply
// Receives SNS notifications from SES inbound receipt rules.
// Handles: SubscriptionConfirmation, Notification (SES Received).
repliesRouter.post("/webhooks/ses/reply", async (c) => {
  const raw = await c.req.json<SnsEnvelope>();

  // Verify SNS signature on every message type.
  const valid = await verifySnsSignature(raw).catch(() => false);
  if (!valid) {
    console.warn("[reply-webhook] SNS signature verification failed");
    return c.json({ error: "Invalid SNS signature" }, 403);
  }

  // Reject messages from unexpected topics to prevent spoofing.
  // SNS_TOPIC_ARN must be set in production; skipped in dev if absent.
  const expectedArn = process.env.SNS_TOPIC_ARN;
  if (expectedArn && raw.TopicArn !== expectedArn) {
    console.warn(`[reply-webhook] unexpected TopicArn: ${raw.TopicArn}`);
    return c.json({ error: "Unexpected TopicArn" }, 403);
  }

  // One-time handshake: confirm the SNS subscription by fetching SubscribeURL.
  if (raw.Type === "SubscriptionConfirmation") {
    if (!raw.SubscribeURL) return c.json({ error: "Missing SubscribeURL" }, 400);
    await fetch(raw.SubscribeURL);
    console.log("[reply-webhook] SNS subscription confirmed");
    return c.json({ ok: true });
  }

  if (raw.Type !== "Notification") {
    return c.json({ ok: true }); // ignore UnsubscribeConfirmation silently
  }

  // Parse the SES notification envelope.
  let ses: SesNotification;
  try {
    ses = JSON.parse(raw.Message) as SesNotification;
  } catch {
    return c.json({ error: "Could not parse SES notification" }, 400);
  }

  if (ses.notificationType === "Complaint") {
    const complainedEmails = ses.complaint?.complainedRecipients.map((r) => r.emailAddress) ?? [];
    for (const email of complainedEmails) {
      const [complainant] = await db
        .select({ id: leads.id, lastDeliveredTemplateId: leads.lastDeliveredTemplateId })
        .from(leads)
        .where(eq(leads.email, email))
        .limit(1);
      if (!complainant?.lastDeliveredTemplateId) continue;

      await db
        .update(promptTemplates)
        .set({ spamComplaintCount: sql`${promptTemplates.spamComplaintCount} + 1` })
        .where(eq(promptTemplates.id, complainant.lastDeliveredTemplateId));

      const [tmpl] = await db
        .select({ sendCount: promptTemplates.sendCount, spamComplaintCount: promptTemplates.spamComplaintCount })
        .from(promptTemplates)
        .where(eq(promptTemplates.id, complainant.lastDeliveredTemplateId))
        .limit(1);

      if (tmpl && tmpl.sendCount > 0 && tmpl.spamComplaintCount >= 3 && tmpl.spamComplaintCount / tmpl.sendCount >= 0.001) {
        const killedId = complainant.lastDeliveredTemplateId;
        await deactivateFamily(killedId);
        console.error(`[reply-webhook:kill-switch] template ${killedId} disabled — spam complaint rate exceeded 0.1%. Full lineage frozen.`);
      }
    }
    console.log(`[reply-webhook:complaint] processed ${complainedEmails.length} complaint(s)`);
    return c.json({ ok: true });
  }

  if (ses.notificationType !== "Received") {
    return c.json({ ok: true }); // bounce and other notification types — not handled here
  }

  const inReplyTo = ses.mail.commonHeaders.inReplyTo?.trim();
  const fromAddresses = ses.mail.commonHeaders.from ?? [];

  // Extract sender email from "Name <email>" or bare "email" format.
  const fromEmail = fromAddresses
    .map((f) => f.match(/<([^>]+)>/)?.[1] ?? f.trim())
    .find(Boolean);

  if (!fromEmail) {
    console.warn("[reply-webhook] could not extract From address from:", fromAddresses);
    return c.json({ error: "Could not determine sender address" }, 400);
  }

  // Look up the lead by reply-from address.
  const [lead] = await db
    .select({ id: leads.id, email: leads.email, lastDeliveredTemplateId: leads.lastDeliveredTemplateId })
    .from(leads)
    .where(eq(leads.email, fromEmail))
    .limit(1);

  if (!lead) {
    console.warn(`[reply-webhook] no lead found for email: ${fromEmail}`);
    return c.json({ ok: true }); // not a tracked lead — drop silently
  }

  // Match email event via In-Reply-To header → ses_message_id.
  // Falls back to most recent unsent-to event for this lead if header is absent.
  let emailEventId: string | null = null;

  if (inReplyTo) {
    const [matched] = await db
      .select({ id: emailEvents.id })
      .from(emailEvents)
      .where(and(eq(emailEvents.leadId, lead.id), eq(emailEvents.sesMessageId, inReplyTo)))
      .limit(1);
    emailEventId = matched?.id ?? null;
  }

  if (!emailEventId) {
    // Fallback: most recent sent event for this lead with no reply yet.
    const [latest] = await db
      .select({ id: emailEvents.id })
      .from(emailEvents)
      .where(and(eq(emailEvents.leadId, lead.id), isNull(emailEvents.repliedAt)))
      .orderBy(emailEvents.sentAt)
      .limit(1);
    emailEventId = latest?.id ?? null;
  }

  if (!emailEventId) {
    console.warn(`[reply-webhook] no matching email event for lead: ${lead.id}`);
    return c.json({ ok: true }); // unsolicited reply — drop silently
  }

  // Parse the plain-text body from raw MIME.
  let replyBody = "";
  if (ses.content) {
    try {
      const parsed = await PostalMime.parse(ses.content);
      replyBody = parsed.text ?? parsed.html ?? "";
    } catch (err) {
      console.error("[reply-webhook] MIME parse error:", err);
      replyBody = "";
    }
  }

  if (!replyBody.trim()) {
    console.warn(`[reply-webhook] empty body for event ${emailEventId}`);
    return c.json({ ok: true });
  }

  const { category, return_date, risk_flag } = await classifyReply(replyBody);
  const sentiment = categoryToSentiment(category);

  // Resolve campaign_id from the matched email event → draft.
  const [eventDraft] = await db
    .select({ campaignId: emailDrafts.campaignId })
    .from(emailEvents)
    .innerJoin(emailDrafts, eq(emailEvents.draftId, emailDrafts.id))
    .where(eq(emailEvents.id, emailEventId))
    .limit(1);
  const campaignId = eventDraft?.campaignId ?? null;

  const [reply] = await db
    .insert(replies)
    .values({ emailEventId, body: replyBody, sentiment, category })
    .returning();
  if (!reply) {
    return c.json({ error: "Failed to record reply" }, 500);
  }

  await db
    .update(emailEvents)
    .set({ repliedAt: new Date() })
    .where(eq(emailEvents.id, emailEventId));

  if (campaignId) {
    if (category === "positive") {
      await db.insert(demos).values({ leadId: lead.id, campaignId, replyId: reply.id });
      await db
        .delete(followUps)
        .where(and(eq(followUps.leadId, lead.id), eq(followUps.campaignId, campaignId), isNull(followUps.sentAt)));
      await db
        .update(campaignLeads)
        .set({ status: "converted" })
        .where(and(eq(campaignLeads.leadId, lead.id), eq(campaignLeads.campaignId, campaignId)));
      if (lead.lastDeliveredTemplateId) {
        await db
          .update(promptTemplates)
          .set({ positiveIntentCount: sql`${promptTemplates.positiveIntentCount} + 1` })
          .where(eq(promptTemplates.id, lead.lastDeliveredTemplateId));
      }
    } else if (category === "negative") {
      if (risk_flag) {
        await db.insert(riskFlags).values({ leadId: lead.id, flagType: "hostile_interaction" });
      }
      await db.insert(suppressionList).values({ email: fromEmail, campaignId, reason: "manual" }).onConflictDoNothing();
      await db
        .update(campaignLeads)
        .set({ status: "suppressed" })
        .where(and(eq(campaignLeads.leadId, lead.id), eq(campaignLeads.campaignId, campaignId)));
      await db
        .delete(followUps)
        .where(and(eq(followUps.leadId, lead.id), eq(followUps.campaignId, campaignId), isNull(followUps.sentAt)));
      await db
        .delete(emailDrafts)
        .where(and(eq(emailDrafts.leadId, lead.id), eq(emailDrafts.campaignId, campaignId), eq(emailDrafts.status, "pending_review")));
      if (lead.lastDeliveredTemplateId) {
        await db
          .update(promptTemplates)
          .set({ negativeReplyCount: sql`${promptTemplates.negativeReplyCount} + 1` })
          .where(eq(promptTemplates.id, lead.lastDeliveredTemplateId));
      }
    } else if (category === "out_of_office") {
      const returnDate = return_date ? new Date(return_date) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const [nextFollowUp] = await db
        .select({ id: followUps.id })
        .from(followUps)
        .where(and(eq(followUps.leadId, lead.id), eq(followUps.campaignId, campaignId), isNull(followUps.sentAt)))
        .orderBy(asc(followUps.scheduledAt))
        .limit(1);

      if (nextFollowUp) {
        await db.update(followUps).set({ scheduledAt: returnDate }).where(eq(followUps.id, nextFollowUp.id));
      } else {
        await db.insert(followUps).values({ leadId: lead.id, campaignId, attemptNumber: 1, scheduledAt: returnDate });
      }
      // OOO is an auto-response — lead hasn't engaged, follow-up sequence continues; leave status as contacted.
    } else {
      // neutral: reply saved, left unresolved for rep review; follow-up sequence continues
      await db
        .update(campaignLeads)
        .set({ status: "replied" })
        .where(and(eq(campaignLeads.leadId, lead.id), eq(campaignLeads.campaignId, campaignId)));
    }
  }

  console.log(`[reply-webhook] processed reply from ${fromEmail}: category=${category}`);
  return c.json({ reply }, 201);
});
