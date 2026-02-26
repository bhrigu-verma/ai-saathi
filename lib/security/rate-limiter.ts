import { Redis } from '@upstash/redis';
import { logEvent } from '../utils/logger';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number; // Unix timestamp in seconds
}

class RateLimiter {
  private redis: Redis;
  private windowSize: number; // in seconds
  private maxRequests: number;

  constructor(redis: Redis, windowSizeSeconds: number = 60, maxRequests: number = 60) {
    this.redis = redis;
    this.windowSize = windowSizeSeconds;
    this.maxRequests = maxRequests;
  }

  /**
   * Check if a request is allowed based on rate limit
   * @param identifier - Unique identifier for the client (e.g., phone number)
   * @returns RateLimitResult indicating if request is allowed
   */
  async checkLimit(identifier: string): Promise<RateLimitResult> {
    const key = `rate_limit:${identifier}`;
    const now = Math.floor(Date.now() / 1000); // Current Unix timestamp in seconds
    const windowStart = now - this.windowSize;

    // Use Redis to manage rate limiting
    // We'll use a sorted set to track requests with timestamps
    try {
      // Remove old entries outside the window
      await this.redis.zremrangebyscore(key, 0, windowStart);

      // Get current count
      const currentCount = await this.redis.zcard(key);

      if (currentCount >= this.maxRequests) {
        // Rate limit exceeded
        const oldestEntry = await this.redis.zrange(key, 0, 0, { withScores: true });
        const resetTime = oldestEntry.length > 0 ? parseInt(oldestEntry[0][1].toString()) + this.windowSize : now + this.windowSize;

        logEvent('rate_limit_exceeded', {
          identifier,
          currentCount,
          maxRequests: this.maxRequests,
          windowSize: this.windowSize
        });

        return {
          allowed: false,
          remaining: 0,
          resetTime
        };
      } else {
        // Add current request timestamp to the sorted set
        await this.redis.zadd(key, { score: now, member: now.toString() });
        
        // Set expiration to clean up automatically
        await this.redis.expire(key, this.windowSize);

        logEvent('rate_limit_check', {
          identifier,
          currentCount: currentCount + 1,
          maxRequests: this.maxRequests,
          windowSize: this.windowSize
        });

        return {
          allowed: true,
          remaining: this.maxRequests - currentCount - 1,
          resetTime: now + this.windowSize
        };
      }
    } catch (error) {
      logEvent('rate_limit_error', {
        identifier,
        error: error.message
      });
      
      // If Redis fails, we'll allow the request but log it
      return {
        allowed: true,
        remaining: this.maxRequests,
        resetTime: now + this.windowSize
      };
    }
  }

  /**
   * Get current rate limit status for an identifier
   * @param identifier - Unique identifier for the client
   * @returns Current rate limit status
   */
  async getStatus(identifier: string): Promise<RateLimitResult> {
    const key = `rate_limit:${identifier}`;
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - this.windowSize;

    try {
      // Remove old entries outside the window
      await this.redis.zremrangebyscore(key, 0, windowStart);
      
      const currentCount = await this.redis.zcard(key);
      
      return {
        allowed: currentCount < this.maxRequests,
        remaining: Math.max(0, this.maxRequests - currentCount),
        resetTime: now + this.windowSize
      };
    } catch (error) {
      logEvent('rate_limit_status_error', {
        identifier,
        error: error.message
      });
      
      return {
        allowed: true,
        remaining: this.maxRequests,
        resetTime: now + this.windowSize
      };
    }
  }
}

// Initialize rate limiter with environment config
let rateLimiter: RateLimiter;

export function getRateLimiter(redis: Redis): RateLimiter {
  if (!rateLimiter) {
    const windowSize = parseInt(process.env.RATE_LIMIT_WINDOW_SIZE || '60', 10);
    const maxRequests = parseInt(process.env.RATE_LIMIT_PER_MIN || '60', 10);
    
    rateLimiter = new RateLimiter(redis, windowSize, maxRequests);
  }
  
  return rateLimiter;
}

export type { RateLimitResult };