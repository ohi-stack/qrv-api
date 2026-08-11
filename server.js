import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import pkg from 'pg';
import crypto from 'crypto';

dotenv.config();
const { Pool } = pkg;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

const PORT = Number(process.env.PORT || 3000);
const VERSION = process.env.APP_VERSION || '2.0.0';
const SERVICE = 'qrv-api';
const STARTED_AT = new Date().toISOString();
const PUBLIC_BASE_URL = process.env.QRV_PUBLIC_BASE_URL || 'https://qrv.network';
const API_BASE_URL = process.env.QRV_API_BASE_URL || 'https://api.qrv.network/api/v1';
const ENV_CODE = String(process.env.QRV_ENV_CODE || 'PROD').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'PROD';
const REQUIRE_SIGNATURES = String(process.env.REQUIRE_SIGNATURES || 'false').toLowerCase() === 'true';
const WRITE_API_KEY = process.env.QRV_WRITE_API_KEY || process.env.REGISTRY_API_KEY || process.env.ADMIN_API_KEY || '';
const DEFAULT_ISSUER_ID = String(process.env.QRV_DEFAULT_ISSUER_ID || '').trim();
const SIGNING_PRIVATE_KEY = process.env.SIGNING_PRIVATE_KEY || '';
const SIGNING_PUBLIC_KEY = process.env.SIGNING_PUBLIC_KEY || '';

const allowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS || PUBLIC_BASE_URL)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by QR-V CORS policy'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['content-type', 'authorization', 'x-api-key', 'x-issuer-id', 'x-request-id'],
}));

app.use(rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  limit: Number(process.env.RATE_LIMIT_MAX || 180),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
}));

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: String(process.env.DATABASE_SSL || 'true').toLowerCase() === 'true'
        ? { rejectUnauthorized: String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'true' }
        : false,
      max: Number(process.env.DATABASE_POOL_MAX || 20),
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 5000),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 10000),
    })
  : null;

if (pool) pool.on('error', (error) => console.error('PostgreSQL pool error:', error.message));

function now() {
  return new Date().toISOString();
}

function sendError(res, status, code, message, details = undefined) {
  return res.status(status).json({
    ok: false,
    service: SERVICE,
    error: { code, message, ...(details ? { details } : {}) },
    timestamp: now(),
  });
}

