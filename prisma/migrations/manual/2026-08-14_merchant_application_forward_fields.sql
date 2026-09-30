-- ============================================================================
-- Phase 2d (2026-08-14) — extra bookkeeping columns for the KYB
-- "Forward to processor" flow. All idempotent so the migration is safe to
-- re-run and safe to apply out of order relative to the earlier Phase 2b
-- rename migration.
--
-- Adds four columns to merchant_applications, all nullable:
--   forwarded_to_processor    payment processor we sent the bundle to
--   forwarded_by_admin_id     which admin_user actioned the forward
--   forward_bundle_s3_key     S3 key where the ZIP bundle lives (audit)
--   processor_message_id      SES MessageId of the outbound email (audit)
--
-- The existing forwarded_to_email + forwarded_at columns from Phase C carry
-- the destination address and timestamp. Nothing here is destructive.
--
-- Deploy order (both DBs share the same cluster; this file lives in BOTH
-- tap-app and tapapp-admin migrations folders — running it once is enough):
--   1) psql -f this file
--   2) Deploy tap-app + tapapp-admin code with the matching schema.prisma updates
--   3) Restart PM2
-- ============================================================================

ALTER TABLE "merchant_applications"
  ADD COLUMN IF NOT EXISTS "forwarded_to_processor" "PaymentProcessor";

ALTER TABLE "merchant_applications"
  ADD COLUMN IF NOT EXISTS "forwarded_by_admin_id" UUID;

ALTER TABLE "merchant_applications"
  ADD COLUMN IF NOT EXISTS "forward_bundle_s3_key" VARCHAR(500);

ALTER TABLE "merchant_applications"
  ADD COLUMN IF NOT EXISTS "processor_message_id" VARCHAR(255);

-- Index the admin id so we can quickly answer "what has this admin forwarded".
CREATE INDEX IF NOT EXISTS "merchant_applications_forwarded_by_admin_id_idx"
  ON "merchant_applications" ("forwarded_by_admin_id");
