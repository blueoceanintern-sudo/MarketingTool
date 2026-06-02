import * as cheerio from "cheerio";
import { sourceRegistry } from "../../config/sourceRegistry";
import { isValidLeadEmail } from "./emailFilter";

export interface Lead {
  company?: string;
  email?: string;
  website: string;
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

export async function scrapeWebsite(
  url: string,
  source: keyof typeof sourceRegistry = "generic"
): Promise<Lead[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000); // 15s max
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

  const emails = new Set<string>();

  // 1) every mailto: link on the page
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const candidate = href.replace(/^mailto:/i, "").split("?")[0]?.trim().toLowerCase();
    if (candidate && candidate.includes("@") && isValidLeadEmail(candidate)) {
      emails.add(candidate);
    }
  });

  // 2) plain-text email patterns anywhere in the body
  const bodyText = $("body").text();
  for (const match of bodyText.matchAll(EMAIL_REGEX)) {
    const candidate = match[0].toLowerCase();
    if (isValidLeadEmail(candidate)) emails.add(candidate);
  }

  return Array.from(emails).map((email) => ({ company, email, website: url }));
}
