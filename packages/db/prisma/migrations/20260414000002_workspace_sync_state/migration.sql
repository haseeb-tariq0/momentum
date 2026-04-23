-- Per-workspace sync state blob (JSON). Stores integration status, last sync times, errors, etc.
-- Example contents:
--   {
--     "finance_sheet": {
--       "spreadsheetId": "1a5b...FFOw",
--       "sheetTitle":    "NEXA 2026 Finance Sheet",
--       "lastSyncAt":    "2026-04-14T10:22:00Z",
--       "lastSyncResult": { "inserted": 2, "alreadyExisted": 4872, "unmatched": 3 },
--       "lastError":     null
--     }
--   }

ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "sync_state" JSONB NOT NULL DEFAULT '{}'::jsonb;
