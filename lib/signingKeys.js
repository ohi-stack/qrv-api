import crypto from 'crypto';

export const SIGNING_KEY_STATES = Object.freeze([
  'active',
  'retired',
  'revoked',
  'compromised',
]);

export function deriveKeyId(publicKey) {
  const keyObject = crypto.createPublicKey(publicKey);
  const der = keyObject.export({ type: 'spki', format: 'der' });
  const fingerprint = crypto.createHash('sha256').update(der).digest('hex').slice(0, 24);
  return `ed25519-${fingerprint}`;
}

export function normalizeKeyState(value) {
  const state = String(value || '').trim().toLowerCase();
  return SIGNING_KEY_STATES.includes(state) ? state : 'unknown';
}

export function assertKeyCanIssue(key) {
  if (!key) {
    const error = new Error('No signing key is available for issuance');
    error.code = 'SIGNING_KEY_NOT_FOUND';
    throw error;
  }

  const state = normalizeKeyState(key.status);
  if (state !== 'active') {
    const error = new Error(`Signing key ${key.kid || 'unknown'} is not active`);
    error.code = 'SIGNING_KEY_NOT_ACTIVE';
    error.keyState = state;
    throw error;
  }

  if (!key.privateKey && !key.private_key) {
    const error = new Error(`Signing key ${key.kid || 'unknown'} has no private signing material`);
    error.code = 'SIGNING_PRIVATE_KEY_UNAVAILABLE';
    throw error;
  }

  return true;
}

export function keyVerificationState(key) {
  if (!key) return 'UNKNOWN_KEY';

  switch (normalizeKeyState(key.status)) {
    case 'active':
    case 'retired':
      return 'VERIFIABLE';
    case 'revoked':
      return 'REVOKED_SIGNING_KEY';
    case 'compromised':
      return 'COMPROMISED_SIGNING_KEY';
    default:
      return 'UNKNOWN_KEY';
  }
}

export function signHashWithKey(hash, key) {
  assertKeyCanIssue(key);
  const privateKey = key.privateKey || key.private_key;
  return crypto.sign(null, Buffer.from(String(hash), 'utf8'), privateKey).toString('base64');
}

export function verifyHashWithKey(hash, signature, key) {
  const keyState = keyVerificationState(key);
  if (keyState !== 'VERIFIABLE') {
    return { valid: false, keyState };
  }

  const publicKey = key.publicKey || key.public_key;
  if (!publicKey || !signature) {
    return { valid: false, keyState: 'UNKNOWN_KEY' };
  }

  try {
    const valid = crypto.verify(
      null,
      Buffer.from(String(hash), 'utf8'),
      publicKey,
      Buffer.from(String(signature), 'base64'),
    );
    return { valid, keyState };
  } catch (_error) {
    return { valid: false, keyState };
  }
}

export async function getSigningKey(pool, issuerId, kid) {
  if (!pool || !issuerId || !kid) return null;
  const result = await pool.query(
    `SELECT issuer_id, kid, algorithm, public_key, status, valid_from, retired_at, revoked_at, compromised_at
       FROM qr_signing_keys
      WHERE issuer_id = $1 AND kid = $2
      LIMIT 1`,
    [issuerId, kid],
  );
  return result.rows[0] || null;
}

export async function getActiveSigningKey(pool, issuerId) {
  if (!pool || !issuerId) return null;
  const result = await pool.query(
    `SELECT issuer_id, kid, algorithm, public_key, status, valid_from, retired_at, revoked_at, compromised_at
       FROM qr_signing_keys
      WHERE issuer_id = $1 AND status = 'active'
      ORDER BY valid_from DESC, created_at DESC
      LIMIT 1`,
    [issuerId],
  );
  return result.rows[0] || null;
}
