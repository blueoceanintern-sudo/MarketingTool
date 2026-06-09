import { db } from "../../db";
import { auditLog } from "../../db/schema";
import type { AuthUser } from "../../middleware/auth";

export interface AuditEntry {
  // Who performed the action. Pass the AuthUser from the request context for
  // human-triggered actions, or the string "system" for cron / background workers.
  actor: AuthUser | "system";
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
  const actor = entry.actor === "system" ? "system" : entry.actor.email;
  try {
    await db.insert(auditLog).values({
      actor,
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
