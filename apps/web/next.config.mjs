/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production'

// API upstream. In dev the consolidated server runs on localhost:4000.
// In prod (Render) we point at the backend service URL Render injects via
// NEXT_PUBLIC_API_URL. That value can arrive in three forms depending on
// how it was set:
//   • full URL   — https://momentum-server-068y.onrender.com
//   • bare host  — momentum-server-068y.onrender.com
//   • subdomain  — momentum-server-068y  (Render fromService.host quirk)
// Normalize all three to a fully-qualified https URL. Without the subdomain
// branch the rewrite target becomes https://momentum-server-068y, which
// doesn't resolve DNS and turns every /api/v1/* call into a Next.js 500.
const rawApiUrl  = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
const bareHost   = rawApiUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
const fqdnHost   = bareHost.includes('.') ? bareHost : `${bareHost}.onrender.com`
const apiUpstream = /^https?:\/\//.test(rawApiUrl)
  ? rawApiUrl
  : `https://${fqdnHost}`

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
  // Tailwind / inline style attrs need 'unsafe-inline'.
  // Google Fonts stylesheet comes from fonts.googleapis.com; if that host is
  // not allowed, the browser blocks Poppins + Chakra Petch at load time.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https: blob:",
  // Font files themselves are served from fonts.gstatic.com.
  "font-src 'self' data: https://fonts.gstatic.com",
  "frame-src 'self' https://accounts.google.com",
  // connect-src must include our API upstream so fetch() to /api/v1/* isn't
  // blocked in prod. localhost:4000 stays for dev; apiUpstream is whatever
  // Render's NEXT_PUBLIC_API_URL resolves to at build time.
  `connect-src 'self' http://localhost:4000 ${apiUpstream} https://api.forecast.it https://accounts.google.com`,
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

  // Proxy all /api/v1/* calls through Next.js server → eliminates CORS
  // entirely. Destination comes from NEXT_PUBLIC_API_URL in prod (Render
  // injects it from the server service's URL), falls back to localhost:4000
  // for local dev.
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiUpstream}/api/v1/:path*`,
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
