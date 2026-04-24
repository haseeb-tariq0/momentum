-- Tracks the last time a task was edited in Momentum itself (not from the
-- Forecast.it autosync). Used by apps/user-service/src/lib/forecastSync.ts
-- syncTasks: when local > forecast.updated_at, the sync skips the row so a
-- user's in-app status/billable/title edit isn't clobbered 15 min later by
-- whatever Forecast.it still holds.
--
-- Nullable for historical rows; the sync treats NULL as "never edited locally"
-- and falls back to the old behavior (Forecast wins).

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "locally_edited_at" TIMESTAMPTZ;

-- Indexed because syncTasks pre-fetches existing rows in bulk and compares
-- this timestamp inline. No index = seq-scan on a 53k-row table every 15 min.
CREATE INDEX IF NOT EXISTS "tasks_locally_edited_at_idx"
  ON "tasks"("locally_edited_at");
