-- Project templates: predefined phases + tasks that can be applied once
-- at project creation time. Apr 15 2026 meeting with Murtaza — tasks get
-- copied into the project, so later edits to the template don't touch
-- existing projects (and vice versa).

CREATE TABLE IF NOT EXISTS "project_templates" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id"),
  "name"         TEXT NOT NULL,
  "description"  TEXT,
  "color"        TEXT NOT NULL DEFAULT '#0D9488',
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deleted_at"   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "project_templates_ws_idx"
  ON "project_templates" ("workspace_id");

CREATE TABLE IF NOT EXISTS "template_phases" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" UUID NOT NULL REFERENCES "project_templates"("id") ON DELETE CASCADE,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "sort_order"  INT NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "template_phases_template_idx"
  ON "template_phases" ("template_id");

CREATE TABLE IF NOT EXISTS "template_tasks" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_phase_id" UUID NOT NULL REFERENCES "template_phases"("id") ON DELETE CASCADE,
  "title"             TEXT NOT NULL,
  "description"       TEXT,
  "estimated_hrs"     DECIMAL(6,2),
  "billable"          BOOLEAN NOT NULL DEFAULT true,
  "sort_order"        INT NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "template_tasks_phase_idx"
  ON "template_tasks" ("template_phase_id");
