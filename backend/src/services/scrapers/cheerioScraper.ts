import * as cheerio from "cheerio";
import { isValidLeadEmail } from "./emailFilter";

export interface Lead {
  company?: string;
  email?: string;
  website: string;
  name?: string;
  role?: string;
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Expanded staff/contact page patterns — covers education, associations, government
const STAFF_PAGE_PATTERNS = [
  /\/staff/i, /\/team/i, /\/people/i, /\/leadership/i, /\/faculty/i,
  /\/our-people/i, /\/who-we-are/i, /\/management/i, /\/directory/i,
  /\/meet-the-team/i, /\/about\/people/i, /\/about\/team/i,
  /\/contact/i, /\/contacts/i, /\/our-staff/i, /\/our-team/i,
  /\/board/i, /\/governors/i, /\/trustees/i, /\/executives/i,
  /\/officers/i, /\/committee/i, /\/board-of-directors/i,
  /\/leadership-team/i, /\/management-team/i, /\/senior-leadership/i,
  /\/senior-team/i, /\/key-staff/i, /\/find-a-member/i, /\/members/i,
];

// Expanded role keywords — covers B2B decision-makers across all target verticals
const ROLE_KEYWORDS = [
  "director", "manager", "head", "principal", "dean", "coordinator",
  "officer", "president", "vice", "admissions", "registrar", "counsellor",
  "counselor", "adviser", "advisor", "administrator", "executive",
  "assistant", "associate", "superintendent", "provost",
  "ceo", "cfo", "cto", "coo", "founder", "co-founder", "partner",
  "chairman", "chair", "managing", "secretary", "treasurer",
  "principal", "controller", "general manager", "operations",
  "marketing", "business development", "head of", "vp", "vice president",
];

const PAGE_NAME_WORDS = new Set([
  "home", "contact", "about", "welcome", "us", "page", "news", "blog",
  "events", "gallery", "admissions", "index", "main", "site", "website",
]);

const INSTITUTION_WORDS = new Set([
  "school", "high", "college", "university", "institute", "institution",
  "department", "office", "academy", "centre", "center", "campus",
  "faculty", "foundation", "association", "polytechnic", "seminary",
]);

const ROLE_LOCAL_PARTS = new Set([
  "admissions", "principal", "rector", "registrar", "dean", "provost",
  "director", "headmaster", "bursar",
]);

// Many government/edu sites block requests without a real browser UA.
const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

export function cleanCompanyName($: cheerio.CheerioAPI): string | undefined {
  const ogSiteName = $('meta[property="og:site_name"]').attr("content")?.trim();
  if (ogSiteName) return ogSiteName;

  const appName = $('meta[name="application-name"]').attr("content")?.trim();
  if (appName) return appName;

  const title = $("title").first().text().trim();
  if (!title) return undefined;

  const parts = title.split(/\s*[|\-—–·]\s*/);
  if (parts.length < 2) return title;

  const meaningful = parts.filter((p) => {
    const words = p.trim().toLowerCase().split(/\s+/);
    return words.some((w) => !PAGE_NAME_WORDS.has(w));
  });

  if (meaningful.length === 0) return title;
  return meaningful.sort((a, b) => b.length - a.length)[0]!.trim();
}

function deriveRoleEmailName(local: string): string | null {
  const base = local.toLowerCase().split("+")[0] ?? "";
  if (!ROLE_LOCAL_PARTS.has(base)) return null;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// Derives a full name from separator-pattern email locals: john.smith → "John Smith"
function deriveNameFromEmailLocal(local: string): string | null {
  if (!/[._\-]/.test(local)) return null;
  const base = local.split("+")[0] ?? "";
  const segments = base.split(/[._\-]/);
  if (segments.length < 2 || segments.length > 3) return null;
  // Each segment must be purely alphabetic and at least 2 chars
  if (!segments.every((s) => /^[a-z]{2,15}$/.test(s))) return null;
  if (ROLE_LOCAL_PARTS.has(base)) return null;
  return segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: FETCH_HEADERS });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function findStaffPageLinks($: cheerio.CheerioAPI, baseUrl: string): string[] {
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

  return [...seen].slice(0, 5);
}

// Detects a "next page" link using rel="next", common text labels, and URL patterns.
function findNextPageLink($: cheerio.CheerioAPI, currentUrl: string): string | null {
  const base = new URL(currentUrl);

  const relNext = $('link[rel="next"], a[rel="next"]').first().attr("href");
  if (relNext) {
    try { return new URL(relNext, currentUrl).toString(); } catch { /* ignore */ }
  }

  const nextTextPatterns = [/^next$/i, /^›$/, /^»$/, /^→$/, /next page/i, /^>\s*$/];
  let found: string | null = null;

  $("a[href]").each((_, el) => {
    if (found) return;
    const $el = $(el);
    const href = $el.attr("href") ?? "";
    const text = $el.text().trim();
    const ariaLabel = $el.attr("aria-label") ?? "";
    const isNext = nextTextPatterns.some((p) => p.test(text) || p.test(ariaLabel));
    if (!isNext) return;
    try {
      const abs = new URL(href, currentUrl).toString();
      if (new URL(abs).hostname !== base.hostname) return;
      if (abs === currentUrl) return;
      found = abs;
    } catch { /* ignore */ }
  });

  return found;
}

function parseName(text: string): string | null {
  const cleaned = text.replace(/[^a-zA-Z\s\-'.]/g, "").trim();
  const words = cleaned.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length < 2 || words.length > 5) return null;
  if (words.some((w) => INSTITUTION_WORDS.has(w.toLowerCase()))) return null;
  return words.join(" ");
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

// Common legal/org suffixes — text containing these is likely a company name, not a person.
const COMPANY_SUFFIX_RE = /\b(pte\.?\s*ltd|pty\.?\s*ltd|limited|llc|l\.l\.c\.|inc\.?|incorporated|corporation|corp\.?|holdings|group|partners|associates|consultants|services|solutions|international|industries|ventures|enterprises|technologies|tech|co\.|sdn\.?\s*bhd)\b/i;

// Extracts a per-listing company name from a container element.
// For directory pages each row/card belongs to a different organisation — use this
// instead of the page-level company which is just the directory site's own name.
function extractCompanyFromContainer($: cheerio.CheerioAPI, $container: ReturnType<cheerio.CheerioAPI>): string | null {
  // Table rows: scan all sibling <td> cells for org-suffix text
  const $row = $container.is("tr") ? $container : $container.closest("tr");
  if ($row.length) {
    for (const cell of $row.find("td").toArray()) {
      const text = $(cell).text().trim().replace(/\s+/g, " ");
      if (text && !text.includes("@") && COMPANY_SUFFIX_RE.test(text) && text.length < 120) {
        return text;
      }
    }
  }

  // Div/li/article containers: scan lines for org-suffix text
  const lines = $container.text().split(/[\n\r|•·]/).map((l) => l.trim()).filter((l) => l.length > 3 && l.length < 120);
  for (const line of lines) {
    if (!line.includes("@") && COMPANY_SUFFIX_RE.test(line)) {
      return line.replace(/\s+/g, " ");
    }
  }

  return null;
}

// Tries multiple selectors to find a person name within a container element.
function extractNameFromContainer($: cheerio.CheerioAPI, $container: ReturnType<cheerio.CheerioAPI>): string | null {
  // Schema.org markup
  const schemeName = $container.find('[itemprop="name"]').first().text().trim();
  if (schemeName) {
    const p = parseName(schemeName);
    if (p) return p;
  }

  // Common CSS class patterns used by directory/listing sites
  const nameClasses = [".name", ".contact-name", ".staff-name", ".person-name",
    ".member-name", ".full-name", ".card-name", ".profile-name"];
  for (const cls of nameClasses) {
    const el = $container.find(cls).first().text().trim();
    if (el) {
      const p = parseName(el);
      if (p) return p;
    }
  }

  // Headings and bold text as fallback
  const heading = $container.find("h1,h2,h3,h4,h5,h6,strong,b").first().text().trim();
  if (heading && !heading.includes("@")) {
    return parseName(heading);
  }

  return null;
}

export function extractLeadsFromPage(
  $: cheerio.CheerioAPI,
  website: string,
  company?: string,
): Map<string, Lead> {
  const results = new Map<string, Lead>();

  // When the page company is a directory/aggregator site, the email domain is a
  // better company identifier than the page title (e.g. "cubes.co" > "City of Melbourne").
  const pageHost = (() => { try { return new URL(website).hostname; } catch { return ""; } })();
  function companyFromEmailDomain(email: string): string | undefined {
    if (!company) return undefined;
    const emailDomain = email.split("@")[1] ?? "";
    // If the email is on the same domain as the source page, the page company is fine.
    if (emailDomain === pageHost || emailDomain.endsWith(`.${pageHost}`)) return company;
    // Otherwise the email is from a different org — derive name from domain.
    const sld = emailDomain.split(".")[0] ?? "";
    return sld.length > 1 ? sld.charAt(0).toUpperCase() + sld.slice(1) : company;
  }

  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const emailRaw = href.replace(/^mailto:/i, "").split("?")[0]?.trim().toLowerCase() ?? "";
    if (!emailRaw || !isValidLeadEmail(emailRaw)) return;

    const lead: Lead = { email: emailRaw, website, company: companyFromEmailDomain(emailRaw) };
    const local = emailRaw.split("@")[0] ?? "";
    const roleName = deriveRoleEmailName(local);

    if (roleName) {
      lead.name = roleName;
    } else {
      const linkText = $(el).text().trim();
      if (linkText && !linkText.includes("@")) {
        const parsed = parseName(linkText);
        if (parsed) lead.name = parsed;
      }

      const $container = $(el).closest("div, li, article, section, td, tr, p");
      if ($container.length) {
        if (!lead.name) {
          lead.name = extractNameFromContainer($, $container) ?? undefined;
        }
        if (!lead.role) {
          lead.role = extractRole($container.text()) ?? undefined;
        }
        // On directory/membership pages, each listing belongs to a different company.
        // Override the page-level company with the per-listing org name if found.
        const listingCompany = extractCompanyFromContainer($, $container);
        if (listingCompany) lead.company = listingCompany;
      }

      // Last resort: derive name from separator-pattern email local (john.smith → "John Smith")
      if (!lead.name) {
        lead.name = deriveNameFromEmailLocal(local) ?? undefined;
      }
    }

    results.set(emailRaw, lead);
  });

  // Plain-text emails not captured via mailto — scan individual text nodes.
  // Scanning $("body").text() concatenates adjacent table cells without separators,
  // producing postcode/suburb-prefixed artifacts like "3006acmix@acmi.net.au".
  // Scanning each text node independently prevents cross-cell concatenation.
  $("body").find("*").addBack().contents().each((_, node) => {
    // nodeType 3 = TEXT_NODE
    if ((node as unknown as { type: string }).type !== "text") return;
    const text = (node as unknown as { data: string }).data ?? "";
    for (const match of text.matchAll(EMAIL_REGEX)) {
      const emailRaw = match[0].toLowerCase();
      if (!isValidLeadEmail(emailRaw) || results.has(emailRaw)) continue;

      const lead: Lead = { email: emailRaw, website, company: companyFromEmailDomain(emailRaw) };
      const local = emailRaw.split("@")[0] ?? "";

      const roleName = deriveRoleEmailName(local);
      if (roleName) {
        lead.name = roleName;
      } else {
        lead.name = deriveNameFromEmailLocal(local) ?? undefined;
      }

      results.set(emailRaw, lead);
    }
  });

  return results;
}

export async function scrapeWebsite(url: string): Promise<Lead[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal, headers: FETCH_HEADERS });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Failed to fetch: ${url}`);

  const html = await response.text();
  const $ = cheerio.load(html);
  const company = cleanCompanyName($);
  const allLeads = extractLeadsFromPage($, url, company);

  // Discover and scrape staff/team pages on the same domain (up to 5)
  const staffLinks = findStaffPageLinks($, url);
  for (const staffUrl of staffLinks) {
    const staffHtml = await fetchPage(staffUrl);
    if (!staffHtml) continue;
    const $staff = cheerio.load(staffHtml);
    for (const [email, lead] of extractLeadsFromPage($staff, url, company)) {
      if (!allLeads.has(email)) allLeads.set(email, lead);
    }
  }

  // Follow pagination on the main page (up to 3 additional pages)
  let pageUrl = findNextPageLink($, url);
  let pageCount = 0;
  while (pageUrl && pageCount < 5) {
    const pageHtml = await fetchPage(pageUrl);
    if (!pageHtml) break;
    const $page = cheerio.load(pageHtml);
    for (const [email, lead] of extractLeadsFromPage($page, url, company)) {
      if (!allLeads.has(email)) allLeads.set(email, lead);
    }
    pageUrl = findNextPageLink($page, pageUrl);
    pageCount++;
  }

  return Array.from(allLeads.values());
}
