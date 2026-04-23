import { Redis } from 'ioredis'
import type { DomainEvent } from '@forecast/types'

const CHANNEL = 'forecast:events'

function makeRedis() {
  return new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2000)),
    reconnectOnError: () => false,
  })
}

let publisher: Redis | null = null

function getPublisher() {
  if (!publisher) {
    publisher = makeRedis()
    publisher.on('error', () => {}) // suppress repeated logs
  }
  return publisher
}

export async function publish<T extends DomainEvent['type']>(
  type: T,
  payload: Extract<DomainEvent, { type: T }>['payload']
): Promise<void> {
  try {
    const event: DomainEvent = { type, payload } as DomainEvent
    await getPublisher().publish(CHANNEL, JSON.stringify(event))
  } catch {
    // Non-fatal — events are best-effort in dev
    console.warn(`[Events] Could not publish ${type} — Redis unavailable`)
  }
}

export async function subscribe(handler: (event: DomainEvent) => Promise<void>): Promise<void> {
  const subscriber = makeRedis()
  subscriber.on('error', () => {}) // suppress repeated logs

  try {
    await subscriber.subscribe(CHANNEL)
    subscriber.on('message', async (_channel, message) => {
      try {
        const event = JSON.parse(message) as DomainEvent
        await handler(event)
      } catch (err) {
        console.error('[Events] Handler error:', err)
      }
    })
  } catch {
    console.warn('[Events] Could not subscribe — Redis unavailable')
  }
}

export type { DomainEvent }
