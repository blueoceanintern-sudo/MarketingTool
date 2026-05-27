import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

// Thin Playwright wrapper exposing only the actions the Cowork agent uses.
// Swap implementation (Puppeteer, hosted browser service) by replacing this file
// — the contract is the BrowserDriver interface.

export interface BrowserDriver {
  navigate(url: string): Promise<void>;
  currentUrl(): string;
  readPage(): Promise<string>;
  clickText(text: string): Promise<boolean>;
  close(): Promise<void>;
}

const MAX_PAGE_TEXT_CHARS = 20_000;
const NAV_TIMEOUT_MS = 15_000;
const ACTION_TIMEOUT_MS = 5_000;

class PlaywrightDriver implements BrowserDriver {
  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {}

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  }

  currentUrl(): string {
    return this.page.url();
  }

  async readPage(): Promise<string> {
    // evaluate runs in the browser context; types from this file's TS lib aren't
    // available there, so we use a string body to avoid pulling in `dom` lib here.
    const text = await this.page.evaluate("document.body ? document.body.innerText : ''") as string;
    return text.replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_TEXT_CHARS);
  }

  async clickText(text: string): Promise<boolean> {
    const locator = this.page.getByText(text, { exact: false }).first();
    try {
      await locator.click({ timeout: ACTION_TIMEOUT_MS });
      await this.page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT_MS }).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
  }
}

export async function launchBrowser(): Promise<BrowserDriver> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  return new PlaywrightDriver(browser, context, page);
}
