-- Per-user OAuth refresh tokens for third-party integrations they connect
-- through Settings → Integrations.
--
-- First consumer: Google Drive / Sheets, so a user's "Export to Sheets"
-- creates the spreadsheet inside their own Drive (rather than the
-- workspace's shared service-account drive). Future providers (Dropbox,
-- OneDrive, etc.) plug in via the `provider` discriminator without
-- needing a migration.
--
-- The refresh token is stored encrypted (AES-256-GCM) so a DB dump alone
-- doesn't expose usable Google credentials — see encryptToken /
-- decryptToken in apps/user-service/src/lib/tokenCrypto.ts. The key
-- comes from OAUTH_TOKEN_ENC_KEY env (32-byte hex).
--
-- Soft-delete via revoked_at instead of DELETE so we keep an audit trail
-- of past grants. Reconnects UPDATE the existing row in place
-- (clearing revoked_at + storing a new token), which is why we keep the
-- (user_id, provider) UNIQUE constraint.

CREATE TABLE "user_oauth_grants" (
  "id"                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"           UUID         NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider"          TEXT         NOT NULL,
  "refresh_token_enc" TEXT         NOT NULL,
  "scopes"            TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "granted_email"     TEXT,
  "granted_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "last_used_at"      TIMESTAMPTZ,
  "revoked_at"        TIMESTAMPTZ,

  CONSTRAINT "user_oauth_grants_user_provider_key" UNIQUE ("user_id", "provider")
);

CREATE INDEX "user_oauth_grants_user_id_idx" ON "user_oauth_grants"("user_id");
-- Active grants are queried far more than revoked ones; partial index
-- keeps "is X connected?" checks fast even after years of revoke history.
CREATE INDEX "user_oauth_grants_active_idx"
  ON "user_oauth_grants"("user_id", "provider")
  WHERE "revoked_at" IS NULL;
