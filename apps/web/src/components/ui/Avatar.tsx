import { cn } from '@/lib/cn'
import type { HTMLAttributes } from 'react'

// 12-color palette — picked so adjacent hash indices land on visually
// distinct hues (teal → indigo → amber → rose, not teal → green → emerald).
// Each entry is [foreground, background-dim] so initials stay legible on
// both light and dark backgrounds.
const AVATAR_PALETTE = [
  ['#0D9488', 'rgba(13,148,136,0.16)'],   // teal
  ['#7C3AED', 'rgba(124,58,237,0.16)'],   // violet
  ['#2563EB', 'rgba(37,99,235,0.16)'],    // blue
  ['#D97706', 'rgba(217,119,6,0.16)'],    // amber
  ['#DC2626', 'rgba(220,38,38,0.16)'],    // red
  ['#059669', 'rgba(5,150,105,0.16)'],    // emerald
  ['#0891B2', 'rgba(8,145,178,0.16)'],    // cyan
  ['#BE185D', 'rgba(190,24,93,0.16)'],    // pink
  ['#4F46E5', 'rgba(79,70,229,0.16)'],    // indigo
  ['#EA580C', 'rgba(234,88,12,0.16)'],    // orange
  ['#65A30D', 'rgba(101,163,13,0.16)'],   // lime
  ['#9333EA', 'rgba(147,51,234,0.16)'],   // purple
] as const

function hashName(name: string): number {
  let h = 0
  for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h)
  return Math.abs(h) % AVATAR_PALETTE.length
}

type Size = 'sm' | 'md' | 'lg'

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  name: string
  src?: string | null
  size?: Size
}

const sizeStyles: Record<Size, string> = {
  sm: 'w-6 h-6 text-[11px]',
  md: 'w-7 h-7 text-xs',
  lg: 'w-9 h-9 text-sm',
}

function Avatar({ name, src, size = 'md', className, ...props }: AvatarProps) {
  const idx = hashName(name)
  const [fg, bg] = AVATAR_PALETTE[idx]
  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        loading="lazy"
        decoding="async"
        className={cn(
          'rounded-full object-cover flex-shrink-0',
          sizeStyles[size],
          className,
        )}
        {...(props as any)}
      />
    )
  }

  return (
    <div
      className={cn(
        'rounded-full flex-shrink-0 flex items-center justify-center font-bold select-none',
        sizeStyles[size],
        className,
      )}
      style={{ color: fg, background: bg }}
      title={name}
      {...props}
    >
      {initials}
    </div>
  )
}

export { Avatar, type AvatarProps, AVATAR_PALETTE, hashName }
