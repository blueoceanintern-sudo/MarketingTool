import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { db } from "../../db";
import { suppressionList, emailDrafts, emailEvents, campaigns, leads } from "../../db/schema";
import { eq, and, isNotNull, count, gte } from "drizzle-orm";
import { buildEmailHtml } from "../../templates/outreachEmail";

const MAX_EMAILS_PER_LEAD_PER_WEEK = 2;

interface SendPayload {
  draftId: string;
  toEmail: string;
  leadId: string;
  isVerified: boolean;
  hasRiskFlags: boolean;
}

interface SendResult {
  draftId: string;
  status: "sent" | "blocked" | "queued";
  reason?: string;
  messageId?: string;
}

async function getTotalSentFromDB(): Promise<number> {
  const [row] = await db.select({ total: count() }).from(emailEvents).where(isNotNull(emailEvents.sentAt));
  return Number(row?.total ?? 0);
}

async function getWeeklyCountForLead(leadId: string): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ total: count() })
    .from(emailEvents)
    .where(and(eq(emailEvents.leadId, leadId), isNotNull(emailEvents.sentAt), gte(emailEvents.sentAt, sevenDaysAgo)));
  return Number(row?.total ?? 0);
}

async function getTodayCountFromDB(): Promise<number> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ total: count() })
    .from(emailEvents)
    .where(and(isNotNull(emailEvents.sentAt), gte(emailEvents.sentAt, today)));
  return Number(row?.total ?? 0);
}

function getDailyCap(totalSent: number): number {
  if (totalSent < 50) return 50;
  if (totalSent < 250) return 200;
  if (totalSent < 750) return 500;
  return 1000;
}

export async function shouldQueueForReview(confidenceScore: number): Promise<boolean> {
  const totalSent = await getTotalSentFromDB();
  if (totalSent < 500) return true;
  return confidenceScore < 70;
}

export function pickVariant(): "control" | "experimental" {
  return Math.random() < 0.2 ? "experimental" : "control";
}

export async function getTotalSent(): Promise<number> {
  return getTotalSentFromDB();
}

function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
}

let sesClient: SESClient | null = null;

function getSesClient(): SESClient {
  if (!sesClient) {
    sesClient = new SESClient({
      region: process.env.AWS_REGION ?? "ap-southeast-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }
  return sesClient;
}

export async function sendDraft(payload: SendPayload): Promise<SendResult> {
  const { draftId, toEmail, leadId, isVerified, hasRiskFlags } = payload;

  const [suppressed] = await db
    .select({ id: suppressionList.id })
    .from(suppressionList)
    .where(eq(suppressionList.email, toEmail))
    .limit(1);
  if (suppressed) return { draftId, status: "blocked", reason: "suppression_list" };

  const weeklyCount = await getWeeklyCountForLead(leadId);
  if (weeklyCount >= MAX_EMAILS_PER_LEAD_PER_WEEK) {
    return { draftId, status: "blocked", reason: "weekly_cap_reached" };
  }

  if (hasRiskFlags) return { draftId, status: "blocked", reason: "risk_flags" };

  if (!isVerified) return { draftId, status: "blocked", reason: "unverified_email" };

  const [totalSent, todayCount] = await Promise.all([getTotalSentFromDB(), getTodayCountFromDB()]);
  if (todayCount >= getDailyCap(totalSent)) {
    return { draftId, status: "queued", reason: "daily_cap_reached" };
  }

  const [draft] = await db
    .select()
    .from(emailDrafts)
    .where(eq(emailDrafts.id, draftId))
    .limit(1);
  if (!draft) return { draftId, status: "blocked", reason: "draft_not_found" };
  if (draft.status !== "scheduled") {
    return { draftId, status: "blocked", reason: `draft_status_${draft.status}` };
  }

  // Campaign must be active before any outreach goes out — draft/paused
  // campaigns build the lead pool but never send; complete is terminal.
  const [campaign] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, draft.campaignId))
    .limit(1);
  if (!campaign) return { draftId, status: "blocked", reason: "campaign_not_found" };
  if (campaign.status !== "active") {
    return { draftId, status: "blocked", reason: `campaign_status_${campaign.status}` };
  }

  const fromAddress = process.env.AWS_SES_FROM_ADDRESS;
  if (!fromAddress) throw new Error("AWS_SES_FROM_ADDRESS is required");

  const apiBase = getApiBase();
  const unsubscribeUrl = `${apiBase}/unsubscribe?id=${leadId}`;
  const textBody = `${draft.body}\n\nTo unsubscribe: ${unsubscribeUrl}`;
  const htmlBody = buildEmailHtml(draft.body, leadId, apiBase);

  const command = new SendEmailCommand({
    Source: fromAddress,
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: draft.subject, Charset: "UTF-8" },
      Body: {
        Text: { Data: textBody, Charset: "UTF-8" },
        Html: { Data: htmlBody, Charset: "UTF-8" },
      },
    },
  });

  const response = await getSesClient().send(command);
  const messageId = response.MessageId;

  const now = new Date();
  await Promise.all([
    db.insert(emailEvents).values({ draftId, leadId, sentAt: now }),
    db.update(emailDrafts).set({ status: "sent" }).where(eq(emailDrafts.id, draftId)),
    db.update(leads).set({ lastContactedAt: now }).where(eq(leads.id, leadId)),
  ]);

  return { draftId, status: "sent", messageId };
}
