import { Hono } from "hono";
import PostalMime from "postal-mime";
import { createVerify } from "node:crypto";
import { db } from "../db";
import { replies, emailEvents, leads, companies, emailDrafts, campaigns, suppressionList, riskFlags } from "../db/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";

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
  notificationType: "Received";
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

function classifyReply(body: string): string {
  const lower = body.toLowerCase();
  if (/unsubscribe|opt.?out|remove me|stop emailing/i.test(lower)) return "unsubscribe";
  if (/legal|lawsuit|report|spam|attorney|solicitor/i.test(lower)) return "hostile";
  if (/interested|yes|love to|sounds good|tell me more|book|call|demo/i.test(lower)) return "positive";
  if (/\?|how|what|when|who|where|clarif|more info/i.test(lower)) return "question";
  return "neutral";
}

function categoryToSentiment(category: string): "positive" | "negative" | "neutral" {
  if (category === "positive") return "positive";
  if (["unsubscribe", "hostile", "negative"].includes(category)) return "negative";
  return "neutral";
}

function resolveAction(category: string): string {
  switch (category) {
    case "positive":   return "demo_booking";
    case "unsubscribe":
    case "negative":   return "suppressed";
    case "hostile":    return "risk_flagged_and_suppressed";
    case "question":   return "flagged_for_review";
    default:           return "flagged_for_review";
  }
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
  leadFirstName: string | null;
  leadLastName: string | null;
  leadEmail: string;
  companyName: string;
  campaignId: string;
  campaignName: string;
}) {
  const isQuestion = row.category === "question";
  const isHostile  = row.category === "hostile";
  return {
    id:            row.id,
    lead_id:       row.leadId,
    lead_name:     [row.leadFirstName, row.leadLastName].filter(Boolean).join(" "),
    lead_email:    row.leadEmail,
    lead_company:  row.companyName,
    campaign_id:   row.campaignId,
    campaign_name: row.campaignName,
    body:          row.body,
    sentiment:     row.sentiment,
    category:      row.category,
    received_at:   row.receivedAt.toISOString(),
    resolved_at:   row.resolvedAt?.toISOString() ?? null,
    is_flagged:    (isQuestion || isHostile) && row.resolvedAt === null,
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
      leadFirstName: leads.firstName,
      leadLastName:  leads.lastName,
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
  const rows = await repliesJoinQuery().orderBy(replies.receivedAt);
  return c.json(rows.map(formatReply));
});

repliesRouter.get("/replies/flagged", async (c) => {
  const rows = await repliesJoinQuery()
    .where(and(isNull(replies.resolvedAt), inArray(replies.category, ["question", "hostile"])))
    .orderBy(replies.receivedAt);
  return c.json(rows.map(formatReply));
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

  if (ses.notificationType !== "Received") {
    return c.json({ ok: true }); // bounce/complaint notifications — not handled here
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
    .select({ id: leads.id, email: leads.email })
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

  const category = classifyReply(replyBody);
  const sentiment = categoryToSentiment(category);

  const [reply] = await db
    .insert(replies)
    .values({ emailEventId, body: replyBody, sentiment, category })
    .returning();

  await db
    .update(emailEvents)
    .set({ repliedAt: new Date() })
    .where(eq(emailEvents.id, emailEventId));

  if (category === "unsubscribe" || category === "negative" || category === "hostile") {
    await db
      .insert(suppressionList)
      .values({ email: fromEmail, reason: category === "hostile" ? "hostile" : "unsubscribed" })
      .onConflictDoNothing();
  }

  if (category === "hostile") {
    await db.insert(riskFlags).values({ leadId: lead.id, flagType: "hostile_interaction" });
  }

  console.log(`[reply-webhook] processed reply from ${fromEmail}: category=${category}`);
  return c.json({ reply, action: resolveAction(category) }, 201);
});
