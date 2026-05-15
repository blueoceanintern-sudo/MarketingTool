import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { sourceRegistry } from "../../config/sourceRegistry";

export interface Lead {
  company?: string;
  email?: string;
  website: string;
}

export async function scrapeWebsite(
  url: string,
  source: keyof typeof sourceRegistry = "generic"
): Promise<Lead> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${url}`);
  }

  const html = await response.text();

  const $ = cheerio.load(html);

  const selectors = sourceRegistry[source];

  const company =
    $(selectors.company).first().text().trim() || undefined;

  const email =
    $(selectors.email).first().attr("href")?.replace("mailto:", "") ||
    undefined;

  return {
    company,
    email,
    website: url,
  };
}