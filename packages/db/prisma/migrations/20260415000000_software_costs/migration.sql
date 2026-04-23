-- Software / subscription costs per department per month.
-- Synced from the Finance Sheet's Software_Costs tab (wide format: one row
-- per software+department with monthly columns). We unpivot on read so each
-- DB row is a single (software, department, month) fact.
--
-- Used as overhead cost in Client Profitability and Cost of Effort reports
-- so the numbers reflect true P&L (labor + software) not just labor.

CREATE TABLE IF NOT EXISTS "software_costs" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"       UUID NOT NULL REFERENCES "workspaces"("id"),
  "software_name"      TEXT NOT NULL,
  "department_raw"     TEXT NOT NULL,  -- raw name from sheet (e.g. "Social Media")
  "department_id"      UUID REFERENCES "departments"("id") ON DELETE SET NULL,
  "billing_frequency"  TEXT,           -- Monthly / Yearly / etc.
  "month"              DATE NOT NULL,  -- always first of month (YYYY-MM-01)
  "amount"             DECIMAL(12, 2) NOT NULL,
  "currency"           TEXT NOT NULL DEFAULT 'AED',
  "source_row_hash"    TEXT NOT NULL,  -- dedup key for idempotent re-syncs
  "created_at"         TIMESTAMPTZ DEFAULT now(),
  "updated_at"         TIMESTAMPTZ DEFAULT now()
);

-- Dedup: same (workspace, hash) = same row. Re-sync just no-ops.
CREATE UNIQUE INDEX IF NOT EXISTS "software_costs_ws_hash_uq"
  ON "software_costs" ("workspace_id", "source_row_hash");

-- Fast month aggregation
CREATE INDEX IF NOT EXISTS "software_costs_ws_month_idx"
  ON "software_costs" ("workspace_id", "month");

-- Fast department aggregation
CREATE INDEX IF NOT EXISTS "software_costs_dept_month_idx"
  ON "software_costs" ("department_id", "month");
