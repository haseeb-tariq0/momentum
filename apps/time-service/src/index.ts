import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '../../.env.local') })

import Fastify from 'fastify'
import cors from '@fastify/cors'
import { timeRoutes } from './routes/time.js'

async function main() {
  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 1_000_000 })
  await app.register(cors)
  app.addHook('onRequest', async (req) => {
    (req as any).user = {
      id:          req.headers['x-user-id']      as string,
      workspaceId: req.headers['x-workspace-id'] as string,
      profile:     req.headers['x-user-profile'] as string,
      seat:        req.headers['x-seat-type']    as string,
    }
  })
  await app.register(timeRoutes, { prefix: '/time' })
  app.get('/health', async () => ({ status: 'ok', service: 'time-service', version: 'v3-ws-enforce', ts: Date.now() }))
  const port = Number(process.env.TIME_SERVICE_PORT) || 3003
  // Bind to loopback only — gateway is the only public entry point.
  await app.listen({ port, host: '127.0.0.1' })
  console.log(`✅ Time service → 127.0.0.1:${port} [v3-ws-enforce]`)
}
process.on('unhandledRejection', (err) => { console.error('[time-service] unhandledRejection:', err); process.exit(1) })
process.on('uncaughtException',  (err) => { console.error('[time-service] uncaughtException:',  err); process.exit(1) })

main().catch(e => { console.error(e); process.exit(1) })