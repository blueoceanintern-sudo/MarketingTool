import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '../db/schema';
import crawl4aiConfig from '../config/crawl4ai.config';
import ScrapeRouter from './scrape-router';
import axios, { AxiosError } from 'axios';

type ScrapeJobStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

interface ScrapeRequest {
  urls: string[];
  timeout?: number;
}

interface ScrapeResponse {
  url: string;
  markdown: string;
  status: number;
  timestamp: string;
}

export class ScraperService {
  private db: ReturnType<typeof drizzle>;
  private client: ReturnType<typeof postgres>;
  private router: ScrapeRouter;
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(databaseUrl: string) {
    this.client = postgres(databaseUrl);
    this.db = drizzle(this.client, { schema });
    this.router = new ScrapeRouter(databaseUrl);
  }

  /**
   * Trigger scraping for a campaign
   * Called when campaign is created
   * Routes to appropriate scrapers based on registry config
   */
  async triggerScrapeJob(
    campaignId: string,
    vertical: string,
    geo: string
  ): Promise<string> {
    try {
      console.log(
        `[ScrapeJob] Triggering for campaign ${campaignId} (vertical: ${vertical}, geo: ${geo})`
      );

      // Query registry to get configured sources for this vertical/geo
      const routing = await this.router.routeScrapingSources(vertical, geo);

      if (routing.sources.length === 0) {
        throw new Error(
          `No configured sources found for vertical=${vertical}, geo=${geo}`
        );
      }

      // Create scrape job record
      const [job] = await this.db
        .insert(schema.scrapeJobs)
        .values({
          campaignId,
          status: 'pending',
          maxRetries: crawl4aiConfig.maxRetries,
        })
        .returning();

      console.log(
        `[ScrapeJob ${job.id}] Created for campaign ${campaignId}. Found ${routing.sources.length} sources`
      );

      // Extract URLs from routing results
      const urls = routing.sources.map((source) => source.url);

      // Queue the scrape job (non-blocking)
      this.queueScrapeJob(job.id, campaignId, urls, routing);

      return job.id;
    } catch (error) {
      console.error('Error creating scrape job:', error);
      throw error;
    }
  }

  /**
   * Queue job with rate limiting
   */
  private queueScrapeJob(
    jobId: string,
    campaignId: string,
    urls: string[],
    routing?: any
  ) {
    this.requestQueue = this.requestQueue.then(() =>
      this.executeScrapeJob(jobId, campaignId, urls, routing)
    );
  }

  /**
   * Execute scrape with retry logic
   * Routes to appropriate scrapers (Crawl4AI for JS sites, Cheerio for static)
   */
  private async executeScrapeJob(
    jobId: string,
    campaignId: string,
    urls: string[],
    routing?: any
  ) {
    let retryCount = 0;

    while (retryCount <= crawl4aiConfig.maxRetries) {
      try {
        // Log routing strategy
        if (routing) {
          console.log(
            `[ScrapeJob ${jobId}] Scraper routing: Crawl4AI=${routing.scraperGroups.crawl4ai.length}, Cheerio=${routing.scraperGroups.cheerio.length}`
          );
        }

        // Update job status to in_progress
        await this.db
          .update(schema.scrapeJobs)
          .set({
            status: 'in_progress',
            startedAt: new Date(),
            retryCount,
            updatedAt: new Date(),
          })
          .where(eq(schema.scrapeJobs.id, jobId));

        console.log(
          `[ScrapeJob ${jobId}] Starting (attempt ${retryCount + 1}/${
            crawl4aiConfig.maxRetries + 1
          })`
        );

        // Scrape URLs
        const results = await this.scrapeUrls(urls);

        // Parse markdown and extract leads
        const leads = await this.parseAndExtractLeads(results);

        // Update job status to completed
        await this.db
          .update(schema.scrapeJobs)
          .set({
            status: 'completed',
            leadsScraped: leads.length,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.scrapeJobs.id, jobId));

        console.log(
          `[ScrapeJob ${jobId}] Completed. Scraped ${leads.length} leads`
        );

        return { success: true, leads, jobId };
      } catch (error) {
        retryCount++;

        if (retryCount > crawl4aiConfig.maxRetries) {
          // Max retries exceeded, mark as failed
          const errorMessage = error instanceof Error ? error.message : String(error);

          await this.db
            .update(schema.scrapeJobs)
            .set({
              status: 'failed',
              errorMessage,
              retryCount,
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(schema.scrapeJobs.id, jobId));

          console.error(
            `[ScrapeJob ${jobId}] Failed after ${retryCount} retries: ${errorMessage}`
          );

          throw error;
        }

        // Calculate backoff delay
        const delay = this.calculateBackoffDelay(retryCount);
        console.warn(
          `[ScrapeJob ${jobId}] Attempt ${retryCount} failed. Retrying in ${delay}ms...`
        );

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Call Crawl4AI service to scrape URLs
   */
  private async scrapeUrls(urls: string[]): Promise<ScrapeResponse[]> {
    try {
      const response = await axios.post<ScrapeResponse[]>(
        `${crawl4aiConfig.baseUrl}/scrape`,
        { urls, timeout: crawl4aiConfig.timeout } as ScrapeRequest,
        { timeout: crawl4aiConfig.timeout + 5000 } // Add 5s buffer
      );

      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;

      if (axiosError.code === 'ECONNREFUSED') {
        throw new Error('Crawl4AI service is not running');
      }

      if (axiosError.response?.status === 504) {
        throw new Error('Crawl4AI request timeout');
      }

      throw error;
    }
  }

  /**
   * Parse markdown and extract lead data
   * (placeholder - implement lead extraction logic)
   */
  private async parseAndExtractLeads(
    results: ScrapeResponse[]
  ): Promise<any[]> {
    // TODO: Implement markdown parsing and lead extraction
    // For now, return empty array
    console.log(`Parsing markdown from ${results.length} scraped pages`);
    return [];
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(retryCount: number): number {
    const baseDelay = crawl4aiConfig.retryDelay;
    const maxDelay = 60000; // 60 seconds max

    const delay =
      baseDelay * Math.pow(crawl4aiConfig.backoffMultiplier, retryCount - 1);
    return Math.min(delay, maxDelay);
  }

  /**
   * Get scrape job status
   */
  async getJobStatus(jobId: string) {
    const [job] = await this.db
      .select()
      .from(schema.scrapeJobs)
      .where(eq(schema.scrapeJobs.id, jobId));

    return job || null;
  }

  /**
   * Close database connection
   */
  async close() {
    await this.client.end();
  }
}

export default ScraperService;
