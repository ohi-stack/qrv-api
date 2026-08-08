import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';
import crypto from 'crypto';

dotenv.config();
const { Pool } = pg;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || 3000);
const VERSION = process.env.APP_VERSION || '2.0.0';
const SERVICE = 'qrv-api';
const DATABASE_URL = process.env.DATABASE_URL || '';
const PLATFORM_ORIGIN = (process.env.QRV_PLATFORM_ORIGIN || 'https://qrv.network').replace(/\/$/, '');
const WRITE_KEY = process.env.QRV_PLATFORM_API_KEY || process.env.REGISTRY_API_KEY || '';
const PUBLIC_RATE_LIMIT = Number(process.env.PUBLIC_RATE_LIMIT || 240);
const PUBLIC_RATE_WINDOW_MS = Number(process.env.PUBLIC_RATE_WINDOW_MS || 60_000);
const STARTED_AT = new Date().toISOString();

const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || PLATFORM_ORIGIN)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('CORS origin denied'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['content-type', 'authorization', 'x-api-key', 'x-request-id']
}));

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      max: Number(process.env.DATABASE_POOL_MAX || 20),
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 5000),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 10000)
    })
  : null;

if (pool) pool.on('error', (error) => console.error('PostgreSQL pool error:', error.message));

function now() {
  return new Date().toISOString();
}

function requestId(req) {
  return String(req.headers['x-request-id'] || crypto.randomUUID());
}

function sendError(res, status, code, message, details = undefined) {
  return res.status(status).json({
    ok: false,
    service: SERVICE,
    error: { code, message, ...(details ? { details } : {}) },
    timestamp: now()
  });
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function typeCode(recordType) {
  const normalized = String(recordType || 'GEN').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized === 'CERTIFICATE') return 'CERT';
  if (normalized === 'MEMBERSHIP' || normalized === 'IDENTITY') return 'ID';
  if (normalized === 'PRODUCT') return 'PROD';
  if (normalized === 'DOCUMENT') return 'DOC';
  if (normalized === 'PROPERTY') return 'PROP';
  if (normalized === 'ASSET') return 'ASSET';
  return normalized.slice(0, 8) || 'GEN';
}

function generateQrvid(recordType) {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `QRV-${typeCode(recordType)}-${timestamp}-${random}`;
}

function normalizeVerificationState(row) {
  if (!row) return 'NOT_FOUND';
  const status = String(row.status || '').toLowerCase();
  if (status === 'revoked') return 'REVOKED';
  if (status === 'expired') return 'EXPIRED';
  if (row.expiration_date) {
    const expiry = new Date(`${String(row.expiration_date).slice(0, 10)}T23:59:59.999Z`);
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < Date.now()) return 'EXPIRED';
  }
  if (['verified', 'valid', 'active'].includes(status)) return 'VERIFIED';
  return 'NOT_FOUND';
}

function publicRecord(row) {
  const state = normalizeVerificationState(row);
  return {
    qrvid: row.qrvid,
    state,
    status: state,
    verified: state === 'VERIFIED',
    recordType: row.record_type,
    issuer: row.issuer,
    owner: row.owner || row.recipient_name || null,
    recipient: row.recipient_name || row.owner || null,
    title: row.certificate_title || null,
    issueDate: row.issue_date || null,
    expirationDate: row.expiration_date || null,
    hash: row.hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canonicalUrl: `${PLATFORM_ORIGIN}/verify/${encodeURIComponent(row.qrvid)}`,
    integrity: {
      hashAlgorithm: 'SHA-256',
      hashPresent: Boolean(row.hash),
      signatureValid: null,
      note: 'Signature validation is exposed when issuer signing keys are configured.'
    }
  };
}

function requireDatabase(_req, res, next) {
  if (!pool) return sendError(res, 503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is required for this operation');
  return next();
}

function requireWriteAuth(req, res, next) {
  if (!WRITE_KEY) {
    return sendError(res, 503, 'WRITE_AUTH_NOT_CONFIGURED', 'QRV_PLATFORM_API_KEY must be configured before write operations are enabled');
  }
  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : String(req.headers['x-api-key'] || '');
  const expected = Buffer.from(WRITE_KEY);
  const provided = Buffer.from(token);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Valid platform API authorization is required');
  }
  return next();
}

const limiter = new Map();
function publicRateLimit(req, res, next) {
  const key = String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
  const current = Date.now();
  const bucket = limiter.get(key) || { started: current, count: 0 };
  if (current - bucket.started >= PUBLIC_RATE_WINDOW_MS) {
    bucket.started = current;
    bucket.count = 0;
  }
  bucket.count += 1;
  limiter.set(key, bucket);
  if (bucket.count > PUBLIC_RATE_LIMIT) return sendError(res, 429, 'RATE_LIMITED', 'Too many verification requests');
  return next();
}

async function audit(client, qrvid, eventType, metadata = {}) {
  try {
    await client.query(
      'INSERT INTO qr_audit_log (qrvid, event_type, metadata) VALUES ($1, $2, $3)',
      [qrvid, eventType, metadata]
    );
  } catch (error) {
    console.error('Audit write failed:', error.message);
  }
}

