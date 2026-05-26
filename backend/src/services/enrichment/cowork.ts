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

let lastRunAt = 0;
let dailyCount = 0;
let dailyWindowStart = startOfUtcDay();

const SYSTEM_PROMPT = `You are a B2B research agent. Your job is to extract publicly listed
institution and contact information from official websites and public registries.

Rules:
- Only use information you can directly read on the page. Never fabricate fields.
- Prefer official sources: the institution's own .edu / .gov / corporate site.
- Never collect personal social profiles, private data, or anything behind login.
- When you have enough information OR no further progress is possible, call the "finish" tool.
- The "finish" result must match this exact shape:
  {
    "institution": {
      "name": string,
      "type": string,           // e.g. "private_school", "university", "training_provider", "unknown"
      "registration_id": string | null,
      "size": "small" | "medium" | "large" | "unknown",
      "website": string | null,
      "region": "SG" | "AU" | "US"
    },
    "contact": {
      "full_name": string | null,
      "first_name": string | null,
      "role": string | null,
      "email": string | null,
      "email_status": "verified" | "pattern_guessed" | "not_found"
    }
  }
- email_status = "verified" only when the email is explicitly listed on an official page.
- email_status = "pattern_guessed" when you inferred it from a domain pattern.
- email_status = "not_found" when no email could be located.`;

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
      const { result } = await runBrowserAgent<AgentResult>({
        driver,
        systemPrompt: SYSTEM_PROMPT,
        task,
      });
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

function buildTask(input: EnrichmentInput): string {
  const { seed, market } = input;
  return `Find institution and contact details for this organisation.

Target:
- Company / institution name: ${seed.companyName}
- Industry: ${seed.industry ?? "unknown"}
- Market / region: ${market}
- Existing contact name: ${[seed.firstName, seed.lastName].filter(Boolean).join(" ") || "unknown"}
- Existing role: ${seed.role ?? "unknown"}
- Existing email: ${seed.email ?? "unknown"}
- Known website: ${seed.companyWebsite ?? "unknown"}

Start by navigating to the most likely official site or public registry for this institution in ${market}.
Once you have enough fields, call "finish" with the structured result.`;
}
