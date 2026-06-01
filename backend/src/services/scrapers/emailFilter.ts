import { parse } from "tldts";

// Blocked local parts — exact match against base local (before any + alias)
const BLOCKED_LOCAL_PARTS = new Set([
  "noreply", "no-reply", "no_reply", "mailer-daemon", "postmaster",
  "bounce", "bounces", "sentry", "bugsnag", "monitoring", "telemetry",
  "alerts", "alert", "notification", "notifications", "devnull", "daemon",
  "abuse", "donotreply", "do-not-reply", "do_not_reply",
  "automated", "feedback",
]);

// Generic placeholder local parts that are never real contacts
const PLACEHOLDER_LOCALS = new Set([
  "user", "email", "name", "firstname", "lastname", "your", "yourname", "youremail",
]);

// Placeholder and disposable email domains
const PLACEHOLDER_DOMAINS = new Set([
  "example.com", "example.org", "example.net",
  "domain.com", "test.com", "mailinator.com", "tempmail.com",
  "guerrillamail.com", "sharklasers.com", "throwam.com",
  "yopmail.com", "trashmail.com", "maildrop.cc", "dispostable.com",
  "fakeinbox.com", "spam4.me", "trashmail.io",
]);

// Infrastructure / monitoring / marketing automation service domains
// Any subdomain of these is also rejected
const INFRASTRUCTURE_DOMAINS = new Set([
  // Error tracking
  "sentry.io", "bugsnag.com", "honeybadger.io", "airbrake.io", "raygun.com", "rollbar.com",
  // Observability / APM
  "newrelic.com", "datadog.com", "loggly.com", "pingdom.com",
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
  // Misc platforms that embed tracking pixels / DSNs in page source
  "wixpress.com",
]);

// UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// MD5: exactly 32 hex chars
const MD5_RE = /^[0-9a-f]{32}$/i;
// Long hex string: 20+ hex chars, no dashes (Sentry DSN-style keys)
const LONG_HEX_RE = /^[0-9a-f]{20,}$/i;
// URL-encoded prefix from JS bundle extraction (u002f, u003e, etc.)
const URL_ENCODED_PREFIX_RE = /^u00[0-9a-f]{2}/i;
// Local part starts with 5+ consecutive digits (page-text concat artifact)
const LEADING_DIGITS_RE = /^\d{5,}/;

function isInfrastructureDomain(domain: string): boolean {
  for (const infra of INFRASTRUCTURE_DOMAINS) {
    if (domain === infra || domain.endsWith(`.${infra}`)) return true;
  }
  return false;
}

export function isValidLeadEmail(raw: string): boolean {
  const email = raw.trim().toLowerCase();

  const atIdx = email.indexOf("@");
  // Must have exactly one @, not at position 0
  if (atIdx <= 0 || atIdx !== email.lastIndexOf("@")) return false;

  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);

  if (!local || !domain) return false;

  // Strip + alias before local-part checks (e.g. user+tag@domain.com → user)
  const localBase = local.split("+")[0]!;

  // URL-encoded garbage (JS bundle artifacts: u002f, u003e, %)
  if (URL_ENCODED_PREFIX_RE.test(localBase) || localBase.includes("%")) return false;

  // Hard-rejected local parts
  if (BLOCKED_LOCAL_PARTS.has(localBase)) return false;

  // Generic placeholder locals
  if (PLACEHOLDER_LOCALS.has(localBase)) return false;

  // Hash / UUID patterns — always machine-generated, never a real contact
  if (UUID_RE.test(localBase) || MD5_RE.test(localBase) || LONG_HEX_RE.test(localBase)) return false;

  // Text-concatenation artifact: local starts with 5+ digits (e.g. "248922hello")
  if (LEADING_DIGITS_RE.test(localBase)) return false;

  // Placeholder / disposable domains
  if (PLACEHOLDER_DOMAINS.has(domain)) return false;

  // Infrastructure / monitoring service domains (including subdomains)
  if (isInfrastructureDomain(domain)) return false;

  // PSL-based TLD validation — rejects concatenated garbage like
  // edu.sghomepreschoolabout that no length check can reliably catch,
  // while correctly passing .technology, .consulting, .photography, etc.
  const parsed = parse(domain);
  if (parsed.isIcann !== true || parsed.domain === null) return false;

  return true;
}
