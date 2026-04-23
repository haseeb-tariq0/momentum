-- Add human-readable client code (CLT-001, CLT-002, etc.)
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "client_code" TEXT;

-- Backfill existing clients with codes based on creation order per workspace
WITH numbered AS (
  SELECT id, workspace_id,
         'CLT-' || LPAD(ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at)::TEXT, 3, '0') AS code
  FROM clients
  WHERE client_code IS NULL
)
UPDATE clients SET client_code = numbered.code
FROM numbered WHERE clients.id = numbered.id;
