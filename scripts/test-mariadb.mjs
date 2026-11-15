import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import mysql from 'mysql2/promise';

const databaseUrl = process.env.QRV_MARIADB_TEST_URL;
assert.ok(databaseUrl, 'QRV_MARIADB_TEST_URL is required');
const database = new URL(databaseUrl);
assert.equal(database.pathname, '/qrv_mariadb_test', 'Use a disposable QR-V test database');
assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname));
const connection = await mysql.createConnection(databaseUrl);
const key = 'local-test-issuer-key';
const env = { ...process.env, DATABASE_URL: databaseUrl, QRV_DATA_BACKEND: 'mariadb', PORT: '0', QRV_API_KEY: key };
let server;

try {
  for (let attempt = 0; attempt < 2; attempt++) {
    const migration = spawnSync(process.execPath, ['scripts/migrate.js'], { env, encoding: 'utf8' });
    assert.equal(migration.status, 0, migration.stderr);
  }
  server = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API startup timed out')), 5000);
    server.once('exit', code => { clearTimeout(timer); reject(new Error('API exited with ' + code)); });
    server.stdout.on('data', chunk => {
      const match = String(chunk).match(/listening on (\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });

  async function request(path, status, { data, authorized = true } = {}) {
    const response = await fetch('http://127.0.0.1:' + port + path, {
      headers: { 'content-type': 'application/json', ...(authorized && { 'x-api-key': key }) },
      ...(data !== undefined && { method: 'POST', body: JSON.stringify(data) }),
      signal: AbortSignal.timeout(5000)
    });
    assert.match(response.headers.get('content-type'), /application\/json/);
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  }

  assert.equal((await request('/readyz', 200)).dataBackend, 'mariadb');
  assert.equal((await request('/api/v1/status', 200)).status, 'OPERATIONAL');
  const draft = {
    recordType: 'certificate', issuer: 'QR-V test issuer', recipient: 'Test recipient',
    title: 'MariaDB interoperability', issueDate: '2026-01-01', metadata: { source: 'integration', unicode: 'é' }
  };
  await request('/api/v1/records', 401, { data: draft, authorized: false });
  const record = await request('/api/v1/records', 201, { data: draft });
  const id = record.qrvid;
  assert.match(record.record.hash, /^[0-9a-f]{64}$/);
  assert.equal(record.record.issueDate, draft.issueDate);
  assert.match(record.verifyUrl, new RegExp('/verify/' + id + '$'));
  assert.equal((await request('/api/v1/verify/' + id, 200)).state, 'VERIFIED');
  assert.ok((await request('/api/v1/records?limit=25', 200)).records.some(row => row.qrvid === id));
  assert.equal((await request('/api/v1/records/' + id + '/revoke', 200, { data: { reason: 'local test' } })).state, 'REVOKED');
  const revoked = await request('/api/v1/verify/' + id, 200);
  assert.equal(revoked.state, 'REVOKED');
  assert.equal(revoked.hash, record.record.hash);
  const audit = (await request('/api/v1/audit/' + id, 200)).events;
  assert.ok(audit.some(event => event.event_type === 'CREATE' && event.metadata.issuer === draft.issuer));
  assert.ok(audit.some(event => event.event_type === 'REVOKE' && event.metadata.reason === 'local test'));
  assert.ok(audit.some(event => event.event_type === 'VERIFY' && event.metadata.state === 'REVOKED'));
  const expired = await request('/api/v1/records', 201, { data: { ...draft, expirationDate: '2026-01-02' } });
  assert.equal((await request('/api/v1/verify/' + expired.qrvid, 200)).state, 'EXPIRED');
  await request('/api/v1/verify/QRV-MISSING-MARIADB', 404);
  await request('/api/v1/records/QRV-MISSING-MARIADB/revoke', 404, { data: {} });

  const [hashes] = await connection.execute('SELECT hash FROM qr_hash_registry WHERE qrvid = ?', [id]);
  assert.equal(hashes[0].hash, record.record.hash);
  // A mutation must roll back if its required audit event cannot be stored.
  await connection.query('RENAME TABLE qr_audit_log TO qr_audit_log_unavailable');
  try {
    await request('/readyz', 503);
    await request('/api/v1/status', 503);
    await request('/api/v1/records/' + expired.qrvid + '/revoke', 500, { data: {} });
    const [rows] = await connection.execute('SELECT status FROM qr_objects WHERE qrvid = ?', [expired.qrvid]);
    assert.equal(rows[0].status, 'verified');
  } finally {
    await connection.query('RENAME TABLE qr_audit_log_unavailable TO qr_audit_log');
  }
  assert.equal((await request('/readyz', 200)).ready, true);
  console.log('MariaDB lifecycle, expiry, authorization, audit, rollback, and readiness checks passed');
} finally {
  if (server?.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill();
    await stopped;
  }
  await connection.end();
}
