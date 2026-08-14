import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const confirmation = process.env.QRV_ACCEPTANCE_CONFIRM;
const baseUrl = String(process.env.QRV_ACCEPTANCE_BASE_URL || 'https://api.qrv.network').replace(/\/$/, '');
const apiKey = String(process.env.QRV_WRITE_API_KEY || '');
const issuerId = String(process.env.QRV_ACCEPTANCE_ISSUER_ID || process.env.QRV_DEFAULT_ISSUER_ID || '');
const platformOrigin = String(process.env.QRV_PUBLIC_BASE_URL || 'https://qrv.network').replace(/\/$/, '');
const schemaVersion = '2026-08-14-vcard-v4';
const runId = crypto.randomUUID();

if (confirmation !== 'CREATE_AND_REVOKE_TEST_RECORDS') {
  throw new Error('Set QRV_ACCEPTANCE_CONFIRM=CREATE_AND_REVOKE_TEST_RECORDS to authorize live acceptance records');
}
if (!apiKey || Buffer.byteLength(apiKey) < 32) throw new Error('QRV_WRITE_API_KEY must contain at least 32 bytes');
if (!issuerId) throw new Error('QRV_ACCEPTANCE_ISSUER_ID or QRV_DEFAULT_ISSUER_ID is required');
if (!baseUrl.startsWith('https://')) throw new Error('QRV_ACCEPTANCE_BASE_URL must use HTTPS');

const authHeaders = {
  'content-type': 'application/json',
  'x-api-key': apiKey,
  'x-issuer-id': issuerId,
  'x-request-id': runId,
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual', ...options });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { response, body };
}

async function revoke(qrvid, reason) {
  return request(`/api/v1/registry/${encodeURIComponent(qrvid)}/revoke`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ reason }),
  });
}

const createdQrvids = [];

