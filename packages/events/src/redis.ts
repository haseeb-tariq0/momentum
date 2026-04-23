import { Redis } from 'ioredis'

let _redis: Redis | null = null

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        if (times > 3) return null  // stop retrying after 3 attempts
        return Math.min(times * 500, 2000)
      },
      reconnectOnError: () => false,
    })

    _redis.on('error', (err) => {
      // Only log once, not every retry
      if (err.message.includes('ECONNREFUSED')) {
        console.warn('[Redis] Not connected — some features may be unavailable')
      }
    })
  }
  return _redis
}
