SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS qr_objects (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  qrvid VARCHAR(120) COLLATE utf8mb4_bin NOT NULL UNIQUE,
  record_type VARCHAR(80) NOT NULL,
  issuer VARCHAR(255) NOT NULL,
  owner VARCHAR(255) NULL,
  hash TEXT COLLATE utf8mb4_bin NOT NULL,
  status VARCHAR(40) DEFAULT 'verified',
  signature TEXT NULL,
  revoked_at DATETIME(6) NULL,
  revocation_reason TEXT NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_qr_objects_status (status),
  KEY idx_qr_objects_hash (hash(64))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS qr_audit_log (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  qrvid VARCHAR(120) COLLATE utf8mb4_bin NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  metadata JSON,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_qr_audit_qrvid (qrvid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS qr_issuers (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  issuer_id VARCHAR(120) COLLATE utf8mb4_bin NOT NULL UNIQUE,
  issuer_name VARCHAR(255) NOT NULL,
  status VARCHAR(40) DEFAULT 'active',
  public_key TEXT NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS qr_hash_registry (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  qrvid VARCHAR(120) COLLATE utf8mb4_bin NOT NULL,
  hash TEXT COLLATE utf8mb4_bin NOT NULL,
  algorithm VARCHAR(40) DEFAULT 'sha256',
  signature TEXT NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_qr_hash_registry_qrvid (qrvid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS qr_certificates (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  qrvid VARCHAR(120) COLLATE utf8mb4_bin NOT NULL UNIQUE,
  recipient_name VARCHAR(255) NULL,
  certificate_title VARCHAR(255) NULL,
  issuer_name VARCHAR(255) NULL,
  issue_date DATE NULL,
  expiration_date DATE NULL,
  status VARCHAR(40) DEFAULT 'verified',
  metadata JSON NOT NULL DEFAULT '{}',
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
