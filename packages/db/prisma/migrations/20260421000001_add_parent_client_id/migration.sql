-- Sub-client schema (Apr 17 meeting with Murtaza) — lets accounts like
-- Nexa Cognition own sub-clients like Redwood or Bisco.
--
-- ON DELETE SET NULL: deleting a parent orphans children up to top-level
-- rather than cascading the delete. If Nexa Cognition is soft-deleted, its
-- children become top-level clients — preserving their projects and invoices.

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "parent_client_id" UUID;

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_parent_client_id_fkey"
  FOREIGN KEY ("parent_client_id")
  REFERENCES "clients"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "clients_parent_client_id_idx"
  ON "clients"("parent_client_id");
