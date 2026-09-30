-- Phase 3b — S3 attachments + per-user read receipts for support chat.
-- Idempotent (safe to re-run). Shared DB; both tap-app and tapapp-admin
-- read/write these tables via their own Prisma clients.
--
-- support_message_attachments: one row per file attached to a message.
--   S3 key is stored (not a public URL) so downloads always route through
--   a fresh presigned URL — attachments are private by default.
--
-- support_read_receipts: (thread_id, reader_type, reader_id) → last_read_at.
--   Used to derive unread counts: any message with created_at > last_read_at
--   is unread for that reader. Absent row = never read = everything is unread.

CREATE TABLE IF NOT EXISTS support_message_attachments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     UUID NOT NULL REFERENCES support_messages(id) ON DELETE CASCADE,
  s3_key         TEXT NOT NULL,
  file_name      VARCHAR(255) NOT NULL,
  content_type   VARCHAR(128) NOT NULL,
  size_bytes     BIGINT NOT NULL,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_message_attachments_message_idx
  ON support_message_attachments (message_id);

CREATE TABLE IF NOT EXISTS support_read_receipts (
  thread_id       UUID NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  reader_type     support_party_type NOT NULL,
  reader_id       VARCHAR(128) NOT NULL,
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, reader_type, reader_id)
);

CREATE INDEX IF NOT EXISTS support_read_receipts_reader_idx
  ON support_read_receipts (reader_type, reader_id);
