# Crawl4AI Docker Setup

## Overview

Crawl4AI is deployed as a self-hosted Docker container that handles web scraping for lead generation. It runs as a FastAPI service on port 8000.

## Architecture

```
Campaign Created
    ↓
ScraperService.triggerScrapeJob()
    ↓
Create scrape_jobs DB record (status: pending)
    ↓
Queue ScrapeJob (async, non-blocking)
    ↓
Call Crawl4AI API: POST /scrape
    ↓
Timeout/Retry Logic (exponential backoff)
    ↓
Parse Markdown → Extract Lead Data
    ↓
Store Leads in leads table
    ↓
Update scrape_jobs (status: completed/failed)
```

## Prerequisites

- Docker & docker-compose installed
- Node.js 18+ (for TypeScript service)
- PostgreSQL running (or use Docker postgres service)

## Quick Start

### 1. Start Crawl4AI Container

```bash
# Using the helper script
bash scripts/start-crawler.sh

# Or manually
docker-compose up -d
```

### 2. Verify Health

```bash
curl http://localhost:8000/health
# Response: {"status":"healthy","timestamp":"2026-05-15T..."}
```

### 3. Test Scraping

```bash
curl -X POST http://localhost:8000/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com"],
    "timeout": 30000
  }'
```

## Configuration

Environment variables in `docker-compose.yml`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `CRAWL4AI_LOG_LEVEL` | info | Logging level (debug/info/warn/error) |
| `CRAWL4AI_TIMEOUT` | 30 | Request timeout (seconds) |
| `CRAWL4AI_MAX_RETRIES` | 3 | Max retry attempts |

TypeScript config in `src/config/crawl4ai.config.ts`:

| Config | Default | Purpose |
|--------|---------|---------|
| `timeout` | 30s | Request timeout |
| `maxRetries` | 3 | Max retries on failure |
| `retryDelay` | 1000ms | Initial retry delay |
| `backoffMultiplier` | 2 | Exponential backoff factor |
| `requestsPerSecond` | 5 | Rate limit |
| `maxConcurrent` | 3 | Max concurrent requests |

## Service Layer

### Trigger Scraping

```typescript
import ScraperService from '@/services/scraper';

const scraper = new ScraperService(process.env.DATABASE_URL!);

// Trigger scrape job for a campaign
const jobId = await scraper.triggerScrapeJob(campaignId, [
  'https://acra.gov.sg/company1',
  'https://acra.gov.sg/company2'
]);

// Job runs async in background
// Retries automatically on timeout/failure
// Updates scrape_jobs table with status
```

### Check Job Status

```typescript
const job = await scraper.getJobStatus(jobId);
console.log(job);
// {
//   id: "uuid",
//   campaignId: "uuid",
//   status: "completed", // or "pending", "in_progress", "failed"
//   leadsScraped: 42,
//   errorMessage: null,
//   retryCount: 0,
//   completedAt: "2026-05-15T10:30:00Z"
// }
```

## Timeout & Retry Handling

### Retry Logic

1. **Pre-Retry Check**: Validate retry_count < max_retries
2. **Exponential Backoff**: delay = 1000ms × 2^(retry_count-1)
3. **Max Delay**: Cap at 60 seconds
4. **Logging**: All failures logged to DB + console

### Timeout Behavior

- **Request Timeout** (>30s): Crawl4AI API throws ECONNABORTED
- **Service Timeout**: Docker restarts container if unhealthy >90s
- **Automatic Retry**: Triggered on timeout (counts toward max_retries)

### Error Scenarios

| Error | Action | Retries |
|-------|--------|---------|
| URL not found (404) | Log & skip | No |
| Timeout (>30s) | Retry with backoff | Yes (3x) |
| Service down (503) | Retry with backoff | Yes (3x) |
| Network error | Retry with backoff | Yes (3x) |
| Max retries exceeded | Mark job as failed | - |

## Logs

### Container Logs

```bash
# View live logs
docker logs -f crawl4ai_service

# View last 100 lines
docker logs --tail=100 crawl4ai_service
```

### Database Logs

Query `scrape_jobs` table:

```sql
SELECT 
  id, campaign_id, status, leads_scraped, 
  error_message, retry_count, completed_at
FROM scrape_jobs
WHERE status = 'failed'
ORDER BY created_at DESC;
```

## Performance

- **Concurrent Requests**: 3 (configurable)
- **Rate Limit**: 5 requests/second
- **Memory**: ~300MB (Crawl4AI + Chrome)
- **Startup Time**: 5-10s

## Common Issues

### Container Won't Start

```bash
# Check logs
docker logs crawl4ai_service

# Rebuild (if issue persists)
docker-compose build --no-cache
docker-compose up -d
```

### Service Timeout

Increase timeout in `docker-compose.yml`:

```yaml
environment:
  - CRAWL4AI_TIMEOUT=60  # 60 seconds
```

### Out of Memory

Increase Docker container memory limit in `docker-compose.yml`:

```yaml
services:
  crawl4ai:
    mem_limit: 1g  # 1GB
```

## Stopping the Service

```bash
# Stop container
docker-compose down

# Remove volumes
docker-compose down -v

# Stop and remove all data
docker-compose down -v --remove-orphans
```

## Testing

```bash
# Test scraping a single URL
npm run db:init  # Initialize DB first

# Create a test campaign and trigger scrape
npx ts-node -e "
  import ScraperService from './src/services/scraper';
  
  const scraper = new ScraperService(process.env.DATABASE_URL!);
  const jobId = await scraper.triggerScrapeJob(
    'test-campaign-id',
    ['https://example.com']
  );
  
  console.log('Job ID:', jobId);
  
  // Wait 5 seconds and check status
  setTimeout(async () => {
    const status = await scraper.getJobStatus(jobId);
    console.log('Status:', status);
    await scraper.close();
  }, 5000);
"
```

## Next Steps

- [ ] Implement markdown parsing in `parseAndExtractLeads()`
- [ ] Add rate limiting to prevent 429 errors
- [ ] Monitor Crawl4AI performance under load
- [ ] Set up log rotation for container logs
- [ ] Add metrics/observability (Prometheus, etc.)
