import type { MetadataRoute } from 'next'

// PWA manifest. Served at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Momentum',
    short_name: 'Momentum',
    description: 'Project tracking, timesheets, resourcing, and budget analytics for Digital Nexa',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0D1B2A',
    theme_color: '#0D1B2A',
    icons: [
      { src: '/brand/PNG/Dark Rounded/momentum_logo_192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/PNG/Dark Rounded/momentum_logo_256x256.png', sizes: '256x256', type: 'image/png' },
      { src: '/brand/PNG/Dark Rounded/momentum_logo_512x512.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/PNG/Dark Rounded/momentum_logo_1024x1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
    ],
  }
}
