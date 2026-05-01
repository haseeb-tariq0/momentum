// Reusable brand lockup — the curved-arc + dot mark, the "Momentum"
// wordmark, and the geometric "NEXA" sub-brand SVG. Used in two places:
// the login screen (size="lg" with the framed-card styling) and the
// sidebar header (size="sm", inline). The NEXA glyphs are inline SVG
// rather than a font so the sub-brand renders identically across systems
// without depending on a third-party brand font.

import { cn } from '@/lib/cn'

type Size = 'sm' | 'lg'

interface BrandLockupProps {
  size?: Size
  /** When false, renders just the mark + wordmark (no "powered by NEXA"
   *  line). Useful in tight horizontal spaces where the tagline is shown
   *  separately on its own row. Defaults to true. */
  tagline?: boolean
  className?: string
}

// Mark — keeps the existing teal swoosh + blue dot. Stroke-width nudged
// up from 3.2 to 3.6 (matches the redesign file) so it doesn't read as
// a hairline on retina displays.
function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-9 -9 78 78"
      className={className}
      aria-hidden
    >
      <path
        d="M 8,52 Q 8,8 52,8"
        stroke="#00C4B4"
        strokeWidth="3.6"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="52" cy="8" r="6" fill="#4A9EFF" />
    </svg>
  )
}

// NEXA wordmark — geometric glyphs in violet. Hand-crafted SVG paths
// (not a font) so the sub-brand keeps consistent kerning + colour across
// every surface it lands on.
function NexaWordmark({ height = 11, className }: { height?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 207 40"
      height={height}
      className={className}
      aria-label="NEXA"
      role="img"
    >
      {/* N */}
      <path d="M 0 40 L 0 0 L 9 0 L 32 27 L 32 0 L 41 0 L 41 40 L 32 40 L 9 13 L 9 40 Z" fill="#8B2FE0" />
      {/* E (three bars, open right) */}
      <rect x="55" y="0"    width="35" height="7" fill="#8B2FE0" />
      <rect x="55" y="16.5" width="32" height="7" fill="#8B2FE0" />
      <rect x="55" y="33"   width="35" height="7" fill="#8B2FE0" />
      {/* X */}
      <path d="M 104 0 L 113 0 L 124 16 L 135 0 L 144 0 L 128.5 22 L 144 40 L 135 40 L 124 24 L 113 40 L 104 40 L 119.5 22 Z" fill="#8B2FE0" />
      {/* A (chevron, no crossbar) */}
      <path d="M 158 40 L 178 0 L 187 0 L 207 40 L 198 40 L 182.5 9 L 167 40 Z" fill="#8B2FE0" />
    </svg>
  )
}

export default function BrandLockup({ size = 'sm', tagline = true, className }: BrandLockupProps) {
  // Two preset sizings, tuned for the surfaces they live on:
  //   - sm: sidebar header. Sidebar can shrink to 160px wide, so the
  //         lockup is intentionally compact — small mark, modest
  //         wordmark, NEXA glyph at 7px so the "powered by NEXA" line
  //         still fits next to a 24px bell button.
  //   - lg: login screen. Full editorial scale — generous mark, 26px
  //         wordmark, 11px NEXA glyph.
  const markSize  = size === 'lg' ? 'w-10 h-10' : 'w-7 h-7'
  const nameSize  = size === 'lg' ? 'text-[26px]' : 'text-[17px]'
  const gap       = size === 'lg' ? 'gap-3'      : 'gap-2'
  const byGap     = size === 'lg' ? 'mt-1.5'     : 'mt-0.5'
  const nexaH     = size === 'lg' ? 11           : 7
  const bySize    = size === 'lg' ? 'text-[12px]' : 'text-[10px]'
  const byInnerGap = size === 'lg' ? 'gap-1.5'   : 'gap-1'

  return (
    <div className={cn('flex items-center min-w-0 overflow-hidden', gap, className)}>
      <Mark className={cn('flex-shrink-0', markSize)} />
      {/* min-w-0 + overflow-hidden on the text column lets the lockup
          shrink below its intrinsic content width without forcing the
          parent to expand. Critical inside the narrow sidebar where the
          NEXA SVG would otherwise push the entire brand block past the
          sidebar's right edge. */}
      <div className="leading-[1.1] min-w-0 overflow-hidden">
        <div
          className={cn(
            'font-display font-medium text-primary tracking-[-0.02em] truncate',
            nameSize,
          )}
        >
          Momentum
        </div>
        {tagline && (
          <div
            className={cn(
              'flex items-center text-muted whitespace-nowrap overflow-hidden',
              byGap,
              bySize,
              byInnerGap,
            )}
          >
            <span className="truncate">powered by</span>
            <NexaWordmark
              height={nexaH}
              className="flex-shrink-0"
            />
          </div>
        )}
      </div>
    </div>
  )
}

export { Mark, NexaWordmark }
