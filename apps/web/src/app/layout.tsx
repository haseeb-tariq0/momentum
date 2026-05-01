import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'

// Brand metadata. icon.png + apple-icon.png in this folder are picked up
// automatically by Next.js's App Router file conventions; manifest + OG image
// live under /public. metadataBase makes OG image URLs resolve absolutely
// regardless of where the app is running (Render preview, prod, etc.).
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://momentum.digitalnexa.com'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Momentum', template: '%s · Momentum' },
  description: 'Project tracking, timesheets, resourcing, and budget analytics for Digital Nexa',
  applicationName: 'Momentum',
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'Momentum',
    description: 'Project tracking, timesheets, resourcing, and budget analytics for Digital Nexa',
    siteName: 'Momentum',
    type: 'website',
    images: [{ url: '/brand/PNG/Dark Rounded/momentum_logo_1024x1024.png', width: 1024, height: 1024, alt: 'Momentum' }],
  },
}

// Next.js 14 wants themeColor in a viewport export, not metadata.
export const viewport: Viewport = {
  themeColor: '#0D1B2A',
}

// Anti-flash script: runs before React hydration to apply the saved theme
const themeScript = `
  (function() {
    try {
      var t = localStorage.getItem('forecast-theme');
      document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
    } catch(e) {}
  })();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Google Fonts — Momentum brand:
              - Poppins for body
              - Chakra Petch for product headings
              - Inter for the brand wordmark (used in BrandLockup — needs the
                tighter spacing + 500-weight feel that matches the redesign)
              - Instrument Serif for editorial/italic accent moments */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Chakra+Petch:wght@500;600;700&family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
        {/* Apply theme before paint to prevent flash */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
