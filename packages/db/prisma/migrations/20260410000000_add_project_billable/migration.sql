-- Add `billable` column to projects table
-- Per April 9 Murtaza meeting: project-level billable/non-billable flag
-- Tasks created under a project will inherit this value as their default.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "billable" BOOLEAN NOT NULL DEFAULT true;