async function findRecord(qrvid) {
  const result = await pool.query(
    `SELECT o.*, c.recipient_name, c.certificate_title, c.issue_date, c.expiration_date
       FROM qr_objects o
       LEFT JOIN qr_certificates c ON c.qrvid = o.qrvid
      WHERE o.qrvid = $1
      LIMIT 1`,
    [qrvid]
  );
  return result.rows[0] || null;
}

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: SERVICE,
    version: VERSION,
    architecture: 'two-node-consolidated',
    platform: PLATFORM_ORIGIN,
    role: 'canonical-api-and-registry-node',
    endpoints: [
      'GET /healthz',
      'GET /readyz',
      'GET /version',
      'GET /api/v1/verify/:qrvid',
      'GET /api/v1/records/:qrvid',
      'POST /api/v1/records',
      'POST /api/v1/records/:qrvid/revoke',
      'GET /api/v1/records',
      'GET /api/v1/audit/:qrvid'
    ]
  });
});

app.get('/healthz', (_req, res) => res.json({ ok: true, status: 'ok', service: SERVICE, version: VERSION, timestamp: now() }));
app.get('/health', (_req, res) => res.json({ ok: true, status: 'ok', service: SERVICE, version: VERSION, timestamp: now() }));
app.get('/version', (_req, res) => res.json({ ok: true, service: SERVICE, version: VERSION, startedAt: STARTED_AT, architecture: 'two-node-consolidated' }));

async function readiness(_req, res) {
  if (!pool) return res.status(503).json({ ok: false, ready: false, service: SERVICE, database: 'not_configured', timestamp: now() });
  try {
    await pool.query('SELECT 1 FROM qr_objects LIMIT 1');
    return res.json({ ok: true, ready: true, service: SERVICE, database: 'connected', timestamp: now() });
  } catch (error) {
    return res.status(503).json({ ok: false, ready: false, service: SERVICE, database: 'error', error: error.message, timestamp: now() });
  }
}
app.get('/readyz', readiness);
app.get('/ready', readiness);

app.get('/api/v1/verify/:qrvid', publicRateLimit, requireDatabase, async (req, res) => {
  const qrvid = String(req.params.qrvid || '').trim().toUpperCase();
  if (!/^QRV-[A-Z0-9][A-Z0-9-]{2,127}$/.test(qrvid)) return sendError(res, 422, 'INVALID_QRVID', 'QRVID format is invalid');
  try {
    const row = await findRecord(qrvid);
    if (!row) return res.status(404).json({ ok: false, verified: false, state: 'NOT_FOUND', status: 'NOT_FOUND', qrvid, canonicalUrl: `${PLATFORM_ORIGIN}/verify/${encodeURIComponent(qrvid)}`, timestamp: now() });
    const record = publicRecord(row);
    await audit(pool, qrvid, 'VERIFY', { state: record.state, requestId: requestId(req) });
    return res.json({ ok: record.state === 'VERIFIED', ...record, verifiedAt: now() });
  } catch (error) {
    console.error('Verify failed:', error);
    return sendError(res, 500, 'VERIFY_FAILED', 'Verification request failed');
  }
});

app.get('/api/v1/records/:qrvid', publicRateLimit, requireDatabase, async (req, res) => {
  const qrvid = String(req.params.qrvid || '').trim().toUpperCase();
  try {
    const row = await findRecord(qrvid);
    if (!row) return res.status(404).json({ ok: false, state: 'NOT_FOUND', qrvid, timestamp: now() });
    return res.json({ ok: true, record: publicRecord(row), timestamp: now() });
  } catch (error) {
    return sendError(res, 500, 'LOOKUP_FAILED', 'Registry lookup failed');
  }
});

