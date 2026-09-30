-- Phase 3a — Support chat tables (three-party threads: admin, merchant, supplier).
-- Shared Aurora DB; both tap-app and tapapp-admin read/write these tables via
-- their own Prisma clients. IDs are UUID; merchant/supplier tenant IDs are plain
-- UUID columns without FK because those live in tap-app's model space, not here.
-- Admin user IDs use FK ON DELETE SET NULL so removing an admin does not
-- cascade-delete their threads or history.
--
-- Idempotent: safe to re-run. Use DO $$ blocks for enums (no CREATE TYPE IF
-- NOT EXISTS in Postgres) and IF NOT EXISTS for tables/indexes.
--
-- Run once against the shared DB. Do NOT re-run inside tap-app's migrations
-- folder; both apps see the same tables.

DO $$ BEGIN
  CREATE TYPE support_thread_status AS ENUM (
    'OPEN',
    'WAITING_MERCHANT',
    'WAITING_SUPPLIER',
    'WAITING_ADMIN',
    'RESOLVED',
    'CLOSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE support_party_type AS ENUM (
    'ADMIN',
    'MERCHANT',
    'SUPPLIER',
    'SYSTEM'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE support_entity_type AS ENUM (
    'MERCHANT_APPLICATION',
    'PURCHASE_ORDER',
    'TRANSACTION'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS support_threads (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject              VARCHAR(255) NOT NULL,
  status               support_thread_status NOT NULL DEFAULT 'OPEN',
  entity_type          support_entity_type,
  entity_id            VARCHAR(128),
  merchant_tenant_id   UUID,
  supplier_tenant_id   UUID,
  created_by_type      support_party_type NOT NULL,
  created_by_admin_id  UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_by_user_id   VARCHAR(128),
  created_by_name      VARCHAR(255),
  assigned_admin_id    UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  last_message_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_threads_status_last_msg_idx
  ON support_threads (status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS support_threads_merchant_idx
  ON support_threads (merchant_tenant_id, last_message_at DESC)
  WHERE merchant_tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS support_threads_supplier_idx
  ON support_threads (supplier_tenant_id, last_message_at DESC)
  WHERE supplier_tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS support_threads_entity_idx
  ON support_threads (entity_type, entity_id)
  WHERE entity_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS support_threads_assigned_idx
  ON support_threads (assigned_admin_id)
  WHERE assigned_admin_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id      UUID NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  sender_type    support_party_type NOT NULL,
  sender_id      VARCHAR(128),
  sender_name    VARCHAR(255),
  body           TEXT NOT NULL,
  internal_note  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_messages_thread_idx
  ON support_messages (thread_id, created_at);
