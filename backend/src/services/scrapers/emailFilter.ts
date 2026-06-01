import { parse } from "tldts";

// ─── Blocked local parts ──────────────────────────────────────────────────────
const BLOCKED_LOCAL_PARTS = new Set([
  // Delivery system / bounce
  "noreply", "no-reply", "no_reply", "mailer-daemon", "postmaster",
  "bounce", "bounces", "daemon", "devnull",
  // Monitoring / alerting / tracking
  "sentry", "bugsnag", "monitoring", "telemetry",
  "alerts", "alert", "notification", "notifications", "automated", "feedback",
  // Opt-out / list management
  "abuse", "donotreply", "do-not-reply", "do_not_reply",
  "unsubscribe", "subscribe", "listserv", "newsletter",
  // Technical ops — never a sales contact
  "webmaster", "hostmaster", "root", "www", "noc",
  // Obvious garbage / test
  "test", "demo", "sample", "spam", "junk", "trash", "null", "nobody", "undefined",
  // Generic role inboxes — team queues, not individual contacts
  "info", "admin", "support", "contact", "sales", "help", "team",
]);

// Generic placeholder locals that are never real contacts
const PLACEHOLDER_LOCALS = new Set([
  "user", "email", "name", "firstname", "lastname", "your", "yourname", "youremail",
]);

// Placeholder / disposable domains
const PLACEHOLDER_DOMAINS = new Set([
  "example.com", "example.org", "example.net",
  "domain.com", "test.com", "mailinator.com", "tempmail.com",
  "guerrillamail.com", "sharklasers.com", "throwam.com",
  "yopmail.com", "trashmail.com", "maildrop.cc", "dispostable.com",
  "fakeinbox.com", "spam4.me", "trashmail.io",
]);

// Infrastructure / monitoring / marketing-automation domains.
// Any subdomain is also rejected.
const INFRASTRUCTURE_DOMAINS = new Set([
  // Error tracking
  "sentry.io", "bugsnag.com", "honeybadger.io", "airbrake.io", "raygun.com", "rollbar.com",
  // Observability / APM
  "newrelic.com", "datadog.com", "datadoghq.com", "loggly.com", "pingdom.com",
  // Alerting / incident
  "pagerduty.com", "statuspage.io", "opsgenie.com",
  // Analytics / product
  "mixpanel.com", "segment.com", "amplitude.com", "heap.io", "fullstory.com", "hotjar.com",
  // Email infrastructure
  "amazonses.com", "sendgrid.net", "mailgun.org", "mandrillapp.com",
  "postmarkapp.com", "sparkpostmail.com", "mailchimp.com",
  // CRM / marketing automation
  "hubspot.com", "salesforce.com", "marketo.com", "braze.com",
  "klaviyo.com", "constantcontact.com", "campaignmonitor.com",
  "activecampaign.com", "getresponse.com", "drip.com",
  // Support / comms
  "zendesk.com", "intercom.io",
  // Platforms that embed tracking DSNs in page source
  "wixpress.com",
]);

// ─── Regexes ──────────────────────────────────────────────────────────────────

// Invisible / zero-width Unicode characters injected by HTML scrapers or copy-paste.
// Always use \u escapes — literal invisible chars in source are unreliable.
// Reject rather than strip: an address with hidden chars is obfuscated or garbage.
const ZERO_WIDTH_RE = /[​‌‍﻿⁠­]/u;

// Practical local-part character allowlist (deliberately stricter than RFC 5321).
// Rejects: quoted locals "john..doe", path chars (/), assignment (=), percent (%).
// Allowed: a-z 0-9 . _ + -
const VALID_LOCAL_CHARS_RE = /^[a-z0-9._+\-]+$/;

// UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// MD5: exactly 32 hex chars
const MD5_RE = /^[0-9a-f]{32}$/i;
// Long hex string: 20+ hex chars, no dashes (Sentry DSN-style keys)
const LONG_HEX_RE = /^[0-9a-f]{20,}$/i;
// JS-bundle URL-encoded prefix artifact (u002f → %2F, u003e → %3E, etc.)
const URL_ENCODED_PREFIX_RE = /^u00[0-9a-f]{2}/i;
// Local part starts with 5+ consecutive digits (page-text concatenation artifact)
const LEADING_DIGITS_RE = /^\d{5,}/;

