import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const port = Number(process.env.QRV_INTEGRATION_PORT || 4399);
const base = `http://127.0.0.1:${port}`;
const apiKey = 'integration-write-key-with-fixed-length';
const issuerId = 'integration-issuer';
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const child = spawn(process.execPath, ['server.js'], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: {
    ...process.env,
    NODE_ENV: 'test-integration',
    PORT: String(port),
    DATABASE_SSL: 'false',
    REQUIRE_SIGNATURES: 'true',
    QRV_WRITE_API_KEY: apiKey,
    QRV_DEFAULT_ISSUER_ID: issuerId,
    SIGNING_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    SIGNING_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    CORS_ALLOWED_ORIGINS: 'https://qrv.network',
  },
});

async function json(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  return { response, body };
}

async function waitReady() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const result = await json('/readyz');
      if (result.response.ok && result.body.ready) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('API did not become ready');
}

const authHeaders = { 'content-type': 'application/json', 'x-api-key': apiKey, 'x-issuer-id': issuerId };

try {
  await waitReady();
  const invalid = await json('/api/v1/registry/create', { method: 'POST', headers: { ...authHeaders, 'x-api-key': 'wrong-length' }, body: '{}' });
  assert.equal(invalid.response.status, 401);

  const created = await json('/api/v1/registry/create', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ recordType: 'CERT', issuer: 'Integration Issuer', subject: 'Public Recipient', title: 'Integration Certificate', visibility: 'public' }),
  });
  assert.equal(created.response.status, 201);
  assert.match(created.body.qrvid, /^QRV-/);

  const verified = await json(`/api/v1/verify/${encodeURIComponent(created.body.qrvid)}`);
  assert.equal(verified.body.verificationState, 'VERIFIED');

  const revoked = await json(`/api/v1/registry/${encodeURIComponent(created.body.qrvid)}/revoke`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ reason: 'Integration test' }),
  });
  assert.equal(revoked.body.status, 'REVOKED');
  const verifiedAfterRevoke = await json(`/api/v1/verify/${encodeURIComponent(created.body.qrvid)}`);
  assert.equal(verifiedAfterRevoke.body.verificationState, 'REVOKED');

  const privateRecord = await json('/api/v1/registry/create', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ recordType: 'CERT', issuer: 'Integration Issuer', subject: 'Private Recipient', title: 'Private Certificate', visibility: 'private' }),
  });
  const privateVerify = await json(`/api/v1/verify/${encodeURIComponent(privateRecord.body.qrvid)}`);
  assert.equal(privateVerify.body.subject, undefined);
  assert.equal(privateVerify.body.title, undefined);
  assert.equal(privateVerify.body.hash, undefined);
  console.log('QR-V integration smoke passed');
} finally {
  child.kill('SIGTERM');
}
