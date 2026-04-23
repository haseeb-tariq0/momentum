# Page Migration Pattern

The Forecast app has a complete design system (`tailwind.config.js` + `components/ui/*`)
that most page bodies don't use. They were written in inline `style={{}}` objects
and reinvent button/card/badge/spacing values on every page.

This doc is the lookup table for migrating pages to use the system. Use it when
sweeping a page so changes stay consistent across the app.

The reference implementation is **`apps/web/src/app/(dashboard)/team/page.tsx`** —
read it before migrating another page.

## What to replace

| Inline pattern | Use instead |
|---|---|
| `<h1 style={{ fontSize: 24, ... }}>Page</h1>` + subtitle div + actions div | `<PageHeader title="Page" subtitle="…" actions={…} />` |
| `<div style={{ background:'var(--bg-raised)', border, borderRadius:10, padding:'14px 16px' }}>label / value / sub</div>` (KPI strip) | `<StatCard label="…" value={n} sub="…" tone="accent" />` |
| `<div style={{ background:'var(--bg-raised)', border:'1px solid var(--border-subtle)', borderRadius, padding }}>...</div>` (any card-shaped surface) | `<Card className="…">` |
| Custom 34/42px circle div with avatar initials | `<Avatar name={u.name} size="lg" />` |
| `<span style={{ background, color, padding, borderRadius }}>Status</span>` | `<Badge variant="success|warning|danger|info|violet|default">Status</Badge>` |
| Custom skeleton `<div style={{ background:'var(--bg-overlay)', animation:'pulse...' }}>` | `<Skeleton className="h-…" />` |
| `<button style={{ background:'var(--accent)', ... }}>` | `<Button variant="primary">` |
| Inline "no results" markup | `<EmptyState title="…" action={<Button …>Clear</Button>} />` |

## What to use Tailwind for

| Inline | Tailwind |
|---|---|
| `style={{ padding: '24px 28px' }}` | `className="px-7 py-6"` |
| `style={{ marginBottom: 20 }}` | `className="mb-5"` |
| `style={{ display: 'flex', gap: 10 }}` | `className="flex gap-2.5"` |
| `style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))' }}` | `className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))]"` |
| `style={{ fontSize: 13, color: 'var(--text-primary)' }}` | `className="text-base text-primary"` |
| `style={{ fontVariantNumeric: 'tabular-nums' }}` | `className="tabular-nums"` |
| `style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}` | `className="truncate"` |
| `style={{ border: '1px solid var(--border-subtle)', borderRadius: 10 }}` | `className="border border-line-subtle rounded-lg"` |

## Type scale (use these, not raw px)

| Tailwind class | px | Use for |
|---|---|---|
| `text-[10px]` (or `text-[9px]`) | 9–10 | Tiny labels, table headers |
| `text-xs` | 11 | Captions, secondary metadata |
| `text-sm` | 12 | Secondary body |
| `text-base` | 13 | Default body |
| `text-lg` | 14 | Emphasized body |
| `text-xl` | 16 | Subheadings |
| `text-2xl` | 20 | Section titles |
| `text-3xl` | 24 | Page titles |

## Radius scale (sharp personality — bank-demo appropriate)

| Tailwind class | px | Use for |
|---|---|---|
| `rounded-sm` | 4 | Tiny pills, status dots |
| `rounded` | 6 | Buttons, inputs, badges |
| `rounded-md` | 8 | Pills, small cards |
| `rounded-lg` | 10 | Cards, panels |
| `rounded-xl` | 12 | Modals, large containers |

## Color tokens (no raw hex anywhere)

| Tailwind class | Token | Use for |
|---|---|---|
| `text-primary` | `--text-primary` | Main text |
| `text-secondary` | `--text-secondary` | Secondary text |
| `text-muted` | `--text-tertiary` | Muted text, labels |
| `text-accent` | `--accent` | Links, active states |
| `text-status-rose` | `--rose` | Errors, danger |
| `text-status-amber` | `--amber` | Warnings |
| `text-status-violet` | `--violet` | Special / permissions |
| `bg-surface-base` | `--bg-base` | Page background |
| `bg-surface-raised` | `--bg-raised` | Cards |
| `bg-surface` | `--bg-surface` | Sub-surfaces (table headers) |
| `bg-surface-overlay` | `--bg-overlay` | Tags, inline pills |
| `bg-surface-hover` | `--bg-hover` | Row hover |
| `border-line-subtle` | `--border-subtle` | Default border |
| `border-line-muted` | `--border-muted` | Hover/active borders |
| `border-line-accent` | `--border-accent` | Selected borders |

## Z-index scale (no raw 9999s)

| Tailwind class | Use for |
|---|---|
| `z-dropdown` (50) | Select menus |
| `z-sticky` (100) | Sticky headers |
| `z-overlay` (200) | Backdrops |
| `z-modal` (300) | Dialogs |
| `z-popover` (400) | Floating popovers (resourcing popups) |
| `z-toast` (500) | Toasts, ConfirmDialog |

## Migration order (recommended)

Sweep in this order so reviewers can see consistency improving page-by-page:

1. ✅ **team** — done (reference)
2. **dashboard** — most-visited, sets the bar
3. **projects (list)** — already partially uses primitives
4. **projects/[id]** — biggest page; the most return on investment
5. **timesheets** — data-dense, hardest to migrate, do it carefully
6. **resourcing** — has popups, drag handlers; preserve those
7. **reports** — chart-heavy, most visual surface area
8. **admin** — biggest single file, most form patterns
9. **settings** — small, do last

## Rules

- **No `style={{}}` for layout/spacing/typography/color.** Tailwind only.
- **Inline `style` allowed for runtime computed values only:** dynamic widths
  for progress bars, dynamic grid templates, etc.
- **Reach for a primitive first.** If you're tempted to write a `<div>` that
  looks like a card, use `<Card>`. If you're tempted to write a colored span,
  use `<Badge>`.
- **Don't add new CSS variables.** The token set is final until we hit a real
  gap.
- **Don't add per-page helper functions** like `avatarColors` — `Avatar`
  already does it via `hashName`.