function requireDatabase(res) {
  if (pool) return true;
  sendError(res, 503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is required for this operation');
  return false;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length > 0 && leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireWriteAuth(req, res, next) {
  if (!WRITE_API_KEY) return sendError(res, 503, 'WRITE_AUTH_NOT_CONFIGURED', 'QRV_WRITE_API_KEY must be configured');
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const apiKey = String(req.headers['x-api-key'] || '');
  const supplied = apiKey || bearer;
  if (!safeEqual(supplied, WRITE_API_KEY)) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Valid issuer write credentials are required');
  }
  const issuerId = String(req.headers['x-issuer-id'] || DEFAULT_ISSUER_ID).trim();
  if (!issuerId || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{1,119}$/.test(issuerId)) {
    return sendError(res, 422, 'ISSUER_ID_REQUIRED', 'A valid x-issuer-id is required');
  }
  req.issuerId = issuerId;
  return next();
}

function normalizeQrvid(value) {
  try {
    return decodeURIComponent(String(value || '').trim()).toUpperCase().replace(/\s+/g, '');
  } catch (_error) {
    return '';
  }
}

const QRVID_FORMAT = /^QRV-[A-Z0-9]+-[A-Z0-9]+-[0-9]{6,}$/;

function normalizeType(value = 'CERT') {
  const raw = String(value || 'CERT').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const aliases = {
    CERTIFICATE: 'CERT', CERT: 'CERT',
    IDENTITY: 'ID', MEMBERSHIP: 'ID', ID: 'ID',
    PRODUCT: 'PROD', PROD: 'PROD',
    DOCUMENT: 'DOC', DOC: 'DOC',
    ASSET: 'ASSET', PROPERTY: 'PROP', PROP: 'PROP',
    EVENT: 'EVENT', FINANCIAL: 'FIN', FIN: 'FIN',
  };
  return aliases[raw] || raw.slice(0, 12) || 'GEN';
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

function signHash(hash) {
  if (!SIGNING_PRIVATE_KEY) return null;
  return crypto.sign(null, Buffer.from(hash, 'utf8'), SIGNING_PRIVATE_KEY).toString('base64');
}

function verifySignature(hash, signature) {
  if (!signature) return !REQUIRE_SIGNATURES;
  if (!SIGNING_PUBLIC_KEY) return !REQUIRE_SIGNATURES;
  try {
    return crypto.verify(null, Buffer.from(hash, 'utf8'), SIGNING_PUBLIC_KEY, Buffer.from(signature, 'base64'));
  } catch (_error) {
    return false;
  }
}

function publicVerifyUrl(qrvid) {
  return `${PUBLIC_BASE_URL}/verify/${encodeURIComponent(qrvid)}`;
}

function mapStatus(row) {
  if (!row) return 'NOT_FOUND';
  const raw = String(row.status || '').toLowerCase();
  if (raw === 'revoked') return 'REVOKED';
  if (raw === 'expired') return 'EXPIRED';
  if (row.revoked_at) return 'REVOKED';
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return 'EXPIRED';
  if (['active', 'verified', 'valid'].includes(raw)) return 'VERIFIED';
  return 'INVALID_STATUS';
}

async function audit(qrvid, eventType, metadata = {}, queryable = pool) {
  if (!queryable) return;
  try {
    await queryable.query(
      'INSERT INTO qr_audit_log (qrvid, issuer_id, event_type, source_service, result, metadata) VALUES ($1,$2,$3,$4,$5,$6)',
      [qrvid, metadata.issuerId || null, eventType, SERVICE, metadata.result || null, metadata]
    );
  } catch (error) {
    console.error('QR-V audit write failed:', error.message);
    throw error;
  }
}

function isPublicRecord(row) {
  return String(row?.visibility || 'public').toLowerCase() === 'public';
}

function publicVerificationRecord(row, status, integrity) {
  const base = {
    status,
    qrvid: row.qrvid,
    issuer: row.issuer,
    recordType: row.record_type,
    issuedAt: row.issued_at || row.created_at,
    expiresAt: row.expires_at || null,
    revokedAt: row.revoked_at || null,
    visibility: row.visibility || 'public',
    integrity,
    verifyUrl: publicVerifyUrl(row.qrvid),
  };
  if (!isPublicRecord(row)) return base;
  return { ...base, subject: row.owner, title: row.title || row.payload?.title || null, hash: row.hash };
}

async function nextQrvid(recordType) {
  const type = normalizeType(recordType);
  const result = await pool.query("SELECT nextval('qrv_record_seq')::bigint AS sequence");
  const sequence = String(result.rows[0].sequence).padStart(6, '0');
  return `QRV-${ENV_CODE}-${type}-${sequence}`;
}

function apiRoot() {
  return {
    ok: true,
    service: SERVICE,
    status: 'running',
    architecture: 'two-node',
    role: 'canonical-api-registry-backend',
    version: VERSION,
    publicBaseUrl: PUBLIC_BASE_URL,
    apiBaseUrl: API_BASE_URL,
    endpoints: [
      '/healthz', '/readyz', '/version', '/metrics',
      '/api/v1/verify/:qrvid',
      '/api/v1/registry/:qrvid',
      '/api/v1/registry/hash/:hash',
      '/api/v1/registry/:qrvid/audit',
      'POST /api/v1/registry/create',
      'POST /api/v1/revoke',
    ],
    uiPolicy: 'All browser-facing QR-V experiences belong on qrv.network. api.qrv.network returns JSON only.',
  };
}

app.get('/', (_req, res) => res.json(apiRoot()));
app.get('/healthz', (_req, res) => res.json({ ok: true, status: 'ok', service: SERVICE, version: VERSION, architecture: 'two-node', timestamp: now() }));
app.get('/health', (_req, res) => res.json({ ok: true, status: 'ok', service: SERVICE, version: VERSION, timestamp: now() }));
app.get('/ping', (_req, res) => res.json({ ok: true, service: SERVICE, pong: true, timestamp: now() }));
app.get('/version', (_req, res) => res.json({ ok: true, service: SERVICE, version: VERSION, startedAt: STARTED_AT }));

async function readiness(_req, res) {
  if (!pool) return sendError(res, 503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is required');
  if (REQUIRE_SIGNATURES && (!SIGNING_PRIVATE_KEY || !SIGNING_PUBLIC_KEY)) {
    return sendError(res, 503, 'SIGNING_NOT_CONFIGURED', 'Production signature keys are required');
  }
  if (!WRITE_API_KEY) return sendError(res, 503, 'WRITE_AUTH_NOT_CONFIGURED', 'QRV_WRITE_API_KEY is required');
  if (!DEFAULT_ISSUER_ID) return sendError(res, 503, 'ISSUER_NOT_CONFIGURED', 'QRV_DEFAULT_ISSUER_ID is required');
  try {
    await pool.query('SELECT 1');
    const relations = await pool.query("SELECT to_regclass('public.qr_objects') AS qr_objects, to_regclass('public.qr_audit_log') AS qr_audit_log, to_regclass('public.qr_issuers') AS qr_issuers");
    if (!relations.rows[0]?.qr_objects || !relations.rows[0]?.qr_audit_log || !relations.rows[0]?.qr_issuers) {
      return sendError(res, 503, 'MIGRATION_REQUIRED', 'Required QR-V tables are absent');
    }
    return res.json({ ok: true, ready: true, service: SERVICE, database: 'connected', signaturesRequired: REQUIRE_SIGNATURES, timestamp: now() });
  } catch (_error) {
    return sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Unable to query QR-V PostgreSQL registry');
  }
}
app.get('/readyz', readiness);
app.get('/ready', readiness);

app.get('/metrics', requireWriteAuth, async (_req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const [records, audits, issuers] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM qr_objects'),
      pool.query('SELECT COUNT(*)::int AS count FROM qr_audit_log'),
      pool.query('SELECT COUNT(*)::int AS count FROM qr_issuers'),
    ]);
    return res.json({ ok: true, service: SERVICE, records: records.rows[0].count, auditEvents: audits.rows[0].count, issuers: issuers.rows[0].count, timestamp: now() });
  } catch (_error) {
    return sendError(res, 500, 'METRICS_FAILED', 'Unable to read registry metrics');
  }
});

