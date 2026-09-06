const apiBase = (process.env.QRV_API_URL || 'https://api.qrv.network').replace(/\/$/, '');
const demoQrvid = process.env.QRV_DEMO_QRVID || 'QRV-PROD-CERT-000001';
const unknownQrvid = process.env.QRV_UNKNOWN_QRVID || 'QRV-PROD-CERT-DOES-NOT-EXIST';
const malformedQrvid = process.env.QRV_MALFORMED_QRVID || 'NOT-A-QRVID';
const timeoutMs = Number(process.env.QRV_ACCEPTANCE_TIMEOUT_MS || 10000);

const checks = [
  { name: 'healthz', path: '/healthz', status: 200, expect: 'json', validate: body => body?.ok === true && body?.service === 'qrv-api' },
  { name: 'readyz', path: '/readyz', status: 200, expect: 'json', validate: body => body?.ready === true && body?.database === 'connected' },
  { name: 'version', path: '/version', status: 200, expect: 'json', validate: body => body?.service === 'qrv-api' && typeof body?.version === 'string' },
  { name: 'status', path: '/api/v1/status', status: 200, expect: 'json', validate: body => body?.status === 'OPERATIONAL' },
  { name: 'verify-known', path: `/api/v1/verify/${encodeURIComponent(demoQrvid)}`, status: 200, expect: 'json', validate: body => body?.qrvid === demoQrvid && body?.state === 'VERIFIED' && body?.verified === true },
  { name: 'verify-unknown', path: `/api/v1/verify/${encodeURIComponent(unknownQrvid)}`, status: 404, expect: 'json', validate: body => body?.qrvid === unknownQrvid && body?.state === 'NOT_FOUND' && body?.verified === false },
  { name: 'verify-malformed', path: `/api/v1/verify/${encodeURIComponent(malformedQrvid)}`, status: 422, expect: 'json', validate: body => body?.error?.code === 'INVALID_QRVID' }
];

async function run(check) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const url = `${apiBase}${check.path}`;
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'user-agent': 'qrv-api-production-acceptance/1.0'
      },
      signal: controller.signal
    });
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}

    const statusOk = response.status === check.status;
    const jsonOk = check.expect !== 'json' || contentType.includes('application/json');
    const bodyOk = typeof check.validate === 'function' ? Boolean(check.validate(body)) : true;
    const redirectOk = response.status < 300 || response.status >= 400;
    const passed = statusOk && jsonOk && bodyOk && redirectOk;

    return {
      name: check.name,
      url,
      status: response.status,
      contentType,
      elapsedMs: Date.now() - startedAt,
      passed,
      note: passed ? 'PASS' : [
        !statusOk ? `expected ${check.status}, got ${response.status}` : '',
        !jsonOk ? `expected application/json, got ${contentType || 'unknown'}` : '',
        !bodyOk ? 'response contract mismatch' : '',
        !redirectOk ? `unexpected redirect to ${response.headers.get('location') || 'unknown'}` : ''
      ].filter(Boolean).join('; ')
    };
  } catch (error) {
    return {
      name: check.name,
      url,
      status: 0,
      contentType: '',
      elapsedMs: Date.now() - startedAt,
      passed: false,
      note: error.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : error.message
    };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
for (const check of checks) results.push(await run(check));
console.table(results.map(({ name, status, elapsedMs, passed, note }) => ({ name, status, elapsedMs, result: passed ? 'PASS' : 'FAIL', note })));

const failures = results.filter(result => !result.passed);
console.log(JSON.stringify({
  service: 'qrv-api',
  architecture: 'two-node-consolidated',
  apiBase,
  demoQrvid,
  unknownQrvid,
  malformedQrvid,
  checkedAt: new Date().toISOString(),
  passed: failures.length === 0,
  results
}, null, 2));

if (failures.length) process.exitCode = 1;
