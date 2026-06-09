import * as cheerio from "cheerio";
import { sourceRegistry } from "../../config/sourceRegistry";
import { isValidLeadEmail } from "./emailFilter";

export interface Lead {
  company?: string;
  email?: string;
  website: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const STAFF_PAGE_PATTERNS = [
  /\/staff/i, /\/team/i, /\/people/i, /\/leadership/i, /\/faculty/i,
  /\/our-people/i, /\/who-we-are/i, /\/management/i, /\/directory/i,
  /\/meet-the-team/i, /\/about\/people/i, /\/about\/team/i,
];

const ROLE_KEYWORDS = [
  "director", "manager", "head", "principal", "dean", "coordinator",
  "officer", "president", "vice", "admissions", "registrar", "counsellor",
  "counselor", "adviser", "advisor", "administrator", "executive",
  "assistant", "associate", "superintendent", "provost",
];

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function findStaffPageLinks($: cheerio.CheerioAPI, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href) return;
    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    try {
      if (new URL(absolute).hostname !== base.hostname) return;
    } catch {
      return;
    }
    if (STAFF_PAGE_PATTERNS.some((p) => p.test(absolute))) seen.add(absolute);
  });

  return [...seen].slice(0, 3);
}

function parseName(text: string): { firstName: string; lastName: string } | null {
  const cleaned = text.replace(/[^a-zA-Z\s\-'.]/g, "").trim();
  const words = cleaned.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length < 2 || words.length > 4) return null;
  return { firstName: words[0]!, lastName: words.slice(1).join(" ") };
}

function extractRole(text: string): string | null {
  const lines = text.split(/[\n,|•·–—]/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (ROLE_KEYWORDS.some((kw) => lower.includes(kw)) && line.length < 80) {
      return line;
    }
  }
  return null;
}

function extractLeadsFromPage(
  $: cheerio.CheerioAPI,
  website: string,
  company?: string,
): Map<string, Lead> {
  const results = new Map<string, Lead>();

  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const emailRaw = href.replace(/^mailto:/i, "").split("?")[0]?.trim().toLowerCase() ?? "";
    if (!emailRaw || !isValidLeadEmail(emailRaw)) return;

    const lead: Lead = { email: emailRaw, website, company };

    // If the link text is a name (not the email itself), use it
    const linkText = $(el).text().trim();
    if (linkText && !linkText.includes("@")) {
      const parsed = parseName(linkText);
      if (parsed) {
        lead.firstName = parsed.firstName;
        lead.lastName = parsed.lastName;
      }
    }

    // Look in nearest container for name heading + role
    const $container = $(el).closest("div, li, article, section, td, tr, p");
    if ($container.length) {
      if (!lead.firstName) {
        const heading = $container.find("h1,h2,h3,h4,h5,h6,strong,b").first().text().trim();
        if (heading && !heading.includes("@")) {
          const parsed = parseName(heading);
          if (parsed) {
            lead.firstName = parsed.firstName;
            lead.lastName = parsed.lastName;
          }
        }
      }
      if (!lead.role) {
        lead.role = extractRole($container.text()) ?? undefined;
      }
    }

    results.set(emailRaw, lead);
  });

  // Plain-text emails not already captured via mailto
  const bodyText = $("body").text();
  for (const match of bodyText.matchAll(EMAIL_REGEX)) {
    const emailRaw = match[0].toLowerCase();
    if (!isValidLeadEmail(emailRaw) || results.has(emailRaw)) continue;
    results.set(emailRaw, { email: emailRaw, website, company });
  }

  return results;
}

export async function scrapeWebsite(
  url: string,
  source: keyof typeof sourceRegistry = "generic"
): Promise<Lead[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Failed to fetch: ${url}`);

  const html = await response.text();
  const $ = cheerio.load(html);

  const selectors = sourceRegistry[source];
  const company = $(selectors.company).first().text().trim() || undefined;

  const allLeads = extractLeadsFromPage($, url, company);

  // Discover and scrape staff/team pages on the same domain
  const staffLinks = findStaffPageLinks($, url);
  for (const staffUrl of staffLinks) {
    const staffHtml = await fetchPage(staffUrl);
    if (!staffHtml) continue;
    const $staff = cheerio.load(staffHtml);
    for (const [email, lead] of extractLeadsFromPage($staff, url, company)) {
      if (!allLeads.has(email)) allLeads.set(email, lead);
    }
  }

  return Array.from(allLeads.values());
}