app.post('/api/v1/registry/create', requireWriteAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  const body = req.body || {};
  const recordType = normalizeType(body.recordType || body.type || 'CERT');
  const issuer = String(body.issuer || body.issuerName || '').trim();
  const subject = String(body.subject || body.owner || body.recipient || '').trim();
  const title = String(body.title || body.certificateTitle || '').trim();
  const visibility = String(body.visibility || body.privacyLevel || 'public').toLowerCase();
  if (!issuer || !title) return sendError(res, 422, 'INVALID_REQUEST', 'issuer and title are required');
  if (!['public', 'restricted', 'private'].includes(visibility)) return sendError(res, 422, 'INVALID_VISIBILITY', 'visibility must be public, restricted, or private');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const qrvid = body.qrvid ? normalizeQrvid(body.qrvid) : await nextQrvid(recordType);
    if (!QRVID_FORMAT.test(qrvid)) {
      await client.query('ROLLBACK');
      return sendError(res, 422, 'INVALID_QRVID', 'QRVID must match QRV-{ENV}-{TYPE}-{SEQUENCE}');
    }

    const issuedAt = body.issuedAt ? new Date(body.issuedAt) : new Date();
    if (Number.isNaN(issuedAt.getTime())) {
      await client.query('ROLLBACK');
      return sendError(res, 422, 'INVALID_ISSUED_AT', 'issuedAt is invalid');
    }
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      await client.query('ROLLBACK');
      return sendError(res, 422, 'INVALID_EXPIRES_AT', 'expiresAt is invalid');
    }

    const payload = {
      qrvid,
      recordType,
      issuer,
      subject: subject || null,
      title,
      description: body.description || null,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      visibility,
      metadata: body.metadata || {},
    };
    const hash = hashPayload(payload);
    const signature = signHash(hash);
    if (REQUIRE_SIGNATURES && !signature) {
      await client.query('ROLLBACK');
      return sendError(res, 503, 'SIGNING_UNAVAILABLE', 'Record signing is required but the signing key is unavailable');
    }

    await client.query(
      `INSERT INTO qr_objects
       (qrvid, record_type, issuer_id, issuer, owner, title, description, payload, hash, signature, signature_algorithm, status, visibility, issued_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ed25519','active',$11,$12,$13)`,
      [qrvid, recordType, req.issuerId, issuer, subject || null, title, body.description || null, payload, hash, signature, payload.visibility, issuedAt, expiresAt]
    );
    await client.query(
      `INSERT INTO qr_hash_registry (qrvid, hash, algorithm) VALUES ($1,$2,'sha256') ON CONFLICT DO NOTHING`,
      [qrvid, hash]
    );
    if (recordType === 'CERT') {
      await client.query(
        `INSERT INTO qr_certificates (qrvid, issuer_id, recipient_name, certificate_title, issuer_name, issue_date, expiration_date, status, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8) ON CONFLICT (qrvid) DO NOTHING`,
        [qrvid, req.issuerId, subject || '', title, issuer, issuedAt, expiresAt, body.metadata || {}]
      );
    }
    await audit(qrvid, 'registry_create', { issuerId: req.issuerId, issuer, recordType, result: 'CREATED', requestId: req.headers['x-request-id'] || null }, client);
    await client.query('COMMIT');
    return res.status(201).json({ ok: true, status: 'CREATED', verificationStatus: 'VERIFIED', qrvid, hash, signature: signature ? 'present' : null, verifyUrl: publicVerifyUrl(qrvid), record: payload, timestamp: now() });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (String(error.code) === '23505') return sendError(res, 409, 'QRVID_CONFLICT', 'QRVID already exists');
    console.error('Create failed:', error);
    return sendError(res, 500, 'CREATE_FAILED', 'Unable to create QR-V record');
  } finally {
    client.release();
  }
});

