// Blocked local parts — exact match, case-insensitive
const BLOCKED_LOCAL_PARTS = new Set([
  "noreply", "no-reply", "no_reply", "mailer-daemon", "postmaster",
  "bounce", "bounces", "sentry", "bugsnag", "monitoring", "telemetry",
  "alerts", "alert", "notification", "notifications", "devnull", "daemon",
  "abuse", "donotreply", "do-not-reply", "do_not_reply",
]);

// Infrastructure/monitoring service domains — any subdomain also rejected
const INFRASTRUCTURE_DOMAINS = new Set([
  "sentry.io", "bugsnag.com", "amazonses.com", "zendesk.com", "intercom.io",
  "wixpress.com", "mailchimp.com", "sendgrid.net", "mailgun.org",
  "mandrillapp.com", "postmarkapp.com", "sparkpostmail.com", "hubspot.com",
  "salesforce.com", "marketo.com", "mixpanel.com", "segment.com",
  "loggly.com", "rollbar.com", "datadog.com", "newrelic.com",
]);

// UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// MD5: exactly 32 hex chars
const MD5_RE = /^[0-9a-f]{32}$/i;
// Long hex string: 20+ hex chars with no dashes (Sentry DSN-style keys)
const LONG_HEX_RE = /^[0-9a-f]{20,}$/i;
// URL-encoded prefix from JS bundle extraction (u002f, u003e, etc.)
const URL_ENCODED_PREFIX_RE = /^u00[0-9a-f]{2}/i;
// Local part starts with 5+ consecutive digits (page-text concatenation artifact)
const LEADING_DIGITS_RE = /^\d{5,}/;

const PLACEHOLDER_EMAILS = new Set([
  "you@domain.com",
  "test@test.com",
  "example@example.com",
  "user@example.com",
  "email@example.com",
  "name@example.com",
]);

// Max TLD segment length. IANA gTLDs go up to ~24 chars but none our markets
// use are longer than 6. Anything longer is almost certainly a text-concat artifact.
const MAX_TLD_LENGTH = 6;

function isInfrastructureDomain(domain: string): boolean {
  for (const infra of INFRASTRUCTURE_DOMAINS) {
    if (domain === infra || domain.endsWith(`.${infra}`)) return true;
  }
  return false;
}

export function isValidLeadEmail(raw: string): boolean {
  const email = raw.trim().toLowerCase();

  if (PLACEHOLDER_EMAILS.has(email)) return false;

  const atIdx = email.indexOf("@");
  // Must have exactly one @, not at position 0
  if (atIdx <= 0 || atIdx !== email.lastIndexOf("@")) return false;

  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);

  if (!local || !domain) return false;

  // URL-encoded garbage (JS bundle artifacts: u002f, u003e, %)
  if (URL_ENCODED_PREFIX_RE.test(local) || local.includes("%")) return false;

  // Hard-rejected local parts
  if (BLOCKED_LOCAL_PARTS.has(local)) return false;

  // Hash / UUID patterns in local part
  if (UUID_RE.test(local) || MD5_RE.test(local) || LONG_HEX_RE.test(local)) return false;

  // Text-concatenation artifact: local starts with 5+ digits (e.g. "248922hello")
  if (LEADING_DIGITS_RE.test(local)) return false;

  // Domain must have at least one dot and a valid TLD segment
  const domainParts = domain.split(".");
  if (domainParts.length < 2) return false;

  const tld = domainParts[domainParts.length - 1]!;
  // TLD must be alphabetic-only and within length bounds
  if (!/^[a-z]+$/.test(tld) || tld.length > MAX_TLD_LENGTH) return false;

  // Infrastructure / monitoring service domains
  if (isInfrastructureDomain(domain)) return false;

  return true;
}
