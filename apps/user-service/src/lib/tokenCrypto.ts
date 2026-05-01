// AES-256-GCM encrypt/decrypt for third-party refresh tokens stored in
// the `user_oauth_grants` table.
//
// Why:
//   - DB dumps (Supabase backups, accidental SELECT, point-in-time
//     restores) shouldn't expose Google credentials in plaintext.
//   - GCM gives us authenticated encryption — tampering with the
//     ciphertext flips the auth tag and decrypt() throws, so we don't
//     silently read attacker-controlled bytes back into Google API calls.
//
// Format on disk: base64( iv || ciphertext || authTag )
//   - iv:        12 bytes (96 bits — GCM-recommended)
//   - ciphertext: variable
//   - authTag:   16 bytes (128 bits — GCM standard)
//
// The encryption key comes from OAUTH_TOKEN_ENC_KEY env, a 64-char hex
// string (= 32 bytes = AES-256). Generate with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Rotation: if the key is changed, every existing row decrypt fails and
// users have to reconnect. There's no key-id versioning yet — when we
// need it (e.g. compliance forcing 90-day rotation), prepend a version
// byte to the format and keep both keys in env.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const IV_BYTES      = 12
const AUTH_TAG_BYTES = 16
const KEY_BYTES     = 32  // AES-256

let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const hex = process.env.OAUTH_TOKEN_ENC_KEY
  if (!hex) {
    throw new Error(
      'OAUTH_TOKEN_ENC_KEY is not set. Generate one with: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    )
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('OAUTH_TOKEN_ENC_KEY must be a 64-char hex string (32 bytes / AES-256).')
  }
  cachedKey = Buffer.from(hex, 'hex')
  if (cachedKey.length !== KEY_BYTES) {
    throw new Error(`OAUTH_TOKEN_ENC_KEY decoded to ${cachedKey.length} bytes, expected ${KEY_BYTES}.`)
  }
  return cachedKey
}

/** Returns true if the encryption key is configured. Lets routes 503 with a
 *  helpful message instead of crashing on the first OAuth callback. */
export function isTokenCryptoConfigured(): boolean {
  try { getKey(); return true } catch { return false }
}

/** Encrypt a plaintext token (typically a Google refresh token). */
export function encryptToken(plaintext: string): string {
  if (!plaintext) throw new Error('encryptToken: empty plaintext')
  const iv     = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const ct     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  return Buffer.concat([iv, ct, tag]).toString('base64')
}

/** Decrypt a value produced by encryptToken(). Throws if the ciphertext
 *  has been tampered with or the key is wrong. */
export function decryptToken(b64: string): string {
  if (!b64) throw new Error('decryptToken: empty ciphertext')
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < IV_BYTES + AUTH_TAG_BYTES + 1) {
    throw new Error('decryptToken: ciphertext too short to be a valid AES-256-GCM payload')
  }
  const iv  = buf.subarray(0, IV_BYTES)
  const tag = buf.subarray(buf.length - AUTH_TAG_BYTES)
  const ct  = buf.subarray(IV_BYTES, buf.length - AUTH_TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
