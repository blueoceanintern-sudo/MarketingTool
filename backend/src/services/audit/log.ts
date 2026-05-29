import { db } from "../../db";
import { auditLog } from "../../db/schema";

export interface AuditEntry {
  // Who performed the action. Use "system" for cron jobs / background workers,
  // a user identifier for human-triggered actions. Until auth lands, route
  // handlers pass "user" for any /api/v1/* mutation.
  actor: string;
  // Verb-noun convention: "lead.move", "lead.remove", "campaign.update",
  // "draft.approve", "suppression.add", "lead.erase". Stick to lowercase.
  action: string;
  targetId?: string | null;
  targetType?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Writes an audit_log row. Swallows DB errors after logging to console — audit
// logging is observational, so a failure here must never block the calling
// operation (worse to fail a user's lead move because audit insert errored).
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actor: entry.actor,
      action: entry.action,
      targetId: entry.targetId ?? null,
      targetType: entry.targetType ?? null,
      ipAddress: entry.ipAddress ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch (err) {
    console.error(`[audit] failed to write entry (${entry.action}, target=${entry.targetId ?? "—"}):`, err);
  }
}