async function getRecord(qrvid) {
  const result = await pool.query('SELECT * FROM qr_objects WHERE qrvid=$1 LIMIT 1', [qrvid]);
  return result.rows[0] || null;
}

app.get('/api/v1/verify/:qrvid', async (req, res) => {
  if (!requireDatabase(res)) return;
  const qrvid = normalizeQrvid(req.params.qrvid);
  if (!QRVID_FORMAT.test(qrvid)) return sendError(res, 422, 'INVALID_QRVID', 'QRVID format is invalid');
  try {
    const row = await getRecord(qrvid);
    if (!row) {
      await audit(qrvid, 'registry_verify', { result: 'NOT_FOUND' }).catch(() => {});
      return res.status(404).json({ ok: false, verified: false, status: 'NOT_FOUND', qrvid, verifyUrl: publicVerifyUrl(qrvid), timestamp: now() });
    }

    let status = mapStatus(row);
    let signatureValid = null;
    let hashValid = null;
    if (row.payload) {
      const recalculatedHash = hashPayload(row.payload);
      hashValid = recalculatedHash === row.hash;
      if (!hashValid) status = 'INVALID_SIGNATURE';
      signatureValid = verifySignature(row.hash, row.signature);
      if (!signatureValid) status = 'INVALID_SIGNATURE';
    } else status = 'INVALID_SIGNATURE';
    const verified = status === 'VERIFIED';
    await audit(qrvid, 'registry_verify', { issuerId: row.issuer_id, result: status, verified, requestId: req.headers['x-request-id'] || null }).catch(() => {});

    return res.status(200).json({
      ok: verified,
      verified,
      verificationState: status,
      ...publicVerificationRecord(row, status, { hashValid, signatureValid }),
      timestamp: now(),
    });
  } catch (error) {
    console.error('Verify failed:', error);
    return sendError(res, 500, 'VERIFY_FAILED', 'Unable to verify QR-V record');
  }
});

