-- Add department_id to rate_card_entries so rates can be looked up by department
-- (matching Murtaza's actual partner report format where rate = team rate, regardless of person's job title)

ALTER TABLE "rate_card_entries"
  ADD COLUMN IF NOT EXISTS "department_id" UUID REFERENCES "departments"("id") ON DELETE SET NULL;

-- Allow job_title to be nullable (we're migrating away from it)
ALTER TABLE "rate_card_entries" ALTER COLUMN "job_title" DROP NOT NULL;

-- Drop old unique constraint on (rate_card_id, job_title) if present
ALTER TABLE "rate_card_entries" DROP CONSTRAINT IF EXISTS "rate_card_entries_rate_card_id_job_title_key";

-- New constraint: one rate per (card, department)
CREATE UNIQUE INDEX IF NOT EXISTS "rate_card_entries_card_dept_uq"
  ON "rate_card_entries" ("rate_card_id", "department_id")
  WHERE "department_id" IS NOT NULL;

-- Keep old unique as partial index for legacy job-title entries
CREATE UNIQUE INDEX IF NOT EXISTS "rate_card_entries_card_title_uq"
  ON "rate_card_entries" ("rate_card_id", "job_title")
  WHERE "department_id" IS NULL AND "job_title" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "rate_card_entries_department_idx" ON "rate_card_entries" ("department_id");
