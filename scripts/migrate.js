import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { createDatabase } from '../database.js';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = createDatabase();

const sql = `
CREATE TABLE IF NOT EXISTS qr_objects (
  id SERIAL PRIMARY KEY,
  qrvid VARCHAR(120) UNIQUE NOT NULL,
  record_type VARCHAR(80) NOT NULL,
  issuer VARCHAR(255) NOT NULL,
  owner VARCHAR(255),
  hash TEXT NOT NULL,
  status VARCHAR(40) DEFAULT 'verified',
  signature TEXT,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS signature TEXT;
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE qr_objects ADD COLUMN IF NOT EXISTS revocation_reason TEXT;

CREATE TABLE IF NOT EXISTS qr_audit_log (
  id SERIAL PRIMARY KEY,
  qrvid VARCHAR(120) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qr_issuers (
  id SERIAL PRIMARY KEY,
  issuer_id VARCHAR(120) UNIQUE NOT NULL,
  issuer_name VARCHAR(255) NOT NULL,
  status VARCHAR(40) DEFAULT 'active',
  public_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE qr_issuers ADD COLUMN IF NOT EXISTS public_key TEXT;

CREATE TABLE IF NOT EXISTS qr_hash_registry (
  id SERIAL PRIMARY KEY,
  qrvid VARCHAR(120) NOT NULL,
  hash TEXT NOT NULL,
  algorithm VARCHAR(40) DEFAULT 'sha256',
  signature TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE qr_hash_registry ADD COLUMN IF NOT EXISTS signature TEXT;

CREATE TABLE IF NOT EXISTS qr_certificates (
  id SERIAL PRIMARY KEY,
  qrvid VARCHAR(120) UNIQUE NOT NULL,
  recipient_name VARCHAR(255),
  certificate_title VARCHAR(255),
  issuer_name VARCHAR(255),
  issue_date DATE,
  expiration_date DATE,
  status VARCHAR(40) DEFAULT 'verified',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE qr_certificates ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_qr_objects_qrvid ON qr_objects(qrvid);
CREATE INDEX IF NOT EXISTS idx_qr_objects_status ON qr_objects(status);
CREATE INDEX IF NOT EXISTS idx_qr_objects_hash ON qr_objects(hash);
CREATE INDEX IF NOT EXISTS idx_qr_audit_qrvid ON qr_audit_log(qrvid);
CREATE INDEX IF NOT EXISTS idx_qr_issuers_issuer_id ON qr_issuers(issuer_id);
CREATE INDEX IF NOT EXISTS idx_qr_hash_registry_qrvid ON qr_hash_registry(qrvid);
CREATE INDEX IF NOT EXISTS idx_qr_certificates_qrvid ON qr_certificates(qrvid);
`;

try {
  if (process.env.QRV_DATA_BACKEND === 'mariadb') {
    const schema = await readFile(new URL('../schema/mariadb.sql', import.meta.url), 'utf8');
    const connection = await pool.connect();
    try {
      // This checked-in schema contains only plain DDL and session statements.
      for (const statement of schema.split(';').map(value => value.trim()).filter(Boolean)) {
        await connection.query(statement);
      }
    } finally {
      connection.release();
    }
  } else {
    await pool.query(sql);
  }
  console.log('QR-V API migration complete');
} catch (error) {
  console.error('QR-V API migration failed:', error.code || error.name);
  process.exitCode = 1;
} finally {
  await pool.end();
}
