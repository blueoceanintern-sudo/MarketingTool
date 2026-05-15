from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
import asyncio
import logging
from crawl4ai import AsyncWebCrawler
from datetime import datetime
import os

# Logging setup
log_level = os.getenv('CRAWL4AI_LOG_LEVEL', 'info').upper()
logging.basicConfig(
    level=getattr(logging, log_level),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Crawl4AI Service")

class ScrapeRequest(BaseModel):
    urls: List[str]
    timeout: int = 30000  # milliseconds

class ScrapeResponse(BaseModel):
    url: str
    markdown: str
    status: int
    timestamp: str

# Global crawler instance
crawler: AsyncWebCrawler = None

@app.on_event("startup")
async def startup():
    global crawler
    logger.info("Initializing Crawl4AI AsyncWebCrawler...")
    crawler = AsyncWebCrawler()
    await crawler.warm_up()
    logger.info("Crawl4AI ready")

@app.on_event("shutdown")
async def shutdown():
    global crawler
    if crawler:
        await crawler.close()
        logger.info("Crawl4AI closed")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

@app.post("/scrape", response_model=List[ScrapeResponse])
async def scrape(request: ScrapeRequest):
    """
    Scrape URLs and return markdown content

    Args:
        request: ScrapeRequest with list of URLs and timeout

    Returns:
        List of ScrapeResponse objects with markdown content
    """
    if not request.urls:
        raise HTTPException(status_code=400, detail="No URLs provided")

    if not crawler:
        raise HTTPException(status_code=503, detail="Crawler not initialized")

    timeout_seconds = request.timeout / 1000  # Convert ms to seconds
    results = []

    logger.info(f"Starting scrape of {len(request.urls)} URLs (timeout: {timeout_seconds}s)")

    try:
        # Scrape URLs concurrently
        tasks = [
            scrape_single_url(url, timeout_seconds)
            for url in request.urls
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Handle exceptions in results
        final_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Error scraping {request.urls[i]}: {str(result)}")
                final_results.append(
                    ScrapeResponse(
                        url=request.urls[i],
                        markdown="",
                        status=500,
                        timestamp=datetime.utcnow().isoformat()
                    )
                )
            else:
                final_results.append(result)

        logger.info(f"Scrape completed. {len(final_results)} URLs processed")
        return final_results

    except Exception as e:
        logger.error(f"Scraping failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Scraping failed: {str(e)}")

async def scrape_single_url(url: str, timeout: float) -> ScrapeResponse:
    """Scrape a single URL with timeout"""
    try:
        logger.debug(f"Scraping {url}")

        result = await asyncio.wait_for(
            crawler.arun(url),
            timeout=timeout
        )

        logger.debug(f"Successfully scraped {url}")

        return ScrapeResponse(
            url=url,
            markdown=result.markdown,
            status=200,
            timestamp=datetime.utcnow().isoformat()
        )
    except asyncio.TimeoutError:
        logger.warning(f"Timeout scraping {url}")
        raise Exception(f"Timeout after {timeout}s")
    except Exception as e:
        logger.error(f"Error scraping {url}: {str(e)}")
        raise

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
