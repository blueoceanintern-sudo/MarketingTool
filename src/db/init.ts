import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

async function initializeDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  try {
    console.log('🔄 Connecting to PostgreSQL...');
    const client = postgres(databaseUrl);
    const db = drizzle(client, { schema });

    console.log('📦 Creating tables...');

    // Create enums
    await client`
      CREATE TYPE IF NOT EXISTS company_size AS ENUM ('SMB', 'Mid-Market', 'Enterprise');
      CREATE TYPE IF NOT EXISTS lead_status AS ENUM ('scraped', 'enriched', 'emailed', 'replied');
      CREATE TYPE IF NOT EXISTS campaign_status AS ENUM ('active', 'paused', 'completed');
      CREATE TYPE IF NOT EXISTS persona AS ENUM ('Technical', 'Executive', 'Ops');
      CREATE TYPE IF NOT EXISTS draft_status AS ENUM ('pending_review', 'approved', 'rejected', 'sent');
      CREATE TYPE IF NOT EXISTS sentiment AS ENUM ('positive', 'neutral', 'negative');
      CREATE TYPE IF NOT EXISTS flag_type AS ENUM ('duplicate', 'unverified_email', 'missing_fields', 'sensitive_keywords', 'hostile', 'regulated_entity');
      CREATE TYPE IF NOT EXISTS scrape_job_status AS ENUM ('pending', 'in_progress', 'completed', 'failed');
      CREATE TYPE IF NOT EXISTS scraper_type AS ENUM ('crawl4ai', 'cheerio');
    `;

    // Create tables
    await client`
      CREATE TABLE IF NOT EXISTS companies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        industry VARCHAR(100),
        company_size company_size,
        location VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id),
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        email VARCHAR(255) NOT NULL UNIQUE,
        role VARCHAR(100),
        is_verified BOOLEAN DEFAULT FALSE,
        status lead_status DEFAULT 'scraped',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        vertical VARCHAR(100),
        geography VARCHAR(100),
        company_size_target VARCHAR(100),
        status campaign_status DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS email_drafts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id UUID NOT NULL REFERENCES leads(id),
        campaign_id UUID NOT NULL REFERENCES campaigns(id),
        persona persona NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        confidence_score NUMERIC(3, 1),
        status draft_status DEFAULT 'pending_review',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS email_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        draft_id UUID REFERENCES email_drafts(id),
        lead_id UUID NOT NULL REFERENCES leads(id),
        sent_at TIMESTAMP,
        opened_at TIMESTAMP,
        replied_at TIMESTAMP,
        unsubscribed_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS replies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email_event_id UUID NOT NULL REFERENCES email_events(id),
        body TEXT NOT NULL,
        sentiment sentiment,
        category VARCHAR(100),
        received_at TIMESTAMP NOT NULL
      );

      CREATE TABLE IF NOT EXISTS risk_flags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id UUID NOT NULL REFERENCES leads(id),
        flag_type flag_type NOT NULL,
        flagged_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS template_performance (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id UUID NOT NULL REFERENCES campaigns(id),
        persona persona NOT NULL,
        open_rate NUMERIC(5, 2),
        reply_rate NUMERIC(5, 2),
        last_calculated_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS source_registry (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        vertical VARCHAR(100) NOT NULL,
        geo VARCHAR(100) NOT NULL,
        url VARCHAR(500) NOT NULL UNIQUE,
        scraper_type scraper_type NOT NULL,
        legal_flag BOOLEAN DEFAULT TRUE NOT NULL,
        selectors TEXT NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scrape_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id UUID NOT NULL REFERENCES campaigns(id),
        status scrape_job_status DEFAULT 'pending',
        leads_scraped NUMERIC(10, 0) DEFAULT 0,
        error_message TEXT,
        retry_count NUMERIC(3, 0) DEFAULT 0,
        max_retries NUMERIC(3, 0) DEFAULT 3,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `;

    // Create indexes for common queries
    await client`
      CREATE INDEX IF NOT EXISTS idx_leads_company_id ON leads(company_id);
      CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
      CREATE INDEX IF NOT EXISTS idx_email_drafts_lead_id ON email_drafts(lead_id);
      CREATE INDEX IF NOT EXISTS idx_email_drafts_campaign_id ON email_drafts(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_email_events_lead_id ON email_events(lead_id);
      CREATE INDEX IF NOT EXISTS idx_email_events_draft_id ON email_events(draft_id);
      CREATE INDEX IF NOT EXISTS idx_replies_email_event_id ON replies(email_event_id);
      CREATE INDEX IF NOT EXISTS idx_risk_flags_lead_id ON risk_flags(lead_id);
      CREATE INDEX IF NOT EXISTS idx_template_perf_campaign_id ON template_performance(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_scrape_jobs_campaign_id ON scrape_jobs(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status ON scrape_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_source_registry_vertical_geo ON source_registry(vertical, geo);
      CREATE INDEX IF NOT EXISTS idx_source_registry_scraper_type ON source_registry(scraper_type);
    `;

    console.log('✅ Database initialized successfully!');

    // Seed 3 pre-configured sources
    console.log('🌱 Seeding pre-configured sources...');

    const sources = [
      {
        name: 'ACRA Singapore',
        vertical: 'Business Registry',
        geo: 'SG',
        url: 'https://acra.gov.sg',
        scraperType: 'crawl4ai',
        legalFlag: true,
        selectors: JSON.stringify({
          company: '.company-name',
          director: '.director-info',
          address: '.registered-address',
          status: '.company-status',
        }),
      },
      {
        name: 'ASIC Australia',
        vertical: 'Business Registry',
        geo: 'AU',
        url: 'https://asic.gov.au',
        scraperType: 'crawl4ai',
        legalFlag: true,
        selectors: JSON.stringify({
          company: 'h1.entity-name',
          abn: '.abn-number',
          address: 'address.principal-address',
          status: '.acn-status',
        }),
      },
      {
        name: 'SEC EDGAR USA',
        vertical: 'Financial Filings',
        geo: 'US',
        url: 'https://www.sec.gov/cgi-bin/browse-edgar',
        scraperType: 'cheerio',
        legalFlag: true,
        selectors: JSON.stringify({
          company: 'td:contains("Company Name")',
          cik: 'a.cik',
          filing: 'td.left a',
          date: 'td.small',
        }),
      },
    ];

    for (const source of sources) {
      await client`
        INSERT INTO source_registry (name, vertical, geo, url, scraper_type, legal_flag, selectors, active)
        VALUES (${source.name}, ${source.vertical}, ${source.geo}, ${source.url}, ${source.scraperType}, ${source.legalFlag}, ${source.selectors}, true)
        ON CONFLICT (url) DO NOTHING;
      `;
    }

    console.log('✅ Pre-configured sources seeded!');
    await client.end();
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

initializeDatabase();
