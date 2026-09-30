-- Admin platform tables — apply manually via psql from EC2.
-- Idempotent: safe to re-run. Creates AdminRole enum + 3 tables.

-- AdminRole enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AdminRole') THEN
    CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'COMPLIANCE', 'SUPPORT', 'SALES', 'FINANCE');
  END IF;
END$$;

-- admin_users
CREATE TABLE IF NOT EXISTS "admin_users" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"          VARCHAR(255) NOT NULL UNIQUE,
  "first_name"     VARCHAR(100),
  "last_name"      VARCHAR(100),
  "password_hash"  VARCHAR(255) NOT NULL,
  "role"           "AdminRole" NOT NULL DEFAULT 'SUPPORT',
  "is_active"      BOOLEAN NOT NULL DEFAULT true,
  "mfa_secret"     VARCHAR(128),
  "last_login_at"  TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- admin_audit_logs
CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "admin_user_id"  UUID NOT NULL,
  "action"         VARCHAR(64) NOT NULL,
  "resource_type"  VARCHAR(64),
  "resource_id"    VARCHAR(128),
  "before"         JSONB,
  "after"          JSONB,
  "ip_address"     VARCHAR(45),
  "user_agent"     TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_logs_admin_user_id_fkey"
    FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "admin_audit_logs_admin_user_id_created_at_idx"
  ON "admin_audit_logs"("admin_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "admin_audit_logs_resource_type_resource_id_idx"
  ON "admin_audit_logs"("resource_type", "resource_id");

-- admin_login_attempts
CREATE TABLE IF NOT EXISTS "admin_login_attempts" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"           VARCHAR(255) NOT NULL,
  "succeeded"       BOOLEAN NOT NULL,
  "failure_reason"  VARCHAR(100),
  "ip_address"      VARCHAR(45),
  "user_agent"      TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "admin_login_attempts_email_created_at_idx"
  ON "admin_login_attempts"("email", "created_at");
