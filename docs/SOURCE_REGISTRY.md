# Source Registry & Scrape Routing

## Overview

The Source Registry is a configuration database that stores details about each scraping source. When a campaign is created, the backend automatically queries this registry to determine which sources to scrape and which scraper to use—no manual setup required.

## Registry Table Structure

```sql
source_registry (
  id UUID,
  name VARCHAR(255),
  vertical VARCHAR(100),        -- Industry (e.g., "Business Registry")
  geo VARCHAR(100),              -- Geography (e.g., "SG", "AU", "US")
  url VARCHAR(500),              -- Source URL
  scraper_type ENUM,             -- "crawl4ai" or "cheerio"
  legal_flag BOOLEAN,            -- Is scraping legally permitted?
  selectors TEXT,                -- JSON with CSS selectors for extraction
  active BOOLEAN,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

## Columns Explained

### vertical
The industry or data category the source belongs to.
- Examples: "Business Registry", "Financial Filings", "Property Records"

### geo
Geographic location code for the source.
- Codes: "SG" (Singapore), "AU" (Australia), "US" (United States)

### url
The website URL to scrape.
- Example: `https://acra.gov.sg`

### scraper_type
Determines which scraper tool is used:
- **crawl4ai**: For dynamic JavaScript-heavy sites that require browser automation
- **cheerio**: For static HTML sites with simple structure

### legal_flag
Boolean check before scraping begins.
- `true`: Scraping is legally permitted (scraped in this jurisdiction)
- `false`: Scraping prohibited (source disabled, data inaccessible)
- Checked during campaign creation; sources with `legal_flag=false` are skipped

### selectors
JSON object containing CSS selectors for extracting data from the source.

```json
{
  "company": ".company-name",
  "director": ".director-info",
  "address": ".registered-address",
  "status": ".company-status"
}
```

## Pre-configured Sources

3 sources come pre-seeded in the database:

### 1. ACRA Singapore
```
Name: ACRA Singapore
Vertical: Business Registry
Geo: SG
URL: https://acra.gov.sg
Scraper Type: crawl4ai (JS-heavy site)
Legal Flag: true (permitted in SG)
```

### 2. ASIC Australia
```
Name: ASIC Australia
Vertical: Business Registry
Geo: AU
URL: https://asic.gov.au
Scraper Type: crawl4ai (JS-heavy site)
Legal Flag: true (permitted in AU)
```

### 3. SEC EDGAR USA
```
Name: SEC EDGAR USA
Vertical: Financial Filings
Geo: US
URL: https://www.sec.gov/cgi-bin/browse-edgar
Scraper Type: cheerio (static HTML)
Legal Flag: true (public data, legal to scrape)
```

## Scrape Routing Flow

```
Campaign Created
    ↓
Backend queries: SELECT * FROM source_registry 
    WHERE vertical = campaign.vertical 
    AND geo = campaign.geo 
    AND active = true 
    AND legal_flag = true
    ↓
Router groups sources by scraper type:
    ├─ Crawl4AI sources → [async scraping pool 1]
    └─ Cheerio sources  → [async scraping pool 2]
    ↓
Scraper executes with appropriate tool
    ↓
CSS selectors extract structured data
    ↓
Parsed data stored in leads table
```

## Usage

### Trigger Scraping for a Campaign

```typescript
import ScraperService from '@/services/scraper';
import ScrapeRouter from '@/services/scrape-router';

const scraper = new ScraperService(process.env.DATABASE_URL!);
const router = new ScrapeRouter(process.env.DATABASE_URL!);

// When campaign is created:
const campaignVertical = 'Business Registry';
const campaignGeo = 'SG';

// Trigger scraping (automatically routes to configured sources)
const jobId = await scraper.triggerScrapeJob(
  campaignId,
  campaignVertical,
  campaignGeo
);

// Check routing details
const routing = await router.routeScrapingSources(campaignVertical, campaignGeo);
console.log(`Found ${routing.sources.length} sources`);
console.log(`Crawl4AI: ${routing.scraperGroups.crawl4ai.length}`);
console.log(`Cheerio: ${routing.scraperGroups.cheerio.length}`);
```

### Query Registry Manually

```typescript
const router = new ScrapeRouter(process.env.DATABASE_URL!);

// Get all sources for a vertical/geo combo
const routing = await router.routeScrapingSources('Business Registry', 'SG');

// Get specific source
const source = await router.getSourceById(sourceId);

// Check if source is legal
const isLegal = await router.isSourceLegal(sourceId);

// Get all active sources
const allSources = await router.getAllSources();
```

## Adding New Sources

To add a new source to the registry (e.g., for a new vertical or geography):

```typescript
import postgres from 'postgres';

const client = postgres(process.env.DATABASE_URL!);

await client`
  INSERT INTO source_registry 
  (name, vertical, geo, url, scraper_type, legal_flag, selectors, active)
  VALUES (
    'Hong Kong Companies Registry',
    'Business Registry',
    'HK',
    'https://www.cr.gov.hk',
    'crawl4ai',
    true,
    ${JSON.stringify({
      company: '.company-name',
      registration: '.reg-number',
      status: '.company-status'
    })},
    true
  )
`;
```

## Disabling Sources

To disable a source without deleting it:

```typescript
await client`
  UPDATE source_registry 
  SET active = false, legal_flag = false
  WHERE id = ${sourceId}
`;
```

## CSS Selectors Guide

Selectors vary by source structure. Use browser DevTools to inspect:

1. Open source website in browser
2. Right-click on target data → Inspect
3. Copy the CSS selector or class name
4. Add to selectors JSON

Example:
```html
<!-- ACRA HTML -->
<div class="company-name">ABC Trading Pte Ltd</div>
<div class="director-info">John Doe</div>

<!-- Selectors -->
{
  "company": ".company-name",
  "director": ".director-info"
}
```

## Performance Notes

- **Indexes**: Queries optimized on `(vertical, geo)` and `scraper_type`
- **Legal Flag Check**: Runs before scraping begins; sources with `legal_flag=false` filtered out automatically
- **Async Scraping**: Sources grouped by scraper type and executed in parallel pools
- **No Manual Routing**: Backend automatically selects appropriate scraper based on configuration

## Troubleshooting

### No sources found for campaign
- Check if registry has entries for the campaign's vertical/geo combination
- Verify `active=true` and `legal_flag=true` for the sources
- Seed sources if registry is empty: `npm run db:init`

### Wrong scraper type selected
- Verify source URL is correctly classified (JS-heavy → crawl4ai, static → cheerio)
- Test URL in browser; if page loads slowly with JS, use crawl4ai

### Selectors not extracting data
- Verify selectors match current website structure (websites change markup over time)
- Update selectors in registry: edit source, test with browser DevTools, update DB
- Use `::text` or `::attr(name)` for advanced extraction

## Future Enhancements

- [ ] UI for managing sources (add, edit, disable)
- [ ] Selector testing tool (validate selectors before saving)
- [ ] A/B testing for different selector strategies
- [ ] Fallback selectors if primary selector fails
- [ ] Rate limiting per source
- [ ] Geo-specific proxy routing
