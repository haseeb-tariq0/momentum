import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy: (times) => (times > 5 ? null : Math.min(times * 1000, 5000)),
})

connection.on('error', () => {}) // suppress spam

export const reportQueue = new Queue('reports', { connection })
