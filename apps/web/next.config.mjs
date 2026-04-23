/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production'

// Content Security Policy.
// `unsafe-inline` on script-src is required by Next.js for the inline runtime
// chunk; `unsafe-eval` is needed in dev for React Refresh. We tighten in prod.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Next.js + React need inline + (in dev) eval. Drop 'unsafe-eval' in prod.
  isProd
    ? "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://accounts.google.com"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://accounts.google.com",
  // Tailwind / inline style attrs need 'unsafe-inline'
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: blob:",
  "font-src 'self' data:",
  "frame-src 'self' https://accounts.google.com",
  "connect-src 'self' http://localhost:4000 https://api.forecast.it https://accounts.google.com",
  "object-src 'none'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options',        value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',     value: 'camera=(), microphone=(), geolocation=()' },
  // HSTS only in production over real HTTPS
  ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
]

const nextConfig = {
  reactStrictMode: true,

  // Proxy all /api/v1/* calls through Next.js server → eliminates CORS entirely
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'http://localhost:4000/api/v1/:path*',
      },
    ]
  },

  async headers() {
    return [
      {
        // Apply security headers to every route
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
