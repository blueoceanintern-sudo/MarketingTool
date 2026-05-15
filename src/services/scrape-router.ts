import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '../db/schema';

export interface SourceConfig {
  id: string;
  name: string;
  vertical: string;
  geo: string;
  url: string;
  scraperType: 'crawl4ai' | 'cheerio';
  legalFlag: boolean;
  selectors: Record<string, string>;
}

export interface RoutingResult {
  sources: SourceConfig[];
  scraperGroups: {
    crawl4ai: SourceConfig[];
    cheerio: SourceConfig[];
  };
}

export class ScrapeRouter {
  private db: ReturnType<typeof drizzle>;
  private client: ReturnType<typeof postgres>;

  constructor(databaseUrl: string) {
    this.client = postgres(databaseUrl);
    this.db = drizzle(this.client, { schema });
  }

  /**
   * Query registry and route sources based on campaign vertical & geo
   * Returns sources grouped by scraper type for parallel execution
   */
  async routeScrapingSources(
    vertical: string,
    geo: string
  ): Promise<RoutingResult> {
    try {
      console.log(
        `[ScrapeRouter] Routing sources for vertical=${vertical}, geo=${geo}`
      );

      // Query registry for matching sources
      const sources = await this.db
        .select()
        .from(schema.sourceRegistry)
        .where(
          and(
            eq(schema.sourceRegistry.vertical, vertical),
            eq(schema.sourceRegistry.geo, geo),
            eq(schema.sourceRegistry.active, true),
            eq(schema.sourceRegistry.legalFlag, true) // Only legal sources
          )
        );

      if (sources.length === 0) {
        console.warn(
          `[ScrapeRouter] No sources found for vertical=${vertical}, geo=${geo}`
        );
        return {
          sources: [],
          scraperGroups: {
            crawl4ai: [],
            cheerio: [],
          },
        };
      }

      console.log(
        `[ScrapeRouter] Found ${sources.length} sources matching criteria`
      );

      // Parse selectors JSON and group by scraper type
      const parsedSources: SourceConfig[] = sources.map((source) => ({
        id: source.id,
        name: source.name,
        vertical: source.vertical,
        geo: source.geo,
        url: source.url,
        scraperType: source.scraperType as 'crawl4ai' | 'cheerio',
        legalFlag: source.legalFlag,
        selectors: JSON.parse(source.selectors),
      }));

      const crawl4aiSources = parsedSources.filter(
        (s) => s.scraperType === 'crawl4ai'
      );
      const cheerioSources = parsedSources.filter(
        (s) => s.scraperType === 'cheerio'
      );

      console.log(
        `[ScrapeRouter] Crawl4AI: ${crawl4aiSources.length}, Cheerio: ${cheerioSources.length}`
      );

      return {
        sources: parsedSources,
        scraperGroups: {
          crawl4ai: crawl4aiSources,
          cheerio: cheerioSources,
        },
      };
    } catch (error) {
      console.error('[ScrapeRouter] Error routing sources:', error);
      throw error;
    }
  }

  /**
   * Get a specific source by ID
   */
  async getSourceById(sourceId: string): Promise<SourceConfig | null> {
    const source = await this.db
      .select()
      .from(schema.sourceRegistry)
      .where(eq(schema.sourceRegistry.id, sourceId));

    if (!source.length) return null;

    return {
      id: source[0].id,
      name: source[0].name,
      vertical: source[0].vertical,
      geo: source[0].geo,
      url: source[0].url,
      scraperType: source[0].scraperType as 'crawl4ai' | 'cheerio',
      legalFlag: source[0].legalFlag,
      selectors: JSON.parse(source[0].selectors),
    };
  }

  /**
   * Check if source is legal before scraping
   */
  async isSourceLegal(sourceId: string): Promise<boolean> {
    const source = await this.getSourceById(sourceId);
    return source ? source.legalFlag : false;
  }

  /**
   * Get all available sources (for admin/config)
   */
  async getAllSources(): Promise<SourceConfig[]> {
    const sources = await this.db
      .select()
      .from(schema.sourceRegistry)
      .where(eq(schema.sourceRegistry.active, true));

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      vertical: source.vertical,
      geo: source.geo,
      url: source.url,
      scraperType: source.scraperType as 'crawl4ai' | 'cheerio',
      legalFlag: source.legalFlag,
      selectors: JSON.parse(source.selectors),
    }));
  }

  /**
   * Close database connection
   */
  async close() {
    await this.client.end();
  }
}

export default ScrapeRouter;
