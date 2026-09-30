-- ============================================================================
-- Phase 2b — merchant / supplier application rename + granular KYB tables.
-- Apply manually via psql from EC2 (DB is on a private VPC — the build host
-- cannot reach it, so no auto-migrate).
--
-- Migration is IDEMPOTENT — every step is guarded and safe to re-run. The
-- companion Node script `tapapp-admin/scripts/backfill-ubos.ts` handles
-- decrypting `beneficial_owners_enc` into `ubo_records` rows separately,
-- because SQL cannot access the AES-GCM key.
--
-- Order matters — enums are created before columns that use them; renames
-- happen before ALTERs on new column names; the partial unique index for
-- "one ACTIVE per (tenant, capability)" comes last so it doesn't fire on
-- rows in the middle of being backfilled.
--
-- Deploy order:
--   1) Run this SQL.
--   2) Deploy the tap-app + tapapp-admin code (which use the new model names).
--   3) Run `npx tsx scripts/backfill-ubos.ts` from tapapp-admin.
--   4) Verify counts in ubo_records + review a couple detail pages.
--   5) Leave beneficial_owners_enc column in place for one release cycle.
--
-- TODO(2026-09): once the backfill has been verified in prod for at least
-- one release cycle, drop the beneficial_owners_enc column with:
--   ALTER TABLE merchant_applications DROP COLUMN IF EXISTS beneficial_owners_enc;
-- ============================================================================

-- ----- 1. New enums (create before any column references them) -------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TenantRole') THEN
    CREATE TYPE "TenantRole" AS ENUM ('MERCHANT', 'SUPPLIER');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TenantPaymentCapability') THEN
    CREATE TYPE "TenantPaymentCapability" AS ENUM ('CARD', 'INTERAC', 'GIFT_CARD', 'ACH');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KybDocType') THEN
    CREATE TYPE "KybDocType" AS ENUM (
      'ARTICLES_OF_INCORPORATION',
      'BUSINESS_LICENSE',
      'VOID_CHEQUE',
      'BANK_STATEMENT',
      'UBO_ID_FRONT',
      'UBO_ID_BACK',
      'UBO_PROOF_OF_ADDRESS',
      'DIRECTOR_ID',
      'TAX_RETURN',
      'GST_HST_REGISTRATION',
      'OTHER'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UboIdType') THEN
    CREATE TYPE "UboIdType" AS ENUM ('PASSPORT', 'DRIVERS_LICENSE', 'NATIONAL_ID');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EventActorType') THEN
    CREATE TYPE "EventActorType" AS ENUM ('MERCHANT', 'ADMIN', 'PROCESSOR', 'SYSTEM');
  END IF;
END$$;

-- ----- 2. Extend GatewayApplicationStatus with the two new states ----------
-- INFO_REQUESTED was already in the enum from Phase C; only add what's new.
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is safe to re-run.
ALTER TYPE "GatewayApplicationStatus" ADD VALUE IF NOT EXISTS 'PROVIDER_APPROVED';
ALTER TYPE "GatewayApplicationStatus" ADD VALUE IF NOT EXISTS 'LIVE';

-- ----- 3. Rename payment_gateway_applications -> merchant_applications -----
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'payment_gateway_applications'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'merchant_applications'
  ) THEN
    ALTER TABLE "payment_gateway_applications" RENAME TO "merchant_applications";
  END IF;
END$$;

-- Rename supplier_tenant_id column -> tenant_id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchant_applications' AND column_name = 'supplier_tenant_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'merchant_applications' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE "merchant_applications" RENAME COLUMN "supplier_tenant_id" TO "tenant_id";
  END IF;
END$$;

-- Rename the FK constraint too so pg_dump doesn't complain about stale name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_gateway_applications_supplier_tenant_id_fkey'
  ) THEN
    ALTER TABLE "merchant_applications"
      RENAME CONSTRAINT "payment_gateway_applications_supplier_tenant_id_fkey"
      TO "merchant_applications_tenant_id_fkey";
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_gateway_applications_created_by_membership_id_fkey'
  ) THEN
    ALTER TABLE "merchant_applications"
      RENAME CONSTRAINT "payment_gateway_applications_created_by_membership_id_fkey"
      TO "merchant_applications_created_by_membership_id_fkey";
  END IF;
END$$;

-- Add tenant_role column (default SUPPLIER — every legacy row is a supplier).
ALTER TABLE "merchant_applications"
  ADD COLUMN IF NOT EXISTS "tenant_role" "TenantRole" NOT NULL DEFAULT 'SUPPLIER';

-- Drop old indexes tied to the old table/column names, rebuild on new names.
DROP INDEX IF EXISTS "payment_gateway_applications_supplier_tenant_id_status_idx";
DROP INDEX IF EXISTS "payment_gateway_applications_status_submitted_at_idx";

CREATE INDEX IF NOT EXISTS "merchant_applications_tenant_id_status_idx"
  ON "merchant_applications" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "merchant_applications_status_submitted_at_idx"
  ON "merchant_applications" ("status", "submitted_at" DESC);
CREATE INDEX IF NOT EXISTS "merchant_applications_tenant_role_status_idx"
  ON "merchant_applications" ("tenant_role", "status");

