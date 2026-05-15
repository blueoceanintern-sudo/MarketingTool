export interface Crawl4AIConfig {
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  retryDelay: number; // ms
  backoffMultiplier: number;
  rateLimit: {
    requestsPerSecond: number;
    maxConcurrent: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    logDir: string;
  };
}

export const crawl4aiConfig: Crawl4AIConfig = {
  baseUrl: process.env.CRAWL4AI_BASE_URL || 'http://localhost:8000',
  timeout: parseInt(process.env.CRAWL4AI_TIMEOUT || '30') * 1000, // 30 seconds
  maxRetries: parseInt(process.env.CRAWL4AI_MAX_RETRIES || '3'),
  retryDelay: parseInt(process.env.CRAWL4AI_RETRY_DELAY || '1000'), // 1 second
  backoffMultiplier: 2,
  rateLimit: {
    requestsPerSecond: parseInt(process.env.CRAWL4AI_RPS || '5'),
    maxConcurrent: parseInt(process.env.CRAWL4AI_MAX_CONCURRENT || '3'),
  },
  logging: {
    level: (process.env.CRAWL4AI_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
    logDir: process.env.CRAWL4AI_LOG_DIR || './logs',
  },
};

export default crawl4aiConfig;
