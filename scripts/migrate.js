import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config();
const { Pool } = pkg;
const SCHEMA_VERSION = '2026-08-11-api-owned-v3';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: String(process.env.DATABASE_SSL || 'true').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'true' }
    : false,
});

const sql = `
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('qrv-api-schema-v2'));

CREATE TABLE IF NOT EXISTS qrv_schema_migrations (
  version VARCHAR(80) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS qrv_record_seq START 1;

CREATE TABLE IF NOT EXISTS qr_issuers (
  id BIGSERIAL PRIMARY KEY,
  issuer_id VARCHAR(120) UNIQUE NOT NULL,
  issuer_name VARCHAR(255) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'active',
  public_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE qr_issuers ADD COLUMN IF NOT EXISTS public_key TEXT;

INSERT INTO qr_issuers (issuer_id, issuer_name, status)
VALUES ('legacy-unassigned', 'Legacy Unassigned Issuer', 'suspended')
ON CONFLICT (issuer_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS qr_objects (
  id BIGSERIAL PRIMARY KEY,
  qrvid VARCHAR(160) UNIQUE NOT NULL,
  record_type VARCHAR(80) NOT NULL,
  issuer_id VARCHAR(120) REFERENCES qr_issuers(issuer_id),
  issuer VARCHAR(255) NOT NULL,
  owner VARCHAR(255),
  title VARCHAR(255),
  description TEXT,
  payload JSONB,
  hash TEXT NOT NULL,
  signature TEXT,
  signature_algorithm VARCHAR(40) NOT NULL DEFAULT 'ed25519',
  status VARCHAR(40) NOT NULL DEFAULT 'active',
  visibility VARCHAR(32) NOT NULL DEFAULT 'public',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS issuer_id VARCHAR(120) REFERENCES qr_issuers(issuer_id);
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS signature TEXT;
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS signature_algorithm VARCHAR(40) NOT NULL DEFAULT 'ed25519';
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS visibility VARCHAR(32) NOT NULL DEFAULT 'public';
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS revocation_reason TEXT;
UPDATE qr_objects SET issuer_id='legacy-unassigned' WHERE issuer_id IS NULL;
UPDATE qr_objects SET visibility='private' WHERE LOWER(COALESCE(visibility,'')) NOT IN ('public','restricted','private');
UPDATE qr_objects
SET visibility='private', status='invalid', updated_at=NOW()
WHERE payload IS NULL AND issuer_id='legacy-unassigned';

DO $$
DECLARE
  maximum_sequence BIGINT;
BEGIN
  SELECT MAX((regexp_match(qrvid, '([0-9]+)$'))[1]::BIGINT)
  INTO maximum_sequence
  FROM qr_objects
  WHERE qrvid ~ '[0-9]+$';

  IF maximum_sequence IS NULL THEN
    PERFORM setval('qrv_record_seq', 1, false);
  ELSE
    PERFORM setval('qrv_record_seq', maximum_sequence, true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS qr_audit_log (
  id BIGSERIAL PRIMARY KEY,
  qrvid VARCHAR(160),
  issuer_id VARCHAR(120),
  event_type VARCHAR(80) NOT NULL,
  actor VARCHAR(255),
  source_service VARCHAR(120) NOT NULL DEFAULT 'qrv-api',
  result VARCHAR(40),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE qr_audit_log ADD COLUMN IF NOT EXISTS issuer_id VARCHAR(120);
ALTER TABLE qr_audit_log ADD COLUMN IF NOT EXISTS actor VARCHAR(255);
ALTER TABLE qr_audit_log ADD COLUMN IF NOT EXISTS source_service VARCHAR(120) NOT NULL DEFAULT 'qrv-api';
ALTER TABLE qr_audit_log ADD COLUMN IF NOT EXISTS result VARCHAR(40);
ALTER TABLE qr_audit_log ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS qr_hash_registry (
  id BIGSERIAL PRIMARY KEY,
  qrvid VARCHAR(160) NOT NULL,
  hash TEXT NOT NULL,
  algorithm VARCHAR(40) NOT NULL DEFAULT 'sha256',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (qrvid, hash)
);

CREATE TABLE IF NOT EXISTS qr_certificates (
  id BIGSERIAL PRIMARY KEY,
  qrvid VARCHAR(160) UNIQUE NOT NULL,
  issuer_id VARCHAR(120),
  recipient_name VARCHAR(255) NOT NULL DEFAULT '',
  certificate_title VARCHAR(255) NOT NULL DEFAULT '',
  issuer_name VARCHAR(255) NOT NULL DEFAULT '',
  issue_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expiration_date TIMESTAMPTZ,
  status VARCHAR(40) NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE qr_certificates ADD COLUMN IF NOT EXISTS issuer_id VARCHAR(120);
ALTER TABLE qr_certificates ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'active';
ALTER TABLE qr_certificates ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_qr_objects_status ON qr_objects(status);
CREATE INDEX IF NOT EXISTS idx_qr_objects_hash ON qr_objects(hash);
CREATE INDEX IF NOT EXISTS idx_qr_objects_issuer_id ON qr_objects(issuer_id);
CREATE INDEX IF NOT EXISTS idx_qr_objects_expires_at ON qr_objects(expires_at);
CREATE INDEX IF NOT EXISTS idx_qr_audit_qrvid ON qr_audit_log(qrvid);
CREATE INDEX IF NOT EXISTS idx_qr_audit_issuer_id ON qr_audit_log(issuer_id);
CREATE INDEX IF NOT EXISTS idx_qr_audit_created ON qr_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qr_hash_registry_hash ON qr_hash_registry(hash);
CREATE INDEX IF NOT EXISTS idx_qr_certificates_issuer_id ON qr_certificates(issuer_id);

DROP VIEW IF EXISTS registry_records;
CREATE VIEW registry_records AS
SELECT qrvid, record_type AS "recordType", issuer_id AS "issuerId", issuer, owner,
  title, hash, signature, visibility,
  CASE
    WHEN revoked_at IS NOT NULL OR LOWER(COALESCE(status,''))='revoked' THEN 'revoked'
    WHEN expires_at IS NOT NULL AND expires_at <= NOW() THEN 'expired'
    WHEN LOWER(COALESCE(status,'')) IN ('verified','valid','active') THEN 'active'
    ELSE 'invalid'
  END AS status,
  issued_at AS "issuedAt", expires_at AS "expiresAt", revoked_at AS "revokedAt",
  created_at AS "createdAt", updated_at AS "updatedAt"
FROM qr_objects;

INSERT INTO qrv_schema_migrations (version) VALUES ('${SCHEMA_VERSION}')
ON CONFLICT (version) DO NOTHING;
COMMIT;
`;

try {
  await pool.query(sql);
  console.log('QR-V API registry migration complete');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