app.get('/api/v1/registry/:qrvid', async (req, res) => {
  if (!requireDatabase(res)) return;
  const qrvid = normalizeQrvid(req.params.qrvid);
  if (!QRVID_FORMAT.test(qrvid)) return sendError(res, 422, 'INVALID_QRVID', 'QRVID format is invalid');
  try {
    const row = await getRecord(qrvid);
    if (!row) return res.status(404).json({ ok: false, status: 'NOT_FOUND', qrvid, timestamp: now() });
    if (!isPublicRecord(row)) return sendError(res, 403, 'RECORD_RESTRICTED', 'This registry record is not public');
    await audit(qrvid, 'registry_lookup', { issuerId: row.issuer_id, result: 'FOUND', requestId: req.headers['x-request-id'] || null }).catch(() => {});
    return res.json({ ok: true, status: mapStatus(row), qrvid, record: publicVerificationRecord(row, mapStatus(row), null), timestamp: now() });
  } catch (_error) {
    return sendError(res, 500, 'REGISTRY_LOOKUP_FAILED', 'Unable to retrieve registry record');
  }
});

app.get('/api/v1/registry/hash/:hash', requireWriteAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const result = await pool.query('SELECT * FROM qr_objects WHERE hash=$1 AND issuer_id=$2 ORDER BY created_at DESC LIMIT 25', [req.params.hash, req.issuerId]);
    if (!result.rows.length) return res.status(404).json({ ok: false, status: 'NOT_FOUND', hash: req.params.hash, timestamp: now() });
    return res.json({ ok: true, status: 'FOUND', records: result.rows, timestamp: now() });
  } catch (_error) {
    return sendError(res, 500, 'HASH_LOOKUP_FAILED', 'Unable to query registry hash');
  }
});

app.get('/api/v1/registry/:qrvid/audit', requireWriteAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  const qrvid = normalizeQrvid(req.params.qrvid);
  try {
    const result = await pool.query('SELECT * FROM qr_audit_log WHERE qrvid=$1 AND issuer_id=$2 ORDER BY created_at DESC LIMIT 100', [qrvid, req.issuerId]);
    return res.json({ ok: true, qrvid, events: result.rows, timestamp: now() });
  } catch (_error) {
    return sendError(res, 500, 'AUDIT_LOOKUP_FAILED', 'Unable to retrieve audit events');
  }
});

