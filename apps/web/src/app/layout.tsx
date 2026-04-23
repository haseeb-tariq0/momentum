import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'Momentum',
  description: 'Project tracking, timesheets, resourcing, and budget analytics for Digital Nexa',
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
        {/* Google Fonts — Momentum brand (Apr 23, Shemoel):
              Poppins for body, Chakra Petch for headings only. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Chakra+Petch:wght@500;600;700&display=swap" rel="stylesheet" />
        {/* Apply theme before paint to prevent flash */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
