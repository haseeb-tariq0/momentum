import { Redis } from 'ioredis'
import type { DomainEvent } from '@forecast/types'

const CHANNEL = 'forecast:events'

let _redis: Redis | null = null

function getRedis() {
  if (!_redis) _redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
  return _redis
}

export async function publish<T extends DomainEvent['type']>(
  type: T,
  payload: Extract<DomainEvent, { type: T }>['payload']
) {
  await getRedis().publish(CHANNEL, JSON.stringify({ type, payload }))
}
