import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { mapStatus, publicVerificationRecord, safeEqual } = await import('../server.js');

test('credential comparison rejects different lengths without throwing', () => {
  assert.equal(safeEqual('short', 'a-much-longer-secret'), false);
  assert.equal(safeEqual('same-secret', 'same-secret'), true);
});

test('verification status fails closed for unsupported states', () => {
  assert.equal(mapStatus({ status: 'active' }), 'VERIFIED');
  assert.equal(mapStatus({ status: 'revoked' }), 'REVOKED');
  assert.equal(mapStatus({ status: 'suspended' }), 'INVALID_STATUS');
  assert.equal(mapStatus({ status: 'pending' }), 'INVALID_STATUS');
});

test('restricted and private records omit protected fields', () => {
  const row = {
    qrvid: 'QRV-PROD-CERT-000001',
    issuer: 'Example Issuer',
    record_type: 'CERT',
    owner: 'Private Recipient',
    title: 'Private Certificate',
    hash: 'secret-hash',
    visibility: 'private',
  };
  const result = publicVerificationRecord(row, 'VERIFIED', { hashValid: true, signatureValid: true });
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.subject, undefined);
  assert.equal(result.title, undefined);
  assert.equal(result.hash, undefined);
});

test('public records include approved verification fields', () => {
  const row = {
    qrvid: 'QRV-PROD-CERT-000001', issuer: 'Example Issuer', record_type: 'CERT',
    owner: 'Public Recipient', title: 'Public Certificate', hash: 'hash', visibility: 'public',
  };
  const result = publicVerificationRecord(row, 'VERIFIED', null);
  assert.equal(result.subject, 'Public Recipient');
  assert.equal(result.title, 'Public Certificate');
  assert.equal(result.hash, 'hash');
});