-- ----- 4. Rename supplier_processors -> tenant_payment_providers -----------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'supplier_processors'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'tenant_payment_providers'
  ) THEN
    ALTER TABLE "supplier_processors" RENAME TO "tenant_payment_providers";
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenant_payment_providers' AND column_name = 'supplier_tenant_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenant_payment_providers' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE "tenant_payment_providers" RENAME COLUMN "supplier_tenant_id" TO "tenant_id";
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplier_processors_supplier_tenant_id_fkey'
  ) THEN
    ALTER TABLE "tenant_payment_providers"
      RENAME CONSTRAINT "supplier_processors_supplier_tenant_id_fkey"
      TO "tenant_payment_providers_tenant_id_fkey";
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplier_processors_application_id_fkey'
  ) THEN
    ALTER TABLE "tenant_payment_providers"
      RENAME CONSTRAINT "supplier_processors_application_id_fkey"
      TO "tenant_payment_providers_application_id_fkey";
  END IF;
END$$;

-- Add capability column (default CARD — all legacy suppliers were card-only).
ALTER TABLE "tenant_payment_providers"
  ADD COLUMN IF NOT EXISTS "capability" "TenantPaymentCapability" NOT NULL DEFAULT 'CARD';

-- Drop legacy indexes + unique.
DROP INDEX IF EXISTS "supplier_processors_supplier_tenant_id_status_idx";

-- Drop the old (supplier_tenant_id, processor) unique constraint — replaced
-- by (tenant_id, capability, processor) below. Both possible legacy names
-- are handled because Prisma versions differ on the auto-generated name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplier_processors_supplier_tenant_id_processor_key'
  ) THEN
    ALTER TABLE "tenant_payment_providers"
      DROP CONSTRAINT "supplier_processors_supplier_tenant_id_processor_key";
  END IF;
END$$;

DROP INDEX IF EXISTS "supplier_processors_supplier_tenant_id_processor_key";

-- Fresh indexes on new names.
CREATE INDEX IF NOT EXISTS "tenant_payment_providers_tenant_id_status_idx"
  ON "tenant_payment_providers" ("tenant_id", "status");

-- New unique (tenant, capability, processor). Named to match Prisma's
-- generated pattern so `prisma generate` picks it up without a follow-up.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_payment_providers_tenant_id_capability_processor_key'
  ) THEN
    ALTER TABLE "tenant_payment_providers"
      ADD CONSTRAINT "tenant_payment_providers_tenant_id_capability_processor_key"
      UNIQUE ("tenant_id", "capability", "processor");
  END IF;
END$$;

-- ----- 5. New tables: kyb_documents / ubo_records / application_events ----
CREATE TABLE IF NOT EXISTS "kyb_documents" (
  "id"                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id"              UUID NOT NULL,
  "doc_type"                    "KybDocType" NOT NULL,
  "s3_key"                      VARCHAR(500) NOT NULL,
  "original_filename"           VARCHAR(255) NOT NULL,
  "mime_type"                   VARCHAR(100) NOT NULL,
  "size_bytes"                  INTEGER NOT NULL,
  "sha256"                      VARCHAR(64) NOT NULL,
  "uploaded_by_membership_id"   UUID,
  "scan_status"                 VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "deleted_at"                  TIMESTAMP(3),
  "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kyb_documents_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "merchant_applications"("id") ON DELETE CASCADE,
  CONSTRAINT "kyb_documents_uploaded_by_membership_id_fkey"
    FOREIGN KEY ("uploaded_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "kyb_documents_application_id_doc_type_idx"
  ON "kyb_documents" ("application_id", "doc_type");

CREATE TABLE IF NOT EXISTS "ubo_records" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id"        UUID NOT NULL,
  "full_name"             VARCHAR(150) NOT NULL,
  "date_of_birth"         DATE NOT NULL,
  "nationality"           VARCHAR(3) NOT NULL,
  "residential_address"   JSONB NOT NULL,
  "ownership_pct"         DECIMAL(5,2) NOT NULL,
  "is_director"           BOOLEAN NOT NULL DEFAULT false,
  "is_signatory"          BOOLEAN NOT NULL DEFAULT false,
  "id_type"               "UboIdType" NOT NULL,
  "id_number_enc"         TEXT NOT NULL,
  "id_expiry"             DATE,
  "id_issuing_country"    VARCHAR(3),
  "source_of_funds"       VARCHAR(200),
  "is_pep"                BOOLEAN NOT NULL DEFAULT false,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ubo_records_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "merchant_applications"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "ubo_records_application_id_idx"
  ON "ubo_records" ("application_id");

CREATE TABLE IF NOT EXISTS "application_events" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id"  UUID NOT NULL,
  "from_status"     VARCHAR(30),
  "to_status"       VARCHAR(30) NOT NULL,
  "actor_type"      "EventActorType" NOT NULL,
  "actor_id"        VARCHAR(64),
  "note"            TEXT,
  "at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "application_events_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "merchant_applications"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "application_events_application_id_at_idx"
  ON "application_events" ("application_id", "at");

-- ----- 6. Partial unique — one ACTIVE row per (tenant, capability) ---------
-- Applied last so backfill loads (which briefly may leave two ACTIVE rows in
-- flight during a manual DB rewrite) don't trip it. Prisma cannot express
-- a WHERE-filtered index, hence the raw SQL.
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_payment_providers_active_per_tenant_capability_uniq"
  ON "tenant_payment_providers" ("tenant_id", "capability")
  WHERE "status" = 'ACTIVE';

-- ----- 7. beneficial_owners_enc — left in place -----------------------------
-- Do NOT drop. The Node backfill script decrypts this column into
-- ubo_records rows, then blanks the column value (SET beneficial_owners_enc
-- = NULL) so residual PII isn't sitting around. The column itself stays
-- for one release cycle in case we need to rollback. See TODO at the top
-- of this file for the drop instruction.
