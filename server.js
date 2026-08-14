import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import pkg from 'pg';
import crypto from 'crypto';
import {
  ContactCardValidationError,
  normalizeContactCard,
  publicContactCard,
  renderVCard,
} from './lib/vcard.js';

dotenv.config();
const { Pool } = pkg;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || 3000);
const VERSION = process.env.APP_VERSION || '2.1.0';
const SERVICE = 'qrv-api';
const SCHEMA_VERSION = '2026-08-14-vcard-v4';
const MIN_WRITE_API_KEY_BYTES = 32;
const STARTED_AT = new Date().toISOString();
const PUBLIC_BASE_URL = String(process.env.QRV_PUBLIC_BASE_URL || 'https://qrv.network').replace(/\/$/, '');
const API_BASE_URL = String(process.env.QRV_API_BASE_URL || 'https://api.qrv.network/api/v1').replace(/\/$/, '');
const ENV_CODE = String(process.env.QRV_ENV_CODE || 'PROD').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'PROD';
const REQUIRE_SIGNATURES = String(process.env.REQUIRE_SIGNATURES ?? (NODE_ENV === 'production' ? 'true' : 'false')).toLowerCase() === 'true';
const WRITE_API_KEY = process.env.QRV_WRITE_API_KEY || process.env.REGISTRY_API_KEY || process.env.ADMIN_API_KEY || '';
const DEFAULT_ISSUER_ID = String(process.env.QRV_DEFAULT_ISSUER_ID || '').trim();

function readSigningKey(raw, encoded) {
  if (raw) return String(raw).replace(/\\n/g, '\n');
  if (!encoded) return '';
  try {
    return Buffer.from(String(encoded), 'base64').toString('utf8');
  } catch (_error) {
    return '';
  }
}

const SIGNING_PRIVATE_KEY = readSigningKey(process.env.SIGNING_PRIVATE_KEY, process.env.SIGNING_PRIVATE_KEY_BASE64);
const SIGNING_PUBLIC_KEY = readSigningKey(process.env.SIGNING_PUBLIC_KEY, process.env.SIGNING_PUBLIC_KEY_BASE64);

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

const publicRateLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  limit: Number(process.env.RATE_LIMIT_MAX || 180),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

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
    VCARD: 'VCARD', CONTACT: 'VCARD', CONTACTCARD: 'VCARD',
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

