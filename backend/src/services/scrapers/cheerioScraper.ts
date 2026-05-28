import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { sourceRegistry } from "../../config/sourceRegistry";

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
  const response = await fetch(url);
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
    if (candidate && candidate.includes("@")) emails.add(candidate);
  });

  // 2) plain-text email patterns anywhere in the body
  const bodyText = $("body").text();
  for (const match of bodyText.matchAll(EMAIL_REGEX)) {
    emails.add(match[0].toLowerCase());
  }

  return Array.from(emails).map((email) => ({ company, email, website: url }));
}
