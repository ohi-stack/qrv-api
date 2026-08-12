import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import pkg from 'pg';

const { Pool } = pkg;

const port = Number(process.env.QRV_INTEGRATION_PORT || 4399);
const base = `http://127.0.0.1:${port}`;
const apiKey = 'integration-write-key-with-fixed-length';
const issuerId = 'integration-issuer';
const otherIssuerId = 'integration-other-issuer';
const schemaVersion = '2026-08-11-api-owned-v3';
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
const otherIssuerHeaders = { ...authHeaders, 'x-issuer-id': otherIssuerId };
const database = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

try {
  await waitReady();
  const health = await json('/healthz');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.service, 'qrv-api');
  const ready = await json('/readyz');
  assert.equal(ready.response.status, 200);
  assert.equal(ready.body.schemaVersion, schemaVersion);
  assert.equal(ready.body.signingKeyPairValid, true);

  const invalid = await json('/api/v1/registry/create', { method: 'POST', headers: { ...authHeaders, 'x-api-key': 'wrong-length' }, body: '{}' });
  assert.equal(invalid.response.status, 401);

  const wrongEnvironment = await json('/api/v1/registry/create', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ qrvid: 'QRV-TEST-CERT-999999', recordType: 'CERT', issuer: 'Integration Issuer', title: 'Wrong Environment' }),
  });
  assert.equal(wrongEnvironment.response.status, 422);
  assert.equal(wrongEnvironment.body.error.code, 'INVALID_QRVID_ENVIRONMENT');

  const invalidValidity = await json('/api/v1/registry/create', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ recordType: 'CERT', issuer: 'Integration Issuer', title: 'Invalid Validity', issuedAt: '2026-08-11T12:00:00Z', expiresAt: '2026-08-10T12:00:00Z' }),
  });
  assert.equal(invalidValidity.response.status, 422);
  assert.equal(invalidValidity.body.error.code, 'INVALID_VALIDITY_PERIOD');

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

  const issuerIsolation = await json(`/api/v1/registry/${encodeURIComponent(created.body.qrvid)}/revoke`, {
    method: 'POST', headers: otherIssuerHeaders, body: JSON.stringify({ reason: 'Must not cross issuer boundary' }),
  });
  assert.equal(issuerIsolation.response.status, 404);

  const audit = await json(`/api/v1/registry/${encodeURIComponent(created.body.qrvid)}/audit`, { headers: authHeaders });
  assert.equal(audit.response.status, 200);
  assert.ok(audit.body.events.some((event) => event.event_type === 'registry_create'));
  assert.ok(audit.body.events.some((event) => event.event_type === 'registry_verify'));
  assert.ok(audit.body.events.some((event) => event.event_type === 'registry_revoke'));

  const privateRecord = await json('/api/v1/registry/create', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ recordType: 'CERT', issuer: 'Integration Issuer', subject: 'Private Recipient', title: 'Private Certificate', visibility: 'private' }),
  });
  const privateVerify = await json(`/api/v1/verify/${encodeURIComponent(privateRecord.body.qrvid)}`);
  assert.equal(privateVerify.body.subject, undefined);
  assert.equal(privateVerify.body.title, undefined);
  assert.equal(privateVerify.body.hash, undefined);
  const privateRegistry = await json(`/api/v1/registry/${encodeURIComponent(privateRecord.body.qrvid)}`);
  assert.equal(privateRegistry.response.status, 403);

  const tamperedRecord = await json('/api/v1/registry/create', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ recordType: 'CERT', issuer: 'Integration Issuer', subject: 'Tamper Test', title: 'Original Title', visibility: 'public' }),
  });
  await database.query(
    "UPDATE qr_objects SET payload=jsonb_set(payload, '{title}', to_jsonb($2::text)) WHERE qrvid=$1",
    [tamperedRecord.body.qrvid, 'Tampered Title']
  );
  const tamperedVerify = await json(`/api/v1/verify/${encodeURIComponent(tamperedRecord.body.qrvid)}`);
  assert.equal(tamperedVerify.body.verificationState, 'INVALID_SIGNATURE');
  console.log('QR-V integration smoke passed');
} finally {
  child.kill('SIGTERM');
  await database.end();
}
