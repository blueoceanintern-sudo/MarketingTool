#!/bin/bash

# Start Crawl4AI Docker container
set -e

echo "🚀 Starting Crawl4AI Docker container..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "⚠️  docker-compose not found, using 'docker compose' instead"
    DC="docker compose"
else
    DC="docker-compose"
fi

# Build and start container
echo "📦 Building Docker image..."
$DC build

echo "🔄 Starting services..."
$DC up -d

# Wait for service to be healthy
echo "⏳ Waiting for Crawl4AI to be ready..."
for i in {1..30}; do
    if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
        echo "✅ Crawl4AI is ready!"
        echo ""
        echo "Service running at: http://localhost:8000"
        echo "Logs: docker logs crawl4ai_service"
        echo ""
        exit 0
    fi
    echo "  Attempt $i/30..."
    sleep 2
done

echo "❌ Crawl4AI failed to start within 60 seconds"
docker logs crawl4ai_service
exit 1
