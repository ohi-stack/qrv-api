import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  assertKeyCanIssue,
  deriveKeyId,
  keyVerificationState,
  normalizeKeyState,
  signHashWithKey,
  verifyHashWithKey,
} from '../lib/signingKeys.js';

function makeKey(status = 'active') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return {
    kid: deriveKeyId(publicPem),
    status,
    publicKey: publicPem,
    privateKey: privatePem,
  };
}

test('deriveKeyId is deterministic for the same public key', () => {
  const key = makeKey();
  assert.equal(deriveKeyId(key.publicKey), key.kid);
  assert.match(key.kid, /^ed25519-[a-f0-9]{24}$/);
});

test('only active keys may issue', () => {
  assert.equal(assertKeyCanIssue(makeKey('active')), true);
  for (const status of ['retired', 'revoked', 'compromised']) {
    assert.throws(() => assertKeyCanIssue(makeKey(status)), { code: 'SIGNING_KEY_NOT_ACTIVE' });
  }
});

test('retired keys remain eligible for historical verification', () => {
  const key = makeKey('active');
  const hash = crypto.createHash('sha256').update('historical-record').digest('hex');
  const signature = signHashWithKey(hash, key);
  key.status = 'retired';
  assert.deepEqual(verifyHashWithKey(hash, signature, key), {
    valid: true,
    keyState: 'VERIFIABLE',
  });
});

test('revoked and compromised keys fail closed', () => {
  for (const status of ['revoked', 'compromised']) {
    const key = makeKey('active');
    const hash = crypto.createHash('sha256').update(status).digest('hex');
    const signature = signHashWithKey(hash, key);
    key.status = status;
    const result = verifyHashWithKey(hash, signature, key);
    assert.equal(result.valid, false);
    assert.equal(result.keyState, status === 'revoked' ? 'REVOKED_SIGNING_KEY' : 'COMPROMISED_SIGNING_KEY');
  }
});

test('unknown key state fails closed', () => {
  assert.equal(normalizeKeyState('unexpected'), 'unknown');
  assert.equal(keyVerificationState(null), 'UNKNOWN_KEY');
  assert.deepEqual(verifyHashWithKey('abc', 'deadbeef', null), {
    valid: false,
    keyState: 'UNKNOWN_KEY',
  });
});
