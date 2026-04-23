-- Client invoices — imported from NEXA Finance Sheet (Client_Revenue tab)
-- Provides the "Revenue" side of client profitability reports

CREATE TABLE IF NOT EXISTS "client_invoices" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"      UUID NOT NULL REFERENCES "workspaces"("id"),
  "client_id"         UUID REFERENCES "clients"("id") ON DELETE SET NULL,
  "month"             DATE NOT NULL, -- always first day of month (YYYY-MM-01)
  "invoice_date"      DATE,
  "invoice_no"        TEXT,
  "client_name_raw"   TEXT NOT NULL, -- raw name from sheet, for unmatched mapping later
  "sales_person"      TEXT,
  "service_department" TEXT, -- as string from sheet (e.g. "Social Media")
  "service_category"  TEXT,
  "type"              TEXT, -- Retainer / Project / etc
  "classification"    TEXT, -- New / Existing / Upsell
  "services_detail"   TEXT,
  "sales_amount"      DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "third_party"       DECIMAL(12, 2),
  "advertising_budget" DECIMAL(12, 2),
  "currency"          TEXT NOT NULL DEFAULT 'AED',
  "source_row_hash"   TEXT NOT NULL, -- dedupe key: sha256 of canonical row
  "created_at"        TIMESTAMPTZ DEFAULT now(),
  "updated_at"        TIMESTAMPTZ DEFAULT now()
);

-- Dedupe: same row hash in same workspace = same invoice line (skip on re-import)
CREATE UNIQUE INDEX IF NOT EXISTS "client_invoices_ws_hash_uq"
  ON "client_invoices" ("workspace_id", "source_row_hash");

CREATE INDEX IF NOT EXISTS "client_invoices_ws_month_idx"
  ON "client_invoices" ("workspace_id", "month");

CREATE INDEX IF NOT EXISTS "client_invoices_client_month_idx"
  ON "client_invoices" ("client_id", "month");
