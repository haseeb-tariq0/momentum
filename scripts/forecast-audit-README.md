# Forecast.it pre-migration audit

Read-only script that inventories everything in your Forecast workspace, flags data quality issues, and produces a report for review **before** we touch the database on the new app.

## Run it

```powershell
cd D:\forecast
node scripts/forecast-audit.mjs
```

Requires `FORECAST_API_KEY` in `.env.local` (already set).

## Runtime

Roughly **8–12 minutes** on a normal connection:
- Base entities (persons, clients, projects, rate cards, etc.): ~10 seconds
- Phases + tasks for 1,183 projects: ~5–7 minutes (2,366 API calls with throttle)
- Time registrations (164k entries, paginated): ~3 minutes (329 pages)

All calls are `GET` — zero writes, safe to re-run.

## What you get

```
scripts/forecast-audit-out/
├── audit-report.md      ← human-readable summary (this is what to read + show Murtaza)
├── audit-report.json    ← machine-readable, for diffing against post-import DB later
└── raw/
    ├── persons.json
    ├── clients.json
    ├── projects.json
    ├── time_registrations.json    (big — ~80 MB)
    ├── phases_by_project.json
    ├── tasks_by_project.json
    ├── rate_cards.json
    └── … all other entities
```

The `raw/` folder is your local snapshot — once saved, you can re-run analysis offline without hitting the API again. Gitignored by default.

## What the report checks

**Persons** — total count, active vs former, user type breakdown, missing fields (email / department / cost), duplicate emails/names, cost-per-hour outliers, system users flagged.

**Clients** — exact duplicates by normalized name, plus possible near-duplicates (one name contained in another, e.g. "Winter Valley" ↔ "Winter Valley For Real Estate Investment").

**Projects** — orphans with no client, rate-card coverage, budget-type distribution, stage distribution, full date range.

**Phases + Tasks** — count per project, unassigned tasks, tasks missing estimates/dates, flagged bugs/blocked/high-priority.

**Time registrations** — total hours (billable %), year-by-year distribution, linkage breakdown (task vs project vs leave vs orphan), anomalies (zero-minute entries, over-24-hour entries, system-user garbage that needs filtering during import).

**Reference data** — counts of departments, roles, labels, holidays, rate cards, deleted records.

**Importer checklist** — auto-generated list of things the import script must handle based on what the audit found.

## When to re-run

- Before any attempt at importing to Supabase
- Again after the Forecast.it subscription is renewed for migration month (to confirm nothing changed)
- Post-import: diff the audit JSON against the new DB to verify record counts match
