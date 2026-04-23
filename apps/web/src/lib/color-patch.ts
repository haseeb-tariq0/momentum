// Timesheets and resourcing pages use var(--accent) and var(--accent-dim) which now map to blue.
// The only remaining hardcoded rgba greens to patch are inline in resourcing/page.tsx day cells.
// Patch: replace rgba(0,212,180,...) with var(--accent-dim) / var(--accent) references.
// This file acts as a note — actual fix is done inline in resourcing page below.
export {}
