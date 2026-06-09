// ─── Constants (edit here to tune filtering) ─────────────────────────────────

const BLOCKLIST = new Set([
  "newsletter", "library", "helpdesk", "itsupport", "noreply", "no-reply", "no_reply",
  "alumni", "events", "finance", "accommodation", "studentservices", "welfare",
  "exams", "support", "info", "hello", "admin", "webmaster", "postmaster",
  "marketing", "careers", "jobs", "press", "feedback", "abuse", "legal",
  "billing", "accounts", "team", "media", "it", "tech",
]);

const EDU_ROLE_ALLOWLIST = new Set([
  "admissions", "principal", "rector", "registrar", "dean", "provost",
  "director", "headmaster", "bursar",
]);

// UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// MD5: exactly 32 hex chars
const MD5_RE = /^[0-9a-f]{32}$/i;
// Long hex string: 20+ hex chars with no dashes
const LONG_HEX_RE = /^[0-9a-f]{20,}$/i;

// A name segment is either purely alphabetic, or alpha with a trailing
// 4-digit year (1900–2099). e.g. "smith", "smith1990" — but NOT "smith123456".
const NAME_SEGMENT_RE = /^[a-z]+(?:(?:19|20)\d{2})?$/;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripAlias(local: string): string {
  return local.split("+")[0]!;
}

// Returns true if the local part follows a separator-based name pattern:
// john.smith, j.smith, john_smith, john-smith, j.m.smith, john.smith1990, etc.
// Every segment split by [._-] must match NAME_SEGMENT_RE.
function isSeparatorName(local: string): boolean {
  if (!/[._-]/.test(local)) return false;
  const segments = local.split(/[._\-]/);
  if (segments.length < 2) return false;
  return segments.every((seg) => seg.length > 0 && NAME_SEGMENT_RE.test(seg));
}

function isHashOrUuid(local: string): boolean {
  return UUID_RE.test(local) || MD5_RE.test(local) || LONG_HEX_RE.test(local);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function isValidEduEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();

  const atIdx = normalized.indexOf("@");
  if (atIdx <= 0 || atIdx !== normalized.lastIndexOf("@")) return false;

  const local = normalized.slice(0, atIdx);
  if (!local || local.length < 2 || local.length > 64) return false;

  const localBase = stripAlias(local);

  if (isHashOrUuid(localBase)) return false;
  if (BLOCKLIST.has(localBase)) return false;
  if (isSeparatorName(localBase)) return true;
  if (EDU_ROLE_ALLOWLIST.has(localBase)) return true;

  // Single word with no separator and not in the allowlist.
  return false;
}

// Returns 1.0 for separator-based name patterns, 0.7 for allowlist roles, 0.0 otherwise.
export function scoreEmail(email: string): number {
  if (!isValidEduEmail(email)) return 0.0;

  const normalized = email.trim().toLowerCase();
  const atIdx = normalized.indexOf("@");
  const localBase = stripAlias(normalized.slice(0, atIdx));

  if (isSeparatorName(localBase)) return 1.0;
  if (EDU_ROLE_ALLOWLIST.has(localBase)) return 0.7;

  return 0.0;
}