function signingKeyPairValid() {
  if (!SIGNING_PRIVATE_KEY || !SIGNING_PUBLIC_KEY) return false;
  try {
    const probe = Buffer.from('qrv-signing-readiness-v1', 'utf8');
    const signature = crypto.sign(null, probe, SIGNING_PRIVATE_KEY);
    return crypto.verify(null, probe, SIGNING_PUBLIC_KEY, signature);
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
  if (row.expires_at) {
    const expiresAt = new Date(row.expires_at).getTime();
    if (Number.isNaN(expiresAt)) return 'INVALID_STATUS';
    if (expiresAt <= Date.now()) return 'EXPIRED';
  }
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
  const contact = row.record_type === 'VCARD' && status === 'VERIFIED'
    ? publicContactCard(row.payload?.contact, String(row.visibility || 'public').toLowerCase())
    : null;
  if (!isPublicRecord(row)) return contact ? { ...base, contact, vcardUrl: `${PUBLIC_BASE_URL}/vcard/${encodeURIComponent(row.qrvid)}.vcf` } : base;
  return {
    ...base,
    subject: row.owner,
    title: row.title || row.payload?.title || null,
    hash: row.hash,
    ...(contact ? { contact, vcardUrl: `${PUBLIC_BASE_URL}/vcard/${encodeURIComponent(row.qrvid)}.vcf` } : {}),
  };
}

async function nextQrvid(recordType, queryable = pool) {
  const type = normalizeType(recordType);
  const result = await queryable.query("SELECT nextval('qrv_record_seq')::bigint AS sequence");
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
      '/api/v1/vcards/:qrvid.vcf',
      'POST /api/v1/registry/create',
      'POST /api/v1/issuer/vcards/:qrvid/update',
      'POST /api/v1/issuer/vcards/bulk',
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
  if (REQUIRE_SIGNATURES && !signingKeyPairValid()) {
    return sendError(res, 503, 'SIGNING_NOT_READY', 'A valid matching Ed25519 signing key pair is required');
  }
  if (!WRITE_API_KEY) return sendError(res, 503, 'WRITE_AUTH_NOT_CONFIGURED', 'QRV_WRITE_API_KEY is required');
  if (Buffer.byteLength(WRITE_API_KEY) < MIN_WRITE_API_KEY_BYTES) {
    return sendError(res, 503, 'WRITE_AUTH_WEAK', `QRV_WRITE_API_KEY must contain at least ${MIN_WRITE_API_KEY_BYTES} bytes`);
  }
  if (!DEFAULT_ISSUER_ID) return sendError(res, 503, 'ISSUER_NOT_CONFIGURED', 'QRV_DEFAULT_ISSUER_ID is required');
  try {
    await pool.query('SELECT 1');
    const relations = await pool.query(`SELECT
      to_regclass('public.qr_objects') AS qr_objects,
      to_regclass('public.qr_audit_log') AS qr_audit_log,
      to_regclass('public.qr_issuers') AS qr_issuers,
      to_regclass('public.qr_hash_registry') AS qr_hash_registry,
      to_regclass('public.qr_certificates') AS qr_certificates,
      to_regclass('public.qrv_schema_migrations') AS qrv_schema_migrations,
      to_regclass('public.qrv_record_seq') AS qrv_record_seq,
      to_regclass('public.registry_records') AS registry_records`);
    const requiredRelations = Object.values(relations.rows[0] || {});
    if (requiredRelations.length !== 8 || requiredRelations.some((relation) => !relation)) {
      return sendError(res, 503, 'MIGRATION_REQUIRED', 'Required QR-V schema relations are absent');
    }
    const migration = await pool.query('SELECT 1 FROM qrv_schema_migrations WHERE version=$1 LIMIT 1', [SCHEMA_VERSION]);
    if (!migration.rows.length) return sendError(res, 503, 'MIGRATION_REQUIRED', `Required schema version ${SCHEMA_VERSION} is not applied`);
    return res.json({ ok: true, ready: true, service: SERVICE, database: 'connected', schemaVersion: SCHEMA_VERSION, signaturesRequired: REQUIRE_SIGNATURES, signingKeyPairValid: REQUIRE_SIGNATURES ? true : null, timestamp: now() });
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
  let subject = String(body.subject || body.owner || body.recipient || '').trim();
  let title = String(body.title || body.certificateTitle || '').trim();
  const visibility = String(body.visibility || body.privacyLevel || 'public').toLowerCase();
  let contact = null;
  if (recordType === 'VCARD') {
    try {
      contact = normalizeContactCard(body.contact || body.metadata?.contact);
      subject ||= contact.formattedName;
      title ||= contact.title || `${contact.formattedName} — Verified Contact Card`;
    } catch (error) {
      if (error instanceof ContactCardValidationError) {
        return sendError(res, 422, 'INVALID_CONTACT_CARD', error.message, { field: error.field });
      }
      return sendError(res, 500, 'CONTACT_VALIDATION_FAILED', 'Unable to validate contact card');
    }
  }
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
    if (!qrvid.startsWith(`QRV-${ENV_CODE}-`)) {
      await client.query('ROLLBACK');
      return sendError(res, 422, 'INVALID_QRVID_ENVIRONMENT', `QRVID must use the ${ENV_CODE} environment namespace`);
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
    if (expiresAt && expiresAt.getTime() <= issuedAt.getTime()) {
      await client.query('ROLLBACK');
      return sendError(res, 422, 'INVALID_VALIDITY_PERIOD', 'expiresAt must be later than issuedAt');
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
      ...(contact ? { contact } : {}),
    };
    const hash = hashPayload(payload);
    const signature = signHash(hash);
    if (REQUIRE_SIGNATURES && !signature) {
      await client.query('ROLLBACK');
      return sendError(res, 503, 'SIGNING_UNAVAILABLE', 'Record signing is required but the signing key is unavailable');
    }

    const issuerResult = await client.query(
      `INSERT INTO qr_issuers (issuer_id, issuer_name, status)
       VALUES ($1,$2,'active')
       ON CONFLICT (issuer_id) DO UPDATE SET issuer_name=EXCLUDED.issuer_name, updated_at=NOW()
       WHERE qr_issuers.status='active'
       RETURNING status`,
      [req.issuerId, issuer]
    );
    if (issuerResult.rows[0]?.status !== 'active') {
      await client.query('ROLLBACK');
      return sendError(res, 403, 'ISSUER_INACTIVE', 'Issuer is not active');
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

function evaluateRecord(row) {
  let status = mapStatus(row);
  let signatureValid = null;
  let hashValid = null;
  if (row?.payload) {
    const recalculatedHash = hashPayload(row.payload);
    hashValid = recalculatedHash === row.hash;
    signatureValid = verifySignature(row.hash, row.signature);
    if (!hashValid || !signatureValid) status = 'INVALID_SIGNATURE';
  } else {
    status = 'INVALID_SIGNATURE';
  }
  return { status, hashValid, signatureValid };
}

app.get('/api/v1/verify/:qrvid', publicRateLimiter, async (req, res) => {
  if (!requireDatabase(res)) return;
  const qrvid = normalizeQrvid(req.params.qrvid);
  if (!QRVID_FORMAT.test(qrvid)) return sendError(res, 422, 'INVALID_QRVID', 'QRVID format is invalid');
  try {
    const row = await getRecord(qrvid);
    if (!row) {
      await audit(qrvid, 'registry_verify', { result: 'NOT_FOUND' }).catch(() => {});
      return res.status(404).json({ ok: false, verified: false, status: 'NOT_FOUND', qrvid, verifyUrl: publicVerifyUrl(qrvid), timestamp: now() });
    }

    const { status, hashValid, signatureValid } = evaluateRecord(row);
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

app.get('/api/v1/vcards/:qrvid.vcf', publicRateLimiter, async (req, res) => {
  if (!requireDatabase(res)) return;
  const qrvid = normalizeQrvid(req.params.qrvid);
  if (!QRVID_FORMAT.test(qrvid)) return sendError(res, 422, 'INVALID_QRVID', 'QRVID format is invalid');
  try {
    const row = await getRecord(qrvid);
    if (!row || row.record_type !== 'VCARD') {
      return sendError(res, 404, 'VCARD_NOT_FOUND', 'Verified Contact Card was not found');
    }
    const { status, hashValid, signatureValid } = evaluateRecord(row);
    if (status !== 'VERIFIED') {
      await audit(qrvid, 'vcard_download', { issuerId: row.issuer_id, result: status }).catch(() => {});
      return sendError(res, status === 'REVOKED' || status === 'EXPIRED' ? 410 : 409, status, 'Verified Contact Card is not active');
    }
    const contact = publicContactCard(row.payload?.contact, String(row.visibility || 'public').toLowerCase());
    if (!contact?.formattedName) return sendError(res, 403, 'VCARD_RESTRICTED', 'No downloadable contact fields are public');
    const verifyUrl = publicVerifyUrl(qrvid);
    const output = renderVCard(contact, qrvid, verifyUrl);
    await audit(qrvid, 'vcard_download', {
      issuerId: row.issuer_id,
      result: 'VERIFIED',
      hashValid,
      signatureValid,
      requestId: req.headers['x-request-id'] || null,
    }).catch(() => {});
    res.set({
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': `attachment; filename="qrv-${qrvid.toLowerCase()}.vcf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.status(200).send(output);
  } catch (error) {
    console.error('vCard download failed:', error);
    return sendError(res, 500, 'VCARD_DOWNLOAD_FAILED', 'Unable to generate Verified Contact Card');
  }
});

app.post('/api/v1/issuer/vcards/:qrvid/update', requireWriteAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  const qrvid = normalizeQrvid(req.params.qrvid);
  if (!QRVID_FORMAT.test(qrvid)) return sendError(res, 422, 'INVALID_QRVID', 'QRVID format is invalid');
  let contact;
  try {
    contact = normalizeContactCard(req.body?.contact);
  } catch (error) {
    if (error instanceof ContactCardValidationError) {
      return sendError(res, 422, 'INVALID_CONTACT_CARD', error.message, { field: error.field });
    }
    return sendError(res, 500, 'CONTACT_VALIDATION_FAILED', 'Unable to validate contact card');
  }
  const visibility = String(req.body?.visibility || 'public').toLowerCase();
  if (!['public', 'restricted', 'private'].includes(visibility)) {
    return sendError(res, 422, 'INVALID_VISIBILITY', 'visibility must be public, restricted, or private');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const selected = await client.query(
      `SELECT * FROM qr_objects WHERE qrvid=$1 AND issuer_id=$2 AND record_type='VCARD' FOR UPDATE`,
      [qrvid, req.issuerId],
    );
    const row = selected.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return sendError(res, 404, 'VCARD_NOT_FOUND', 'Verified Contact Card was not found');
    }
    if (mapStatus(row) !== 'VERIFIED') {
      await client.query('ROLLBACK');
      return sendError(res, 409, 'VCARD_NOT_ACTIVE', 'Only active Verified Contact Cards can be updated');
    }
    const title = String(req.body?.title || contact.title || `${contact.formattedName} — Verified Contact Card`).trim().slice(0, 255);
    const subject = String(req.body?.subject || contact.formattedName).trim().slice(0, 255);
    const updatedPayload = {
      ...row.payload,
      subject,
      title,
      description: req.body?.description ?? row.payload?.description ?? null,
      visibility,
      contact,
      updatedAt: now(),
    };
    const hash = hashPayload(updatedPayload);
    const signature = signHash(hash);
    if (REQUIRE_SIGNATURES && !signature) {
      await client.query('ROLLBACK');
      return sendError(res, 503, 'SIGNING_UNAVAILABLE', 'Record signing is required but the signing key is unavailable');
    }
    await client.query(
      `UPDATE qr_objects SET owner=$1, title=$2, description=$3, payload=$4, hash=$5,
        signature=$6, visibility=$7, updated_at=NOW() WHERE qrvid=$8 AND issuer_id=$9`,
      [subject, title, updatedPayload.description, updatedPayload, hash, signature, visibility, qrvid, req.issuerId],
    );
    await client.query(
      `INSERT INTO qr_hash_registry (qrvid, hash, algorithm) VALUES ($1,$2,'sha256') ON CONFLICT DO NOTHING`,
      [qrvid, hash],
    );
    await audit(qrvid, 'vcard_update', {
      issuerId: req.issuerId,
      result: 'UPDATED',
      requestId: req.headers['x-request-id'] || null,
    }, client);
    await client.query('COMMIT');
    return res.json({
      ok: true,
      status: 'UPDATED',
      verificationStatus: 'VERIFIED',
      qrvid,
      hash,
      verifyUrl: publicVerifyUrl(qrvid),
      vcardUrl: `${PUBLIC_BASE_URL}/vcard/${encodeURIComponent(qrvid)}.vcf`,
      timestamp: now(),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('vCard update failed:', error);
    return sendError(res, 500, 'VCARD_UPDATE_FAILED', 'Unable to update Verified Contact Card');
  } finally {
    client.release();
  }
});

app.post('/api/v1/issuer/vcards/bulk', requireWriteAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  const issuer = String(req.body?.issuer || req.body?.issuerName || '').trim();
  const entries = req.body?.cards;
  if (!issuer) return sendError(res, 422, 'INVALID_REQUEST', 'issuer is required');
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 100) {
    return sendError(res, 422, 'INVALID_BULK_REQUEST', 'cards must contain between 1 and 100 entries');
  }

  let cards;
  try {
    cards = entries.map((entry, index) => {
      const contact = normalizeContactCard(entry?.contact);
      const visibility = String(entry?.visibility || 'public').toLowerCase();
      if (!['public', 'restricted', 'private'].includes(visibility)) {
        throw new ContactCardValidationError(`cards[${index}].visibility is invalid`, `cards[${index}].visibility`);
      }
      const issuedAt = entry?.issuedAt ? new Date(entry.issuedAt) : new Date();
      const expiresAt = entry?.expiresAt ? new Date(entry.expiresAt) : null;
      if (Number.isNaN(issuedAt.getTime())) throw new ContactCardValidationError(`cards[${index}].issuedAt is invalid`, `cards[${index}].issuedAt`);
      if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= issuedAt)) {
        throw new ContactCardValidationError(`cards[${index}].expiresAt must be later than issuedAt`, `cards[${index}].expiresAt`);
      }
      return { entry, contact, visibility, issuedAt, expiresAt };
    });
  } catch (error) {
    if (error instanceof ContactCardValidationError) {
      return sendError(res, 422, 'INVALID_CONTACT_CARD', error.message, { field: error.field });
    }
    return sendError(res, 500, 'CONTACT_VALIDATION_FAILED', 'Unable to validate contact cards');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const issuerResult = await client.query(
      `INSERT INTO qr_issuers (issuer_id, issuer_name, status)
       VALUES ($1,$2,'active')
       ON CONFLICT (issuer_id) DO UPDATE SET issuer_name=EXCLUDED.issuer_name, updated_at=NOW()
       WHERE qr_issuers.status='active'
       RETURNING status`,
      [req.issuerId, issuer],
    );
    if (issuerResult.rows[0]?.status !== 'active') {
      await client.query('ROLLBACK');
      return sendError(res, 403, 'ISSUER_INACTIVE', 'Issuer is not active');
    }
    const created = [];
    for (const card of cards) {
      const qrvid = await nextQrvid('VCARD', client);
      const subject = String(card.entry.subject || card.contact.formattedName).trim().slice(0, 255);
      const title = String(card.entry.title || card.contact.title || `${card.contact.formattedName} — Verified Contact Card`).trim().slice(0, 255);
      const payload = {
        qrvid,
        recordType: 'VCARD',
        issuer,
        subject,
        title,
        description: card.entry.description || null,
        issuedAt: card.issuedAt.toISOString(),
        expiresAt: card.expiresAt ? card.expiresAt.toISOString() : null,
        visibility: card.visibility,
        metadata: card.entry.metadata || {},
        contact: card.contact,
      };
      const hash = hashPayload(payload);
      const signature = signHash(hash);
      if (REQUIRE_SIGNATURES && !signature) throw new Error('SIGNING_UNAVAILABLE');
      await client.query(
        `INSERT INTO qr_objects
         (qrvid, record_type, issuer_id, issuer, owner, title, description, payload, hash, signature,
          signature_algorithm, status, visibility, issued_at, expires_at)
         VALUES ($1,'VCARD',$2,$3,$4,$5,$6,$7,$8,$9,'ed25519','active',$10,$11,$12)`,
        [qrvid, req.issuerId, issuer, subject, title, payload.description, payload, hash, signature, card.visibility, card.issuedAt, card.expiresAt],
      );
      await client.query(`INSERT INTO qr_hash_registry (qrvid, hash, algorithm) VALUES ($1,$2,'sha256')`, [qrvid, hash]);
      await audit(qrvid, 'registry_create', {
        issuerId: req.issuerId,
        issuer,
        recordType: 'VCARD',
        result: 'CREATED',
        bulk: true,
        requestId: req.headers['x-request-id'] || null,
      }, client);
      created.push({
        qrvid,
        hash,
        verifyUrl: publicVerifyUrl(qrvid),
        vcardUrl: `${PUBLIC_BASE_URL}/vcard/${encodeURIComponent(qrvid)}.vcf`,
      });
    }
    await client.query('COMMIT');
    return res.status(201).json({ ok: true, status: 'CREATED', count: created.length, records: created, timestamp: now() });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Bulk vCard create failed:', error);
    return sendError(res, error.message === 'SIGNING_UNAVAILABLE' ? 503 : 500, error.message === 'SIGNING_UNAVAILABLE' ? 'SIGNING_UNAVAILABLE' : 'BULK_CREATE_FAILED', 'Unable to create Verified Contact Cards');
  } finally {
    client.release();
  }
});

app.get('/api/v1/issuer/vcards/:qrvid/analytics', requireWriteAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  const qrvid = normalizeQrvid(req.params.qrvid);
  try {
    const owned = await pool.query(
      `SELECT 1 FROM qr_objects WHERE qrvid=$1 AND issuer_id=$2 AND record_type='VCARD' LIMIT 1`,
      [qrvid, req.issuerId],
    );
    if (!owned.rows.length) return sendError(res, 404, 'VCARD_NOT_FOUND', 'Verified Contact Card was not found');
    const summary = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE event_type='registry_verify')::int AS scans,
        COUNT(*) FILTER (WHERE event_type='vcard_download')::int AS downloads,
        MAX(created_at) FILTER (WHERE event_type IN ('registry_verify','vcard_download')) AS last_interaction_at
       FROM qr_audit_log WHERE qrvid=$1 AND issuer_id=$2`,
      [qrvid, req.issuerId],
    );
    const daily = await pool.query(
      `SELECT created_at::date AS day,
        COUNT(*) FILTER (WHERE event_type='registry_verify')::int AS scans,
        COUNT(*) FILTER (WHERE event_type='vcard_download')::int AS downloads
       FROM qr_audit_log
       WHERE qrvid=$1 AND issuer_id=$2 AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY created_at::date ORDER BY day ASC`,
      [qrvid, req.issuerId],
    );
    return res.json({ ok: true, qrvid, ...summary.rows[0], daily: daily.rows, privacy: 'aggregate-only', timestamp: now() });
  } catch (error) {
    console.error('vCard analytics failed:', error);
    return sendError(res, 500, 'VCARD_ANALYTICS_FAILED', 'Unable to retrieve Verified Contact Card analytics');
  }
});

app.get('/api/v1/registry/:qrvid', publicRateLimiter, async (req, res) => {
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

export { app, mapStatus, publicVerificationRecord, safeEqual, signingKeyPairValid };
