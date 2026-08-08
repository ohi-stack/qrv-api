import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config();
const { Pool } = pkg;

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
CREATE SEQUENCE IF NOT EXISTS qrv_record_seq START 1;

CREATE TABLE IF NOT EXISTS qr_objects (
  id BIGSERIAL PRIMARY KEY,
  qrvid VARCHAR(160) UNIQUE NOT NULL,
  record_type VARCHAR(80) NOT NULL,
  issuer VARCHAR(255) NOT NULL,
  owner VARCHAR(255),
  title VARCHAR(255),
  description TEXT,
  payload JSONB,
  hash TEXT NOT NULL,
  signature TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'verified',
  visibility VARCHAR(32) NOT NULL DEFAULT 'public',
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS signature TEXT;
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS visibility VARCHAR(32) NOT NULL DEFAULT 'public';
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS revocation_reason TEXT;

CREATE TABLE IF NOT EXISTS qr_audit_log (
  id BIGSERIAL PRIMARY KEY,
  qrvid VARCHAR(160) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qr_issuers (
  id BIGSERIAL PRIMARY KEY,
  issuer_id VARCHAR(120) UNIQUE NOT NULL,
  issuer_name VARCHAR(255) NOT NULL,
  status VARCHAR(40) DEFAULT 'active',
  public_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE qr_issuers ADD COLUMN IF NOT EXISTS public_key TEXT;

CREATE TABLE IF NOT EXISTS qr_hash_registry (
  id BIGSERIAL PRIMARY KEY,
  qrvid VARCHAR(160) NOT NULL,
  hash TEXT NOT NULL,
  algorithm VARCHAR(40) DEFAULT 'sha256',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qr_certificates (
  id BIGSERIAL PRIMARY KEY,
  qrvid VARCHAR(160) UNIQUE NOT NULL,
  recipient_name VARCHAR(255),
  certificate_title VARCHAR(255),
  issuer_name VARCHAR(255),
  issue_date DATE,
  expiration_date DATE,
  status VARCHAR(40) DEFAULT 'verified',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_objects_qrvid ON qr_objects(qrvid);
CREATE INDEX IF NOT EXISTS idx_qr_objects_status ON qr_objects(status);
CREATE INDEX IF NOT EXISTS idx_qr_objects_hash ON qr_objects(hash);
CREATE INDEX IF NOT EXISTS idx_qr_objects_issuer ON qr_objects(issuer);
CREATE INDEX IF NOT EXISTS idx_qr_audit_qrvid ON qr_audit_log(qrvid);
CREATE INDEX IF NOT EXISTS idx_qr_audit_created ON qr_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qr_issuers_issuer_id ON qr_issuers(issuer_id);
CREATE INDEX IF NOT EXISTS idx_qr_hash_registry_qrvid ON qr_hash_registry(qrvid);
CREATE INDEX IF NOT EXISTS idx_qr_hash_registry_hash ON qr_hash_registry(hash);
CREATE INDEX IF NOT EXISTS idx_qr_certificates_qrvid ON qr_certificates(qrvid);

CREATE OR REPLACE VIEW registry_records AS
SELECT
  qrvid,
  record_type AS "recordType",
  record_type AS type,
  COALESCE(owner, '') AS subject,
  COALESCE(title, owner, '') AS title,
  issuer,
  owner,
  hash,
  signature,
  visibility,
  CASE
    WHEN revoked_at IS NOT NULL OR LOWER(COALESCE(status,'')) = 'revoked' THEN 'revoked'
    WHEN expires_at IS NOT NULL AND expires_at <= NOW() THEN 'expired'
    WHEN LOWER(COALESCE(status,'')) IN ('verified','valid','active') THEN 'active'
    ELSE COALESCE(status,'unknown')
  END AS status,
  issued_at AS "issuedAt",
  expires_at AS "expiresAt",
  revoked_at AS "revokedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
FROM qr_objects;
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