try {
  const health = await request('/healthz');
  assert.equal(health.response.status, 200, 'healthz must return HTTP 200 without a redirect');
  assert.equal(health.body?.service, 'qrv-api', 'healthz must be served by qrv-api');

  const ready = await request('/readyz');
  assert.equal(ready.response.status, 200, 'readyz must return HTTP 200 without a redirect');
  assert.equal(ready.body?.ready, true);
  assert.equal(ready.body?.schemaVersion, schemaVersion);
  assert.equal(ready.body?.signingKeyPairValid, true);

  const unauthorized = await request('/api/v1/registry/create', {
    method: 'POST',
    headers: { ...authHeaders, 'x-api-key': 'invalid-key' },
    body: '{}',
  });
  assert.equal(unauthorized.response.status, 401);

  const publicCreate = await request('/api/v1/registry/create', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      recordType: 'CERT',
      issuer: 'QR-V Production Acceptance',
      subject: 'Automated Production Gate',
      title: `Production acceptance ${runId}`,
      visibility: 'public',
      metadata: { systemTest: true, acceptanceRunId: runId },
    }),
  });
  assert.equal(publicCreate.response.status, 201);
  assert.match(publicCreate.body?.qrvid || '', /^QRV-PROD-CERT-[0-9]{6,}$/);
  createdQrvids.push(publicCreate.body.qrvid);

  const publicVerify = await request(`/api/v1/verify/${encodeURIComponent(publicCreate.body.qrvid)}`, {
    headers: { origin: platformOrigin },
  });
  assert.equal(publicVerify.response.status, 200);
  assert.equal(publicVerify.response.headers.get('access-control-allow-origin'), platformOrigin);
  assert.equal(publicVerify.body?.verificationState, 'VERIFIED');
  assert.equal(publicVerify.body?.integrity?.hashValid, true);
  assert.equal(publicVerify.body?.integrity?.signatureValid, true);

  const privateCreate = await request('/api/v1/registry/create', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      recordType: 'CERT',
      issuer: 'QR-V Production Acceptance',
      subject: 'Protected Acceptance Subject',
      title: `Private production acceptance ${runId}`,
      visibility: 'private',
      metadata: { systemTest: true, acceptanceRunId: runId },
    }),
  });
  assert.equal(privateCreate.response.status, 201);
  createdQrvids.push(privateCreate.body.qrvid);

  const privateVerify = await request(`/api/v1/verify/${encodeURIComponent(privateCreate.body.qrvid)}`);
  assert.equal(privateVerify.response.status, 200);
  assert.equal(privateVerify.body?.verificationState, 'VERIFIED');
  assert.equal(privateVerify.body?.subject, undefined);
  assert.equal(privateVerify.body?.title, undefined);
  assert.equal(privateVerify.body?.hash, undefined);

  const privateRegistry = await request(`/api/v1/registry/${encodeURIComponent(privateCreate.body.qrvid)}`);
  assert.equal(privateRegistry.response.status, 403);

  const contactCreate = await request('/api/v1/registry/create', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      recordType: 'VCARD',
      issuer: 'QR-V Production Acceptance',
      visibility: 'public',
      contact: {
        formattedName: 'QR-V Acceptance Contact',
        organization: 'QR-V Production Acceptance',
        title: 'Automated system test',
        emails: [{ type: 'work', value: 'acceptance@example.com' }],
        website: 'https://qrv.network/',
      },
      metadata: { systemTest: true, acceptanceRunId: runId },
    }),
  });
  assert.equal(contactCreate.response.status, 201);
  assert.match(contactCreate.body?.qrvid || '', /^QRV-PROD-VCARD-[0-9]{6,}$/);
  createdQrvids.push(contactCreate.body.qrvid);

  const contactVerify = await request(`/api/v1/verify/${encodeURIComponent(contactCreate.body.qrvid)}`);
  assert.equal(contactVerify.response.status, 200);
  assert.equal(contactVerify.body?.verificationState, 'VERIFIED');
  assert.equal(contactVerify.body?.contact?.formattedName, 'QR-V Acceptance Contact');

  const contactDownload = await request(`/api/v1/vcards/${encodeURIComponent(contactCreate.body.qrvid)}.vcf`, {
    headers: { accept: 'text/vcard' },
  });
  assert.equal(contactDownload.response.status, 200);
  assert.match(contactDownload.response.headers.get('content-type') || '', /text\/vcard/);
  assert.match(contactDownload.body?.raw || '', /BEGIN:VCARD/);

  const contactUpdate = await request(`/api/v1/issuer/vcards/${encodeURIComponent(contactCreate.body.qrvid)}/update`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      visibility: 'restricted',
      contact: {
        formattedName: 'QR-V Acceptance Contact Updated',
        emails: [{ type: 'work', value: 'acceptance-updated@example.com' }],
        website: 'https://qrv.network/',
        publicFields: ['formattedName', 'emails'],
      },
    }),
  });
  assert.equal(contactUpdate.response.status, 200);
  assert.equal(contactUpdate.body?.qrvid, contactCreate.body.qrvid);

  const updatedContactVerify = await request(`/api/v1/verify/${encodeURIComponent(contactCreate.body.qrvid)}`);
  assert.equal(updatedContactVerify.body?.contact?.formattedName, 'QR-V Acceptance Contact Updated');
  assert.equal(updatedContactVerify.body?.contact?.website, undefined);

  const contactAnalytics = await request(`/api/v1/issuer/vcards/${encodeURIComponent(contactCreate.body.qrvid)}/analytics`, { headers: authHeaders });
  assert.equal(contactAnalytics.response.status, 200);
  assert.ok(contactAnalytics.body?.scans >= 2);
  assert.ok(contactAnalytics.body?.downloads >= 1);

  const publicRevoke = await revoke(publicCreate.body.qrvid, `Production acceptance completed: ${runId}`);
  assert.equal(publicRevoke.response.status, 200);
  assert.equal(publicRevoke.body?.status, 'REVOKED');

  const publicVerifyAfterRevoke = await request(`/api/v1/verify/${encodeURIComponent(publicCreate.body.qrvid)}`);
  assert.equal(publicVerifyAfterRevoke.response.status, 200);
  assert.equal(publicVerifyAfterRevoke.body?.verificationState, 'REVOKED');

  const audit = await request(`/api/v1/registry/${encodeURIComponent(publicCreate.body.qrvid)}/audit`, { headers: authHeaders });
  assert.equal(audit.response.status, 200);
  for (const eventType of ['registry_create', 'registry_verify', 'registry_revoke']) {
    assert.ok(audit.body?.events?.some((event) => event.event_type === eventType), `missing ${eventType} audit event`);
  }

  const privateRevoke = await revoke(privateCreate.body.qrvid, `Production acceptance completed: ${runId}`);
  assert.equal(privateRevoke.response.status, 200);
  assert.equal(privateRevoke.body?.status, 'REVOKED');

  const contactRevoke = await revoke(contactCreate.body.qrvid, `Production acceptance completed: ${runId}`);
  assert.equal(contactRevoke.response.status, 200);
  assert.equal(contactRevoke.body?.status, 'REVOKED');
  const contactVerifyAfterRevoke = await request(`/api/v1/verify/${encodeURIComponent(contactCreate.body.qrvid)}`);
  assert.equal(contactVerifyAfterRevoke.body?.verificationState, 'REVOKED');
  const contactDownloadAfterRevoke = await request(`/api/v1/vcards/${encodeURIComponent(contactCreate.body.qrvid)}.vcf`);
  assert.equal(contactDownloadAfterRevoke.response.status, 410);

  console.log(JSON.stringify({
    ok: true,
    service: 'qrv-api',
    schemaVersion,
    acceptanceRunId: runId,
    recordsCreatedAndRevoked: createdQrvids,
  }, null, 2));
} finally {
  for (const qrvid of createdQrvids) {
    await revoke(qrvid, `Production acceptance cleanup: ${runId}`).catch(() => {});
  }
}
