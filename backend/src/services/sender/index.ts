import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { suppressionList } from "../../routes/replies";
import { drafts } from "../../routes/drafts";

interface SendPayload {
  draftId: string;
  toEmail: string;
  leadId: string;
  /** ISO string of the last sent_at for this lead, if any */
  lastSentAt?: string;
  isVerified: boolean;
  hasRiskFlags: boolean;
}

interface SendResult {
  draftId: string;
  status: "sent" | "blocked" | "queued";
  reason?: string;
  messageId?: string;
}

// In-memory send count per UTC day — swaps to DB query on emailEvents once Drizzle is wired
const dailySendLog: { date: string; count: number } = { date: "", count: 0 };

// Total cumulative sends — determines phase (< 500 → all to review, ≥ 500 → auto-schedule)
let totalSentAllTime = 0;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDailyCap(): number {
  // Warm-up ramp based on total sent so far
  if (totalSentAllTime < 50) return 50;       // week 1 equivalent
  if (totalSentAllTime < 250) return 200;     // week 2
  if (totalSentAllTime < 750) return 500;     // week 3
  return 1000;                                 // week 4+
}

function getTodayCount(): number {
  const today = todayUtc();
  if (dailySendLog.date !== today) {
    dailySendLog.date = today;
    dailySendLog.count = 0;
  }
  return dailySendLog.count;
}

function incrementTodayCount(): void {
  getTodayCount(); // ensure date is reset if needed
  dailySendLog.count++;
  totalSentAllTime++;
}

/** Returns whether a draft should go to review queue instead of auto-scheduling */
export function shouldQueueForReview(confidenceScore: number): boolean {
  if (totalSentAllTime < 500) return true;
  return confidenceScore < 70;
}

/** Chooses A/B variant — 80% control, 20% experimental */
export function pickVariant(): "control" | "experimental" {
  return Math.random() < 0.2 ? "experimental" : "control";
}

function withinNinetyDays(lastSentAt: string): boolean {
  const diffMs = Date.now() - new Date(lastSentAt).getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays < 90;
}

function buildUnsubscribeLink(leadId: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  return `${base}/unsubscribe?id=${leadId}`;
}

function appendUnsubscribe(body: string, leadId: string): string {
  return `${body}\n\nTo unsubscribe: ${buildUnsubscribeLink(leadId)}`;
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
  const { draftId, toEmail, leadId, lastSentAt, isVerified, hasRiskFlags } = payload;

  // --- Hard gate: suppression list ---
  if (suppressionList.has(toEmail)) {
    return { draftId, status: "blocked", reason: "suppression_list" };
  }

  // --- Hard gate: 90-day rule ---
  if (lastSentAt && withinNinetyDays(lastSentAt)) {
    return { draftId, status: "blocked", reason: "90_day_rule" };
  }

  // --- Hard gate: risk flags ---
  if (hasRiskFlags) {
    return { draftId, status: "blocked", reason: "risk_flags" };
  }

  // --- Hard gate: unverified email ---
  if (!isVerified) {
    return { draftId, status: "blocked", reason: "unverified_email" };
  }

  // --- Hard gate: warm-up daily cap ---
  if (getTodayCount() >= getDailyCap()) {
    return { draftId, status: "queued", reason: "daily_cap_reached" };
  }

  const draft = drafts.get(draftId);
  if (!draft) {
    return { draftId, status: "blocked", reason: "draft_not_found" };
  }

  if (draft.status !== "scheduled") {
    return { draftId, status: "blocked", reason: `draft_status_${draft.status}` };
  }

  const fromAddress = process.env.AWS_SES_FROM_ADDRESS;
  if (!fromAddress) throw new Error("AWS_SES_FROM_ADDRESS is required");

  const bodyWithUnsubscribe = appendUnsubscribe(draft.body, leadId);

  const command = new SendEmailCommand({
    Source: fromAddress,
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: draft.subject, Charset: "UTF-8" },
      Body: { Text: { Data: bodyWithUnsubscribe, Charset: "UTF-8" } },
    },
  });

  const response = await getSesClient().send(command);
  const messageId = response.MessageId;

  incrementTodayCount();

  draft.status = "sent";
  draft.updatedAt = new Date().toISOString();
  drafts.set(draft.id, draft);

  return { draftId, status: "sent", messageId };
}

export function getTotalSent(): number {
  return totalSentAllTime;
}

/** For warmup-tracker worker to sync count from DB once Drizzle is wired */
export function setTotalSent(count: number): void {
  totalSentAllTime = count;
}
