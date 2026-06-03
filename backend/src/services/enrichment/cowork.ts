import { launchBrowser } from "./browserDriver";
import { runBrowserAgent } from "./agent";
import type { EnrichmentInput, EnrichmentProvider, ProviderResult } from "./types";

// Cowork provider: Claude for Chrome browser agent. Drives a headless Chrome
// session via Playwright; Claude (Haiku 4.5) decides navigate/read/click steps
// and returns a structured ProviderResult matching PRD §5.4.
//
// Rate limit: min 2s between runs, hard daily cap from COWORK_DAILY_RUN_CAP.

const MIN_INTERVAL_MS = 2_000;
const DEFAULT_DAILY_CAP = 100;
const AGENT_TIMEOUT_MS = 60_000;

let lastRunAt = 0;
let dailyCount = 0;
let dailyWindowStart = startOfUtcDay();

const SYSTEM_PROMPT = `You are a B2B lead enrichment agent.

Given a partial lead record, fill only fields that are null, empty, or missing.

PROCESS

1. Identify missing fields.
2. Use provided company information and public sources to fill them.
3. Preserve all existing values exactly.
4. Return all valid contacts found.
5. Stop when no reliable information remains.

ALLOWED SOURCES

* Company website
* Team/About pages
* Contact pages
* Staff directories
* Press releases
* LinkedIn profiles
* LinkedIn company pages
* Professional biographies

RULES

* Never overwrite existing values.
* Never fabricate information.
* Only record information explicitly found in a source.
* Leave unresolved fields as null.
* Accuracy > completeness.

COMPANY MATCHING

Before enriching a contact, verify they belong to the target company.

Accept a contact only if at least one is true:

* Listed on the company website.
* Current employment shown on LinkedIn.
* Email domain matches the company domain.
* Biography explicitly links them to the company.
* Multiple sources confirm affiliation.

Do NOT match based solely on:

* Name similarity.
* Company name similarity.
* Search result ranking.

If multiple companies share the same or a similar name:

* Verify using company domain, LinkedIn company page, location, or industry.
* Reject ambiguous matches.

VALIDATION

* Prefer the most recent information available.
* Verify title, company, and contact details are consistent across sources.
* Ignore outdated employment information.

EMAILS

* Record only verified emails.
* Generate pattern_guessed emails only if a real email from the same domain establishes the format.

When you have enough information OR no further progress is possible, call the "finish" tool.
The "finish" result must use the same JSON schema as the input record, with missing fields filled where confidently verified.`;

interface AgentResult {
  institution?: Partial<{
    name: string;
    type: string;
    registration_id: string | null;
    size: "small" | "medium" | "large" | "unknown";
    website: string | null;
    region: "SG" | "AU" | "US";
  }>;
  contact?: Partial<{
    full_name: string | null;
    first_name: string | null;
    role: string | null;
    email: string | null;
    email_status: "verified" | "pattern_guessed" | "not_found";
  }>;
}

export const coworkProvider: EnrichmentProvider = {
  name: "cowork_claude",

  async enrich(input: EnrichmentInput): Promise<ProviderResult | null> {
    if (!shouldRun()) return null;
    await throttle();

    const driver = await launchBrowser();
    try {
      const task = buildTask(input);
      const { result } = await Promise.race([
        runBrowserAgent<AgentResult>({ driver, systemPrompt: SYSTEM_PROMPT, task }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("cowork browser agent timed out")), AGENT_TIMEOUT_MS)
        ),
      ]);
      if (!result) return null;

      return {
        source: "cowork_claude",
        institution: result.institution,
        contact: result.contact,
      };
    } finally {
      await driver.close();
    }
  },
};

function shouldRun(): boolean {
  rolloverDailyWindow();
  const cap = Number(process.env.COWORK_DAILY_RUN_CAP ?? DEFAULT_DAILY_CAP);
  if (dailyCount >= cap) {
    console.warn(`[cowork] daily cap reached (${cap}) — skipping enrichment`);
    return false;
  }
  dailyCount++;
  return true;
}

async function throttle(): Promise<void> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRunAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRunAt = Date.now();
}

function rolloverDailyWindow(): void {
  const today = startOfUtcDay();
  if (today !== dailyWindowStart) {
    dailyWindowStart = today;
    dailyCount = 0;
  }
}

function startOfUtcDay(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function buildRecord(input: EnrichmentInput): object {
  const { seed, market } = input;
  return {
    institution: {
      name: seed.companyName ?? null,
      type: null,
      registration_id: null,
      size: null,
      website: seed.companyWebsite ?? null,
      region: market,
    },
    contact: {
      full_name: [seed.firstName, seed.lastName].filter(Boolean).join(" ") || null,
      first_name: seed.firstName ?? null,
      role: seed.role ?? null,
      email: seed.email ?? null,
      email_status: seed.email ? "pattern_guessed" : null,
    },
    meta: {
      industry: seed.industry ?? null,
      market,
    },
  };
}

function buildTask(input: EnrichmentInput): string {
  const record = buildRecord(input);
  const websiteHint = input.seed.companyWebsite
    ? `Start by navigating to: ${input.seed.companyWebsite}\n\n`
    : "";
  const prompt = `${websiteHint}INPUT:\n${JSON.stringify(record, null, 2)}\n\nOUTPUT:\nReturn raw JSON only using the same schema, with missing fields filled where confidently verified.`;
  console.log(`[cowork] built task for lead ${input.leadId}`);
  return prompt;
}
