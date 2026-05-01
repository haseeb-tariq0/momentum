/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      /* ── Colors mapped from CSS variables ─────────────────────────── */
      colors: {
        /* Surface / background colors — use as bg-surface-base, bg-surface-raised, etc. */
        surface: {
          base: 'var(--bg-base)',
          raised: 'var(--bg-raised)',
          DEFAULT: 'var(--bg-surface)',
          overlay: 'var(--bg-overlay)',
          hover: 'var(--bg-hover)',
        },
        /* Border colors — use as border-line-subtle, border-line-muted */
        line: {
          subtle: 'var(--border-subtle)',
          muted: 'var(--border-muted)',
          strong: 'var(--border-strong)',
          accent: 'var(--border-accent)',
        },
        /* Accent colors */
        accent: {
          DEFAULT: 'var(--accent)',
          dim: 'var(--accent-dim)',
          glow: 'var(--accent-glow)',
          dark: 'var(--accent-dark)',
        },
        /* Text colors — use as text-primary, text-secondary, text-muted */
        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        muted: 'var(--text-tertiary)',
        /* Status colors */
        status: {
          amber: 'var(--amber)',
          'amber-dim': 'var(--amber-dim)',
          rose: 'var(--rose)',
          'rose-dim': 'var(--rose-dim)',
          violet: 'var(--violet)',
          'violet-dim': 'var(--violet-dim)',
          sky: 'var(--sky)',
          'sky-dim': 'var(--sky-dim)',
          /* Financial P/L — use in profit/loss cells and margin colors.
             Distinct from `rose` (destructive/delete). */
          profit: 'var(--profit)',
          'profit-dim': 'var(--profit-dim)',
          loss: 'var(--loss)',
          'loss-dim': 'var(--loss-dim)',
        },
      },

      /* ── Typography scale ─────────────────────────────────────────── */
      fontSize: {
        'xs':   ['11px', { lineHeight: '1.45' }],
        'sm':   ['12px', { lineHeight: '1.5' }],
        'base': ['13px', { lineHeight: '1.5' }],
        'lg':   ['14px', { lineHeight: '1.5' }],
        'xl':   ['16px', { lineHeight: '1.4' }],
        '2xl':  ['20px', { lineHeight: '1.3' }],
        '3xl':  ['24px', { lineHeight: '1.25' }],
      },

      /* ── Border radius scale ──────────────────────────────────────── */
      borderRadius: {
        'sm':      '4px',
        'DEFAULT': '6px',
        'md':      '8px',
        'lg':      '10px',
        'xl':      '12px',
        '2xl':     '14px',
      },

      /* ── Z-index scale (replaces 9000/9999/99999 chaos) ──────────── */
      zIndex: {
        'dropdown': '50',
        'sticky':   '100',
        'overlay':  '200',
        'modal':    '300',
        'popover':  '400',
        'toast':    '500',
      },

      /* ── Shadows from CSS vars ────────────────────────────────────── */
      boxShadow: {
        'sm':    'var(--shadow-sm)',
        'md':    'var(--shadow-md)',
        'accent': '0 0 0 3px var(--accent-dim)',
        'glow':  '0 2px 8px var(--accent-glow)',
        'glow-lg': '0 4px 14px var(--accent-glow)',
      },

      /* ── Font families ────────────────────────────────────────────── */
      fontFamily: {
        body:    'var(--font-body)',
        heading: 'var(--font-heading)',
        mono:    'var(--font-mono)',
        display: 'var(--font-display)',
        serif:   'var(--font-serif)',
      },

      /* ── Sidebar width ────────────────────────────────────────────── */
      width: {
        'sidebar': '200px',
      },

      /* ── Animations (centralized from scattered inline keyframes) ── */
      keyframes: {
        'spin': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
        'pulse-opacity': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
        'blink': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.95) translateY(8px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'popup-slide': {
          from: { opacity: '0', transform: 'scale(0.96) translateY(-4px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'menu-slide': {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'overlay-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'panel-in': {
          from: { opacity: '0', transform: 'scale(0.95) translateY(12px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'skeleton': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'bar-rise': {
          from: { transform: 'scaleY(0)' },
          to:   { transform: 'scaleY(1)' },
        },
        'dot-pulse': {
          '0%, 80%, 100%': { opacity: '0.2' },
          '40%': { opacity: '1' },
        },
      },
      animation: {
        'spin':         'spin 1s linear infinite',
        'pulse-opacity':'pulse-opacity 1.5s ease-in-out infinite',
        'blink':        'blink 1s step-end infinite',
        'fade-in':      'fade-in 0.15s ease',
        'fade-up':      'fade-up 0.2s ease',
        'scale-in':     'scale-in 0.2s cubic-bezier(0.16,1,0.3,1)',
        'popup-slide':  'popup-slide 0.14s cubic-bezier(0.16,1,0.3,1)',
        'menu-slide':   'menu-slide 0.12s ease',
        'overlay-in':   'overlay-in 0.15s ease',
        'panel-in':     'panel-in 0.2s cubic-bezier(0.16,1,0.3,1)',
        'skeleton':     'skeleton 1.8s ease-in-out infinite',
        'bar-rise':     'bar-rise 0.5s cubic-bezier(0.16,1,0.3,1) both',
        'dot-pulse':    'dot-pulse 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