async function revokeRecord(req, res) {
  if (!requireDatabase(res)) return;
  const qrvid = normalizeQrvid(req.body?.qrvid || req.params?.qrvid);
  if (!QRVID_FORMAT.test(qrvid)) return sendError(res, 422, 'INVALID_QRVID', 'QRVID format is invalid');
  const reason = String(req.body?.reason || '').trim().slice(0, 500) || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE qr_objects
       SET status='revoked', revoked_at=NOW(), revocation_reason=$2, updated_at=NOW()
       WHERE qrvid=$1 AND issuer_id=$3
       RETURNING *`,
      [qrvid, reason, req.issuerId]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, status: 'NOT_FOUND', qrvid, timestamp: now() });
    }
    await client.query(`UPDATE qr_certificates SET status='revoked', updated_at=NOW() WHERE qrvid=$1 AND issuer_id=$2`, [qrvid, req.issuerId]);
    await audit(qrvid, 'registry_revoke', { issuerId: req.issuerId, result: 'REVOKED', reason, requestId: req.headers['x-request-id'] || null }, client);
    await client.query('COMMIT');
    return res.json({ ok: true, status: 'REVOKED', qrvid, reason, verifyUrl: publicVerifyUrl(qrvid), timestamp: now() });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Revoke failed:', error);
    return sendError(res, 500, 'REVOKE_FAILED', 'Unable to revoke QR-V record');
  } finally {
    client.release();
  }
}

app.post('/api/v1/revoke', requireWriteAuth, revokeRecord);
app.post('/api/v1/registry/:qrvid/revoke', requireWriteAuth, revokeRecord);

app.get('/api/v1/issuer/records', requireWriteAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const result = await pool.query(
      'SELECT qrvid, record_type, issuer, owner, title, status, visibility, issued_at, expires_at, revoked_at, created_at FROM qr_objects WHERE issuer_id=$1 ORDER BY created_at DESC LIMIT $2',
      [req.issuerId, limit]
    );
    return res.json({ ok: true, records: result.rows, timestamp: now() });
  } catch (_error) {
    return sendError(res, 500, 'ISSUER_RECORDS_FAILED', 'Unable to retrieve issuer records');
  }
});

app.get('/api/v1/issuer/records/:qrvid', requireWriteAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const qrvid = normalizeQrvid(req.params.qrvid);
    const result = await pool.query('SELECT * FROM qr_objects WHERE qrvid=$1 AND issuer_id=$2 LIMIT 1', [qrvid, req.issuerId]);
    if (!result.rows.length) return res.status(404).json({ ok: false, status: 'NOT_FOUND', qrvid, timestamp: now() });
    return res.json({ ok: true, record: result.rows[0], timestamp: now() });
  } catch (_error) {
    return sendError(res, 500, 'ISSUER_RECORD_FAILED', 'Unable to retrieve issuer record');
  }
});

app.get('/api/v1/issuer/analytics', requireWriteAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('active','verified','valid') AND (expires_at IS NULL OR expires_at > NOW()))::int AS active,
        COUNT(*) FILTER (WHERE status='revoked' OR revoked_at IS NOT NULL)::int AS revoked,
        COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= NOW())::int AS expired
       FROM qr_objects WHERE issuer_id=$1`,
      [req.issuerId]
    );
    return res.json({ ok: true, issuerId: req.issuerId, ...result.rows[0], timestamp: now() });
  } catch (_error) {
    return sendError(res, 500, 'ISSUER_ANALYTICS_FAILED', 'Unable to retrieve issuer analytics');
  }
});

// Transitional API aliases. These remain JSON-only and may be removed after client migration.
app.get('/verify/:qrvid', (req, res) => res.redirect(308, `/api/v1/verify/${encodeURIComponent(req.params.qrvid)}`));
app.get('/registry/:qrvid', (req, res) => res.redirect(308, `/api/v1/registry/${encodeURIComponent(req.params.qrvid)}`));
app.post('/registry/create', requireWriteAuth, (req, res, next) => {
  req.url = '/api/v1/registry/create';
  return app._router.handle(req, res, next);
});
app.post('/revoke', requireWriteAuth, revokeRecord);

app.use((req, res) => sendError(res, 404, 'NOT_FOUND', `Route not found: ${req.method} ${req.path}`));
app.use((error, _req, res, _next) => {
  if (error?.message === 'Origin not allowed by QR-V CORS policy') return sendError(res, 403, 'CORS_DENIED', 'Origin is not allowed');
  console.error('Unhandled API error:', error);
  return sendError(res, 500, 'INTERNAL_ERROR', 'Internal API error');
});

const server = process.env.NODE_ENV === 'test'
  ? null
  : app.listen(PORT, '0.0.0.0', () => console.log(`qrv-api v${VERSION} running on 0.0.0.0:${PORT}`));

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down ${SERVICE}`);
  if (!server) return;
  server.close(async () => {
    if (pool) await pool.end().catch(() => {});
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, mapStatus, publicVerificationRecord, safeEqual };
