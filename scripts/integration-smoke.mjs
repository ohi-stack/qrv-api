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
const schemaVersion = '2026-08-15-production-v5';
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
  assert.equal(issuerIsolation.response.status, 403);
  assert.equal(issuerIsolation.body.error.code, 'ISSUER_SCOPE_DENIED');

  const oversizedMetadata = await json('/api/v1/registry/create', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ recordType: 'CERT', issuer: 'Integration Issuer', title: 'Metadata Limit', metadata: { value: 'x'.repeat(70000) } }),
  });
  assert.equal(oversizedMetadata.response.status, 422);
  assert.equal(oversizedMetadata.body.error.code, 'INVALID_METADATA');

  const audit = await json(`/api/v1/registry/${encodeURIComponent(created.body.qrvid)}/audit`, { headers: authHeaders });
  assert.equal(audit.response.status, 200);
  assert.ok(audit.body.events.some((event) => event.event_type === 'registry_create'));
  assert.ok(audit.body.events.some((event) => event.event_type === 'registry_verify'));
  assert.ok(audit.body.events.some((event) => event.event_type === 'registry_revoke'));

  const contactCard = await json('/api/v1/registry/create', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({
      recordType: 'VCARD',
      issuer: 'Integration Issuer',
      visibility: 'public',
      contact: {
        givenName: 'Ada',
        familyName: 'Lovelace',
        organization: 'QR-V Integration',
        title: 'Verifier',
        phones: [{ type: 'work', value: '+1 555 0100' }],
        emails: [{ type: 'work', value: 'ada@example.com' }],
        website: 'https://qrv.network/',
      },
    }),
  });
  assert.equal(contactCard.response.status, 201);
  assert.match(contactCard.body.qrvid, /^QRV-PROD-VCARD-/);

  const verifiedContact = await json(`/api/v1/verify/${encodeURIComponent(contactCard.body.qrvid)}`);
  assert.equal(verifiedContact.body.verificationState, 'VERIFIED');
  assert.equal(verifiedContact.body.contact.formattedName, 'Ada Lovelace');
  assert.match(verifiedContact.body.vcardUrl, /\/vcard\/QRV-PROD-VCARD-/);

  const vcardResponse = await fetch(`${base}/api/v1/vcards/${encodeURIComponent(contactCard.body.qrvid)}.vcf`);
  const vcardBody = await vcardResponse.text();
  assert.equal(vcardResponse.status, 200);
  assert.match(vcardResponse.headers.get('content-type') || '', /text\/vcard/);
  assert.match(vcardBody, /FN:Ada Lovelace/);
  assert.match(vcardBody, new RegExp(`X-QRV-ID:${contactCard.body.qrvid}`));

  const updatedContact = await json(`/api/v1/issuer/vcards/${encodeURIComponent(contactCard.body.qrvid)}/update`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({
      visibility: 'restricted',
      contact: {
        formattedName: 'Ada Byron',
        emails: [{ type: 'work', value: 'ada.byron@example.com' }],
        website: 'https://qrv.network/',
        publicFields: ['formattedName', 'emails'],
      },
    }),
  });
  assert.equal(updatedContact.response.status, 200);
  assert.equal(updatedContact.body.status, 'UPDATED');
  const verifiedUpdatedContact = await json(`/api/v1/verify/${encodeURIComponent(contactCard.body.qrvid)}`);
  assert.equal(verifiedUpdatedContact.body.contact.formattedName, 'Ada Byron');
  assert.equal(verifiedUpdatedContact.body.contact.website, undefined);
  assert.equal(verifiedUpdatedContact.body.hash, undefined);

  const analytics = await json(`/api/v1/issuer/vcards/${encodeURIComponent(contactCard.body.qrvid)}/analytics`, { headers: authHeaders });
  assert.equal(analytics.response.status, 200);
  assert.ok(analytics.body.scans >= 2);
  assert.ok(analytics.body.downloads >= 1);
  assert.equal(analytics.body.privacy, 'aggregate-only');

  const bulkContacts = await json('/api/v1/issuer/vcards/bulk', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({
      issuer: 'Integration Issuer',
      cards: [
        { contact: { formattedName: 'Grace Hopper', emails: [{ value: 'grace@example.com' }] } },
        { contact: { formattedName: 'Katherine Johnson', website: 'https://qrv.network/' }, visibility: 'private' },
      ],
    }),
  });
  assert.equal(bulkContacts.response.status, 201);
  assert.equal(bulkContacts.body.count, 2);
  assert.equal(bulkContacts.body.records.length, 2);

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
