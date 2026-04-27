import express from 'express';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3000);
const VERSION = process.env.APP_VERSION || '1.0.0';
const REGISTRY_BASE_URL = process.env.REGISTRY_BASE_URL || 'https://registry.qrv.network';
const VERIFY_BASE_URL = process.env.VERIFY_BASE_URL || 'https://verify.qrv.network';

function error(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

async function registryGet(path) {
  const response = await fetch(`${REGISTRY_BASE_URL}${path}`);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

app.get('/', (_req, res) => {
  res.json({
    service: 'qrv-api',
    status: 'running',
    role: 'public-api-gateway',
    version: VERSION,
    registryBaseUrl: REGISTRY_BASE_URL,
    verifyBaseUrl: VERIFY_BASE_URL
  });
});

app.get('/healthz', (_req, res) => res.json({ status: 'ok', service: 'qrv-api', version: VERSION }));
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'qrv-api', version: VERSION }));
app.get('/version', (_req, res) => res.json({ service: 'qrv-api', version: VERSION }));

app.get('/readyz', async (_req, res) => {
  try {
    const { response, body } = await registryGet('/ready');
    return res.status(response.ok ? 200 : 503).json({ ready: response.ok, registry: body });
  } catch (err) {
    return res.status(503).json({ ready: false, error: err.message });
  }
});

app.get('/api/v1/verify/:qrvid', async (req, res) => {
  try {
    const { response, body } = await registryGet(`/verify/${encodeURIComponent(req.params.qrvid)}`);
    return res.status(response.status).json({ ...body, source: 'qrv-api', canonicalUrl: `${VERIFY_BASE_URL}/${encodeURIComponent(req.params.qrvid)}` });
  } catch (err) {
    return error(res, 503, 'REGISTRY_UNAVAILABLE', 'Unable to reach registry');
  }
});

app.get('/verify/:qrvid', (req, res) => {
  return res.redirect(302, `${VERIFY_BASE_URL}/${encodeURIComponent(req.params.qrvid)}`);
});

app.use((_req, res) => error(res, 404, 'NOT_FOUND', 'Route not found'));

app.listen(PORT, '0.0.0.0', () => console.log(`qrv-api running on 0.0.0.0:${PORT}`));
