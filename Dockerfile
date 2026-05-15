FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    chromium-browser \
    chromium-driver \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip install --no-cache-dir \
    crawl4ai \
    fastapi \
    uvicorn \
    pydantic \
    python-dotenv

# Copy app files
COPY . .

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run Crawl4AI service
CMD ["uvicorn", "crawl4ai_service:app", "--host", "0.0.0.0", "--port", "8000"]
