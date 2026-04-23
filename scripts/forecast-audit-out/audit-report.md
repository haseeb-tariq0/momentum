# Forecast.it Pre-Migration Audit Report

Generated: 2026-04-21T12:00:11.026Z  
Workspace data window: 2023-04-11T09:04:39Z → 2026-04-21T05:14:59Z  
Total records pulled: 165,730

---

## Executive summary

| Entity | Count | Notes |
|---|---:|---|
| Persons | 169 | 143 staff (53 active, 90 former), 21 client logins, 5 system |
| Clients | 341 | 6 exact duplicates, 7 possible near-duplicates |
| Projects | 1183 | 208 orphaned (no client), 510 without rate card |
| Phases | 4017 | avg 3.4 per project |
| Tasks | 53358 | 6628 unassigned, 11592 no estimate |
| Time entries | 164,037 | 276,302h total (73.9% billable) |

## Persons

- **169** total records — 143 staff, 21 client logins, 5 system users
- **53** active staff, **90** former
- Missing email: 0 · Missing department: 6 · Missing cost: 40

### Cost per hour (staff only)

Min **90** · Median **162** · Max **543**

**Cost outliers (> 400):**

- Moey Shawash (id 701514) — cost 543

### Duplicate names

- `monica condrache` → ids 642036, 704953 (may be same person rehired, or client-vs-staff)

## Clients

- **341** clients on record
- With address: 1 · With notes: 4
- Date range: 2023-03-31T12:39:47Z → 2026-04-16T10:50:18Z

### Exact duplicates (same normalized name) — **6 groups**

- **Jalapeno** × 2 → ids 168978, 196380
- **MOHAMED & OBAID ALMULLA GROUP** × 2 → ids 183211, 187223
- **E R E PROPERTY L.L.C** × 2 → ids 184516, 187359
- **Grey Wolf** × 2 → ids 195986, 195988
- **KS2** × 2 → ids 196070, 196071
- **Boo Boo Entertainment** × 2 → ids 197037, 197038

### Possible near-duplicates (one name contains the other) — **7 pairs**

- "EMIR" (id 168751) ↔ "The Emirates Academy of Hospitality Management" (id 168911)
- "EMIR" (id 168751) ↔ "Coface Emirates Services" (id 214415)
- "Nexa" (id 169353) ↔ "MAZ NEXA" (id 169354)
- "Nexa" (id 169353) ↔ "Nexa Cognition" (id 193144)
- "Nexa" (id 169353) ↔ "NEXA AI Labs" (id 202899)
- "princ" (id 171429) ↔ "Princeton" (id 172624)
- "Winter Valley" (id 173332) ↔ "Winter Valley For Real Estate Investment" (id 173771)

## Projects

- **1183** total · **975** with client · **208** orphans
- Rate card coverage: **673** / 1183 (57%)
- Budget coverage: **890** / 1183 (75%)
- Billable: 1161 / 1183

### By stage

- DONE: 766
- HALTED: 50
- OPPORTUNITY: 165
- RUNNING: 184
- PLANNING: 18

### By budget type

- TIME_AND_MATERIALS: 246
- FIXED_PRICE_V2: 605
- RETAINER: 310
- NON_BILLABLE: 22

### Date ranges

- Projects created: 2023-04-11T09:04:39Z → 2026-04-21T05:14:59Z
- Project start dates: 2022-02-01 → 2026-05-01
- Project end dates: 2023-05-31 → 2027-04-01

## Phases & Tasks

- **4017** phases across 949 projects (avg 3.4)
- **53,358** tasks across 972 projects (avg 45.1)
- 6628 unassigned · 11592 no estimate · 358 no dates
- 6 flagged as bug · 17 blocked · 60 high priority

## Time registrations

- **164,037** total entries
- **276,302h** total logged (**204,301h** billable = 73.9%)
- Date range: 2023-04-04 → 2026-11-30

### Linkage breakdown

- With task (→ phase → project): 154,148
- With project directly: 11
- With non-project time (leave): 9,878
- **Orphans (no task/project/leave): 0**

### By year

- 2023: 25,897 entries
- 2024: 52,221 entries
- 2025: 65,117 entries
- 2026: 20,802 entries

### Anomalies

- Zero-minute entries: 6636
- Over-24-hour entries: **51** (impossible — likely bulk imports)
- Entries from system users: 187
- **Garbage entries (system user + >16h): 51** — recommend skipping these during import

**Sample of garbage entries:**

| id | person | date | hours |
|---|---:|---|---:|
| 28565126 | 594346 | 2023-06-20 | 94 |
| 28565717 | 594346 | 2023-06-20 | 23 |
| 28565876 | 594346 | 2023-06-20 | 40 |
| 28909875 | 594346 | 2023-06-30 | 33 |
| 28969451 | 594346 | 2023-06-30 | 198 |
| 29085005 | 594346 | 2023-06-27 | 62 |
| 29112931 | 594346 | 2023-06-20 | 18 |
| 29163386 | 594346 | 2023-07-20 | 30 |
| 29165569 | 594346 | 2023-07-19 | 73 |
| 29187239 | 594346 | 2023-06-29 | 23 |
| 29251320 | 594346 | 2023-06-22 | 99 |
| 29272444 | 594346 | 2023-06-22 | 87 |
| 29272454 | 594346 | 2023-04-13 | 211 |
| 29272470 | 594346 | 2023-06-06 | 303 |
| 29272476 | 594346 | 2023-06-20 | 89 |
| 29272508 | 594346 | 2023-05-17 | 24 |
| 29272511 | 594346 | 2023-06-15 | 59 |
| 29272567 | 594346 | 2023-06-14 | 59 |
| 29272569 | 594346 | 2023-06-14 | 38 |
| 29272577 | 594346 | 2023-06-08 | 336 |

## Reference data

| Type | Count |
|---|---:|
| Departments | 10 |
| Roles | 45 |
| Labels | 81 |
| Holiday calendars | 20 |
| Non-project time categories | 17 |
| Person cost periods (historical) | 170 |
| Rate cards | 24 (31 versions across them) |
| Deleted records | 0 |

## Importer to-do checklist

Based on this audit, the import script must handle the following:

1. Dedupe **6** exact-duplicate client groups before import
2. Manually review 7 possible near-duplicate client pairs
3. Decide fate of **208** orphan projects (no client) — skip or assign to placeholder?
4. Flag **510** projects with no rate card — cost-of-effort won't resolve
5. Map OPPORTUNITY/PLANNING stages to new enum (currently running/halted/done)
6. Map FIXED_PRICE_V2 → fixed_price, NON_BILLABLE → billable=false
7. **Skip 51 garbage time entries** (system user + >16h)
8. Convert time from minutes → hours (÷60) on insert
9. Join time entries via task → phase → project (NOT direct time_entry.project which is always null)
10. Use /v3/projects/{id}/tasks for tasks (v1 returns 404)
11. Use /v4/time_registrations for time entries (v3 deprecated)

---

Raw JSON dumps: `./forecast-audit-out/raw/`
Machine-readable summary: `./forecast-audit-out/audit-report.json`
