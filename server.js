import express from 'express';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3000);
const VERSION = process.env.APP_VERSION || '1.0.0';
const REGISTRY_BASE_URL = process.env.REGISTRY_BASE_URL || 'https://registry.qrv.network';
const VERIFY_BASE_URL = process.env.VERIFY_BASE_URL || 'https://verify.qrv.network';

function sendError(res, status, code, message, details = undefined) {
  return res.status(status).json({
    ok: false,
    service: 'qrv-api',
    error: { code, message, ...(details ? { details } : {}) }
  });
}

function apiRoot() {
  return {
    ok: true,
    service: 'qrv-api',
    status: 'running',
    role: 'public-api-gateway',
    version: VERSION,
    registryBaseUrl: REGISTRY_BASE_URL,
    verifyBaseUrl: VERIFY_BASE_URL,
    endpoints: [
      '/',
      '/healthz',
      '/health',
      '/readyz',
      '/ready',
      '/version',
      '/api/v1/verify/:qrvid',
      '/verify/:qrvid'
    ],
    uiPolicy: 'api.qrv.network returns JSON only. Issuer UI belongs on issuer.qrv.network.'
  };
}

async function registryGet(path) {
  const response = await fetch(`${REGISTRY_BASE_URL}${path}`, {
    headers: { accept: 'application/json' }
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : { raw: await response.text().catch(() => '') };
  return { response, body };
}

app.get('/', (_req, res) => res.json(apiRoot()));
app.get('/healthz', (_req, res) => res.json({ ok: true, status: 'ok', service: 'qrv-api', version: VERSION }));
app.get('/health', (_req, res) => res.json({ ok: true, status: 'ok', service: 'qrv-api', version: VERSION }));
app.get('/version', (_req, res) => res.json({ ok: true, service: 'qrv-api', version: VERSION }));

async function readiness(_req, res) {
  try {
    const { response, body } = await registryGet('/ready');
    return res.status(response.ok ? 200 : 503).json({
      ok: response.ok,
      ready: response.ok,
      service: 'qrv-api',
      registry: body
    });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      ready: false,
      service: 'qrv-api',
      error: { code: 'REGISTRY_UNAVAILABLE', message: 'Unable to reach registry readiness endpoint' }
    });
  }
}

app.get('/readyz', readiness);
app.get('/ready', readiness);

app.get('/api/v1/verify/:qrvid', async (req, res) => {
  const qrvid = String(req.params.qrvid || '').trim();
  if (!qrvid) return sendError(res, 422, 'INVALID_QRVID', 'QRVID is required');

  try {
    const { response, body } = await registryGet(`/verify/${encodeURIComponent(qrvid)}`);
    return res.status(response.status).json({
      ...body,
      source: 'qrv-api',
      canonicalUrl: `${VERIFY_BASE_URL}/${encodeURIComponent(qrvid)}`
    });
  } catch (_err) {
    return sendError(res, 503, 'REGISTRY_UNAVAILABLE', 'Unable to reach registry');
  }
});

app.get('/verify/:qrvid', (req, res) => {
  return res.status(308).json({
    ok: true,
    service: 'qrv-api',
    action: 'redirect_to_public_verification_ui',
    qrvid: req.params.qrvid,
    canonicalUrl: `${VERIFY_BASE_URL}/${encodeURIComponent(req.params.qrvid)}`
  });
});

app.use((req, res) => sendError(res, 404, 'NOT_FOUND', `Route not found: ${req.method} ${req.path}`));

app.use((err, _req, res, _next) => {
  console.error('Unhandled API error:', err);
  return sendError(res, 500, 'INTERNAL_ERROR', 'Internal API error');
});

app.listen(PORT, '0.0.0.0', () => console.log(`qrv-api running on 0.0.0.0:${PORT}`));
