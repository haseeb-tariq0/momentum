-- Cleanup: remove the 25 Forecast CLIENT + SYSTEM user records that were
-- accidentally imported as staff. These are:
--   - 21 CLIENT-type (external client-portal logins, e.g. @cognition.agency)
--   - 4 SYSTEM-type (API, Hubspot, Slack, Forecast Service User)
--
-- Source: scripts/forecast-audit-out/raw/persons.json (filtered by user_type).
-- Generated on 2026-04-23.
--
-- ─── IMPORTANT ───────────────────────────────────────────────────────────────
-- Apply the sync fix in apps/user-service/src/lib/forecastSync.ts FIRST.
-- Without the fix, the next 5-minute sync tick will restore these rows
-- (sync resets active=true and deleted_at=null from Forecast).
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── STEP 1 ── PREVIEW (read-only) ────────────────────────────────────────────
-- Run this alone first. Should return up to 25 rows — most likely just the
-- 6 CLIENT records that slipped past email-collision with staff.
SELECT id, email, name, forecast_id, active, deleted_at, created_at
FROM users
WHERE forecast_id IN (
  -- CLIENT type (21)
  636411, 634173, 636477, 638319, 642782, 638976, 650760, 634188, 643392,
  636402, 634192, 634253, 641607, 634194, 634187, 642036, 702238, 639030,
  647137, 634189, 634190,
  -- SYSTEM type (4)
  594362, 594354, 634047, 701416
)
ORDER BY name;


-- ─── STEP 2 ── DELETE (destructive) ───────────────────────────────────────────
-- Run only after reviewing Step 1's output.
-- If this errors out on foreign-key constraints (e.g. time_registrations
-- pointing at these user_ids), comment this out and use Step 2-ALT instead.
DELETE FROM users
WHERE forecast_id IN (
  636411, 634173, 636477, 638319, 642782, 638976, 650760, 634188, 643392,
  636402, 634192, 634253, 641607, 634194, 634187, 642036, 702238, 639030,
  647137, 634189, 634190,
  594362, 594354, 634047, 701416
);


-- ─── STEP 2-ALT ── SOFT DELETE (only if Step 2 fails on FK) ──────────────────
-- UPDATE users
-- SET active = false,
--     deleted_at = now()
-- WHERE forecast_id IN (
--   636411, 634173, 636477, 638319, 642782, 638976, 650760, 634188, 643392,
--   636402, 634192, 634253, 641607, 634194, 634187, 642036, 702238, 639030,
--   647137, 634189, 634190,
--   594362, 594354, 634047, 701416
-- );


-- ─── STEP 3 ── VERIFY ─────────────────────────────────────────────────────────
-- Expect: 54 active, 90 inactive, 144 total.
SELECT
  COUNT(*) FILTER (WHERE active = true  AND deleted_at IS NULL) AS active_count,
  COUNT(*) FILTER (WHERE active = false AND deleted_at IS NULL) AS inactive_count,
  COUNT(*) FILTER (WHERE deleted_at IS NULL)                    AS total_visible
FROM users;
