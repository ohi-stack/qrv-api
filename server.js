import express from 'express';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3000);
const VERSION = process.env.APP_VERSION || '1.1.0';
const REGISTRY_BASE_URL = process.env.REGISTRY_BASE_URL;
const PUBLIC_BASE_URL = process.env.QRV_PUBLIC_BASE_URL || 'https://qrv.network';
const REGISTRY_API_KEY = process.env.REGISTRY_API_KEY;

if (!REGISTRY_BASE_URL) throw new Error('REGISTRY_BASE_URL is required');

function sendError(res, status, code, message) {
  return res.status(status).json({ ok: false, service: 'qrv-api', error: { code, message } });
}

async function registryRequest(path, options = {}) {
  const headers = { accept: 'application/json', ...(options.headers || {}) };
  if (options.auth && REGISTRY_API_KEY) headers['x-api-key'] = REGISTRY_API_KEY;
  const response = await fetch(`${REGISTRY_BASE_URL}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function canonicalizeVerification(qrvid, body) {
  const state = body.verificationState || body.status;
  return {
    qrvid,
    verificationState: state,
    recordType: body.recordType ?? body.record?.record_type ?? null,
    issuer: body.issuer ?? body.record?.issuer ?? null,
    status: body.lifecycleStatus ?? body.record?.status ?? null,
    issuedAt: body.issuedAt ?? body.record?.issued_at ?? null,
    expiresAt: body.expiresAt ?? body.record?.expires_at ?? null,
    hash: body.hash ?? body.record?.hash ?? null,
    signatureValid: body.signatureValid === true,
    source: 'qrv-registry'
  };
}

app.get('/', (_req, res) => res.json({
  ok: true,
  service: 'qrv-api',
  status: 'running',
  version: VERSION,
  publicBaseUrl: PUBLIC_BASE_URL,
  endpoints: ['GET /health', 'GET /verify/:qrvid', 'POST /certificates', 'GET /certificates', 'POST /certificates/:qrvid/revoke', 'GET /audit/:qrvid']
}));

app.get('/health', (_req, res) => res.json({ ok: true, status: 'ok', service: 'qrv-api', version: VERSION }));

app.get('/verify/:qrvid', async (req, res) => {
  const qrvid = String(req.params.qrvid || '').trim();
  if (!qrvid) return sendError(res, 422, 'INVALID_QRVID', 'QRVID is required');
  try {
    const { response, body } = await registryRequest(`/verify/${encodeURIComponent(qrvid)}`);
    if (response.status === 404) return res.status(404).json(canonicalizeVerification(qrvid, { verificationState: 'NOT_FOUND' }));
    if (!response.ok) return sendError(res, 502, 'REGISTRY_ERROR', 'Registry verification failed');
    return res.json(canonicalizeVerification(qrvid, body));
  } catch {
    return sendError(res, 503, 'REGISTRY_UNAVAILABLE', 'Unable to reach registry');
  }
});

app.post('/certificates', async (req, res) => {
  const { recipient, title, issuer, issueDate, expirationDate, metadata = {} } = req.body || {};
  if (!recipient || !title || !issuer || !issueDate) return sendError(res, 400, 'INVALID_REQUEST', 'recipient, title, issuer, and issueDate are required');
  try {
    const { response, body } = await registryRequest('/registry/create', {
      method: 'POST',
      auth: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'certificate', issuer, owner: recipient, payload: { recipient, title, issueDate, expirationDate, metadata } })
    });
    if (!response.ok) return res.status(response.status).json(body);
    return res.status(201).json({ ...body, verificationUrl: `${PUBLIC_BASE_URL}/verify/${encodeURIComponent(body.qrvid)}` });
  } catch {
    return sendError(res, 503, 'REGISTRY_UNAVAILABLE', 'Unable to reach registry');
  }
});

app.get('/certificates', async (_req, res) => sendError(res, 501, 'NOT_IMPLEMENTED', 'Certificate listing is deferred until issuer-scoped pagination is implemented'));

app.post('/certificates/:qrvid/revoke', async (req, res) => {
  try {
    const { response, body } = await registryRequest(`/registry/${encodeURIComponent(req.params.qrvid)}/revoke`, {
      method: 'POST',
      auth: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: req.body?.reason || null })
    });
    return res.status(response.status).json(body);
  } catch {
    return sendError(res, 503, 'REGISTRY_UNAVAILABLE', 'Unable to reach registry');
  }
});

app.get('/audit/:qrvid', async (req, res) => {
  try {
    const { response, body } = await registryRequest(`/registry/${encodeURIComponent(req.params.qrvid)}/audit`, { auth: true });
    return res.status(response.status).json(body);
  } catch {
    return sendError(res, 503, 'REGISTRY_UNAVAILABLE', 'Unable to reach registry');
  }
});

app.use((req, res) => sendError(res, 404, 'NOT_FOUND', `Route not found: ${req.method} ${req.path}`));
app.use((err, _req, res, _next) => {
  console.error('Unhandled API error:', err);
  return sendError(res, 500, 'INTERNAL_ERROR', 'Internal API error');
});

app.listen(PORT, '0.0.0.0', () => console.log(`qrv-api running on 0.0.0.0:${PORT}`));