function isInfrastructureDomain(domain: string): boolean {
  for (const infra of INFRASTRUCTURE_DOMAINS) {
    if (domain === infra || domain.endsWith(`.${infra}`)) return true;
  }
  return false;
}

export function isValidLeadEmail(raw: string): boolean {
  // Step 1 — Reject invisible/zero-width Unicode characters.
  //           Stripping would silently pass obfuscated addresses; rejection is safer.
  if (ZERO_WIDTH_RE.test(raw)) return false;

  const email = raw.trim().toLowerCase();

  // Step 2 — Reject any remaining internal whitespace (spaces, tabs, newlines).
  //           Scraper corruption often introduces a space adjacent to @.
  if (/\s/.test(email)) return false;

  // Step 3 — RFC 5321 total length: max 254 chars.
  if (email.length > 254) return false;

  // Step 4 — Structural check: exactly one @, not at position 0.
  const atIdx = email.indexOf("@");
  if (atIdx <= 0 || atIdx !== email.lastIndexOf("@")) return false;

  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  if (!local || !domain) return false;

  // Step 5 — RFC 5321 field lengths.
  if (local.length < 2 || local.length > 64) return false;
  if (domain.length > 253) return false;

  // Step 6 — Domain character allowlist: only a-z, 0-9, dot, hyphen.
  //           Catches URL artifacts: company.com?v=2, firm.com#footer, site.com/path
  if (!/^[a-z0-9.\-]+$/.test(domain)) return false;

  // Step 6b — No label may start or end with a hyphen.
  if (domain.split(".").some((lbl) => lbl.startsWith("-") || lbl.endsWith("-"))) return false;

  // Step 7 — Local-part character allowlist.
  //           Rejects quoted locals, /, =, %, ;, and other RFC-exotic chars
  //           that are technically valid but never appear in real inboxes.
  if (!VALID_LOCAL_CHARS_RE.test(local)) return false;

  // Step 8 — Reject consecutive dots and leading/trailing dots in local.
  if (local.includes("..") || local.startsWith(".") || local.endsWith(".")) return false;

  // Step 9 — Strip + alias BEFORE all content-based checks.
  //           uuid+prod@domain.com must be caught as a UUID, not pass because
  //           "+prod" makes the full local look non-UUID.
  const localBase = local.split("+")[0]!;

  // Step 10 — JS-bundle URL-encoded prefix artifact (u002f, u003e).
  if (URL_ENCODED_PREFIX_RE.test(localBase)) return false;

  // Step 11 — Hard-blocked system local parts.
  if (BLOCKED_LOCAL_PARTS.has(localBase)) return false;

  // Step 12 — Generic placeholder locals.
  if (PLACEHOLDER_LOCALS.has(localBase)) return false;

  // Step 13 — Hash / UUID detection. Runs AFTER alias strip (step 9).
  if (UUID_RE.test(localBase) || MD5_RE.test(localBase) || LONG_HEX_RE.test(localBase)) return false;

  // Step 14 — Digit-only and leading-digit artifacts.
  //            All-digit: "1234@company.com" — not a person.
  //            Leading 5+ digits: "248922hello@" — page-text concatenation.
  if (/^\d+$/.test(localBase) || LEADING_DIGITS_RE.test(localBase)) return false;

  // Step 15 — Placeholder / disposable domains.
  if (PLACEHOLDER_DOMAINS.has(domain)) return false;

  // Step 16 — Infrastructure / monitoring service domains (including subdomains).
  if (isInfrastructureDomain(domain)) return false;

  // Step 17 — PSL ICANN TLD validation via tldts.
  //            Catches concatenation artifacts (edu.sghomepreschoolabout),
  //            reserved TLDs (.local, .internal, .corp), and any unrecognised TLD.
  const parsed = parse(domain);
  if (parsed.isIcann !== true || parsed.domain === null) return false;

  return true;
}