app.post('/api/v1/records', requireDatabase, requireWriteAuth, async (req, res) => {
  const recordType = String(req.body?.recordType || req.body?.type || '').trim().toLowerCase();
  const issuer = String(req.body?.issuer || '').trim();
  const owner = String(req.body?.owner || req.body?.recipient || '').trim() || null;
  const title = String(req.body?.title || req.body?.certificateTitle || '').trim() || null;
  const issueDate = req.body?.issueDate || new Date().toISOString().slice(0, 10);
  const expirationDate = req.body?.expirationDate || null;
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};

  if (!recordType || !issuer) return sendError(res, 422, 'INVALID_REQUEST', 'recordType and issuer are required');
  if (recordType === 'certificate' && (!owner || !title)) return sendError(res, 422, 'INVALID_CERTIFICATE', 'recipient/owner and title are required for certificate records');

  const qrvid = generateQrvid(recordType);
  const canonicalPayload = { qrvid, recordType, issuer, owner, title, issueDate, expirationDate, metadata };
  const hash = hashPayload(canonicalPayload);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO qr_objects (qrvid, record_type, issuer, owner, hash, status)
       VALUES ($1, $2, $3, $4, $5, 'verified')`,
      [qrvid, recordType, issuer, owner, hash]
    );
    await client.query(
      `INSERT INTO qr_hash_registry (qrvid, hash, algorithm) VALUES ($1, $2, 'sha256')`,
      [qrvid, hash]
    );
    if (recordType === 'certificate') {
      await client.query(
        `INSERT INTO qr_certificates (qrvid, recipient_name, certificate_title, issuer_name, issue_date, expiration_date, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, 'verified', $7)`,
        [qrvid, owner, title, issuer, issueDate, expirationDate, metadata]
      );
    }
    await audit(client, qrvid, 'CREATE', { issuer, recordType, owner, requestId: requestId(req) });
    await client.query('COMMIT');
    const row = await findRecord(qrvid);
    return res.status(201).json({ ok: true, state: 'VERIFIED', qrvid, record: publicRecord(row), verifyUrl: `${PLATFORM_ORIGIN}/verify/${encodeURIComponent(qrvid)}` });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Create failed:', error);
    return sendError(res, 500, 'CREATE_FAILED', 'Registry record creation failed');
  } finally {
    client.release();
  }
});

app.post('/api/v1/records/:qrvid/revoke', requireDatabase, requireWriteAuth, async (req, res) => {
  const qrvid = String(req.params.qrvid || '').trim().toUpperCase();
  const reason = String(req.body?.reason || '').trim() || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE qr_objects
          SET status='revoked', updated_at=NOW(), revoked_at=NOW(), revocation_reason=$2
        WHERE qrvid=$1
        RETURNING *`,
      [qrvid, reason]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, state: 'NOT_FOUND', qrvid, timestamp: now() });
    }
    await client.query(`UPDATE qr_certificates SET status='revoked', updated_at=NOW() WHERE qrvid=$1`, [qrvid]);
    await audit(client, qrvid, 'REVOKE', { reason, requestId: requestId(req) });
    await client.query('COMMIT');
    const row = await findRecord(qrvid);
    return res.json({ ok: true, state: 'REVOKED', qrvid, record: publicRecord(row), timestamp: now() });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Revoke failed:', error);
    return sendError(res, 500, 'REVOKE_FAILED', 'Registry revocation failed');
  } finally {
    client.release();
  }
});

app.get('/api/v1/records', requireDatabase, requireWriteAuth, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  try {
    const result = await pool.query(
      `SELECT o.*, c.recipient_name, c.certificate_title, c.issue_date, c.expiration_date
         FROM qr_objects o
         LEFT JOIN qr_certificates c ON c.qrvid=o.qrvid
        ORDER BY o.created_at DESC
        LIMIT $1`,
      [limit]
    );
    return res.json({ ok: true, records: result.rows.map(publicRecord), count: result.rows.length, timestamp: now() });
  } catch (error) {
    return sendError(res, 500, 'LIST_FAILED', 'Unable to list records');
  }
});

app.get('/api/v1/audit/:qrvid', requireDatabase, requireWriteAuth, async (req, res) => {
  const qrvid = String(req.params.qrvid || '').trim().toUpperCase();
  try {
    const result = await pool.query('SELECT * FROM qr_audit_log WHERE qrvid=$1 ORDER BY created_at DESC LIMIT 200', [qrvid]);
    return res.json({ ok: true, qrvid, events: result.rows, timestamp: now() });
  } catch (error) {
    return sendError(res, 500, 'AUDIT_LOOKUP_FAILED', 'Unable to load audit events');
  }
});

// Compatibility aliases during consolidation.
app.get('/verify/:qrvid', (req, res) => res.redirect(308, `/api/v1/verify/${encodeURIComponent(req.params.qrvid)}`));
app.get('/registry/:qrvid', (req, res) => res.redirect(308, `/api/v1/records/${encodeURIComponent(req.params.qrvid)}`));
app.post('/registry/create', (_req, res) => res.redirect(308, '/api/v1/records'));
app.post('/registry/:qrvid/revoke', (req, res) => res.redirect(308, `/api/v1/records/${encodeURIComponent(req.params.qrvid)}/revoke`));

app.use((req, res) => sendError(res, 404, 'NOT_FOUND', `Route not found: ${req.method} ${req.path}`));
app.use((error, _req, res, _next) => {
  if (error?.message === 'CORS origin denied') return sendError(res, 403, 'CORS_DENIED', 'Origin is not allowed');
  console.error('Unhandled API error:', error);
  return sendError(res, 500, 'INTERNAL_ERROR', 'Internal API error');
});

const server = app.listen(PORT, '0.0.0.0', () => console.log(`${SERVICE} ${VERSION} running on 0.0.0.0:${PORT}`));

async function shutdown() {
  server.close(async () => {
    if (pool) await pool.end().catch(() => {});
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (NODE_ENV === 'production' && !DATABASE_URL) console.error('DATABASE_URL is not configured; readiness and data routes will fail closed.');
if (NODE_ENV === 'production' && !WRITE_KEY) console.error('QRV_PLATFORM_API_KEY is not configured; write routes will fail closed.');
