// MUST be first — load env before anything else
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '../../.env.local') })

import { PrismaClient } from '@prisma/client'

// Build URL from individual parts to safely handle special chars in password
function buildDatabaseUrl(): string {
  const host = process.env.DB_HOST
  const port = process.env.DB_PORT || '5432'
  const user = process.env.DB_USER
  const pass = process.env.DB_PASSWORD
  const name = process.env.DB_NAME || 'postgres'

  if (host && user && pass) {
    const encodedPass = encodeURIComponent(pass)
    const encodedUser = encodeURIComponent(user)
    return `postgresql://${encodedUser}:${encodedPass}@${host}:${port}/${name}`
  }

  // Fall back to DATABASE_URL if individual vars not set
  return process.env.DATABASE_URL || ''
}

declare global {
  var __prisma: PrismaClient | undefined
}

const url = buildDatabaseUrl()

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    datasources: {
      db: { url },
    },
  })

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma
}

export * from '@prisma/client'
