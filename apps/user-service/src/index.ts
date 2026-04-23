import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '../../.env.local') })

import Fastify from 'fastify'
import cors from '@fastify/cors'
import { userRoutes }   from './routes/users.js'
import { importRoutes } from './routes/import.js'
import { syncRoutes, startSyncScheduler } from './routes/sync.js'

async function loadOptionalRoutes(app: ReturnType<typeof Fastify>) {
  try {
    const { reportRoutes } = await import('./routes/reports.js')
    await app.register(reportRoutes, { prefix: '/reports' })
  } catch (e: any) { console.warn('⚠️  Report routes failed:', e?.message) }
  try {
    const { notificationRoutes } = await import('./routes/notifications.js')
    await app.register(notificationRoutes, { prefix: '/notifications' })
  } catch (e: any) { console.warn('⚠️  Notification routes failed:', e?.message) }
}

async function main() {
  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 10_000_000 })
  await app.register(cors)
  app.addHook('onRequest', async (req) => {
    (req as any).user = {
      id:          req.headers['x-user-id']      as string,
      workspaceId: req.headers['x-workspace-id'] as string,
      profile:     req.headers['x-user-profile'] as string,
      seat:        req.headers['x-seat-type']    as string,
    }
  })
  await app.register(userRoutes,   { prefix: '/users' })
  await app.register(importRoutes, { prefix: '/users' })
  await app.register(syncRoutes,   { prefix: '/users/sync' })
  await loadOptionalRoutes(app)
  app.get('/health', async () => ({ status: 'ok', service: 'user-service', version: 'v3-import', ts: Date.now() }))
  const port = Number(process.env.USER_SERVICE_PORT) || 3004
  // Bind to loopback only — gateway is the only public entry point.
  await app.listen({ port, host: '127.0.0.1' })
  console.log(`✅ User service → 127.0.0.1:${port} [v3-import]`)

  // Start the 5-min incremental Forecast.it sync scheduler. Does nothing if
  // FORECAST_API_KEY is unset.
  if (process.env.FORECAST_SYNC_DISABLED !== '1') {
    startSyncScheduler()
    console.log('🔄 Forecast.it incremental sync scheduler started (5 min interval)')
  }
}
process.on('unhandledRejection', (err) => { console.error('[user-service] unhandledRejection:', err); process.exit(1) })
process.on('uncaughtException',  (err) => { console.error('[user-service] uncaughtException:',  err); process.exit(1) })

main().catch(e => { console.error(e); process.exit(1) })
