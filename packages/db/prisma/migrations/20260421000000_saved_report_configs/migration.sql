-- Saved report configs — per-user favorites for the Reports module.
-- Apr 17 2026 meeting with Murtaza: "account managers save report views
-- as templates, pick them up next time without rebuilding." Replaces a
-- localStorage-only implementation that lost saved configs on browser
-- switch or cache clear.
--
-- `config` is a JSON blob so we can extend the saved view (filters,
-- column selections, date range) without schema churn.

CREATE TABLE IF NOT EXISTS "saved_report_configs" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id"),
  "user_id"      UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"         TEXT NOT NULL,
  "report_type"  TEXT NOT NULL,
  "config"       JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User's favorites lookup: the common query is "all my configs."
CREATE INDEX IF NOT EXISTS "saved_report_configs_user_idx"
  ON "saved_report_configs" ("user_id", "created_at" DESC);

-- Workspace scope still indexed for admin-level listing / analytics.
CREATE INDEX IF NOT EXISTS "saved_report_configs_ws_idx"
  ON "saved_report_configs" ("workspace_id");

-- A user shouldn't end up with two favorites under the same name — the
-- UI treats name as the identity shown in the favorites grid.
CREATE UNIQUE INDEX IF NOT EXISTS "saved_report_configs_user_name_uq"
  ON "saved_report_configs" ("user_id", "name");
