import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = {
  api: await readFile(new URL('../openapi/qrv-api-v1.yaml', import.meta.url), 'utf8'),
  server: await readFile(new URL('../server.js', import.meta.url), 'utf8'),
  migration: await readFile(new URL('./migrate.js', import.meta.url), 'utf8'),
  env: await readFile(new URL('../.env.example', import.meta.url), 'utf8'),
};

const requiredRoutes = [
  '/healthz',
  '/readyz',
  '/version',
  '/api/v1/verify/:qrvid',
  '/api/v1/registry/create',
  '/api/v1/registry/:qrvid',
  '/api/v1/registry/:qrvid/revoke',
  '/api/v1/registry/:qrvid/audit',
  '/api/v1/issuer/records',
  '/api/v1/issuer/analytics',
];

for (const route of requiredRoutes) {
  assert.ok(files.server.includes(route), `server route missing: ${route}`);
  const openApiRoute = route.replaceAll(':qrvid', '{qrvid}');
  assert.ok(files.api.includes(openApiRoute), `OpenAPI path missing: ${openApiRoute}`);
}

for (const state of ['VERIFIED', 'REVOKED', 'EXPIRED', 'NOT_FOUND', 'INVALID_SIGNATURE', 'UNAVAILABLE']) {
  assert.ok(files.api.includes(state), `OpenAPI verification state missing: ${state}`);
}

const schemaFromServer = files.server.match(/SCHEMA_VERSION = '([^']+)'/)?.[1];
const schemaFromMigration = files.migration.match(/SCHEMA_VERSION = '([^']+)'/)?.[1];
assert.ok(schemaFromServer, 'server schema version is missing');
assert.equal(schemaFromServer, schemaFromMigration, 'server and migration schema versions differ');

for (const key of [
  'DATABASE_URL', 'QRV_WRITE_API_KEY', 'QRV_DEFAULT_ISSUER_ID', 'REQUIRE_SIGNATURES',
  'SIGNING_PRIVATE_KEY', 'SIGNING_PUBLIC_KEY', 'CORS_ALLOWED_ORIGINS',
  'RATE_LIMIT_MAX', 'ISSUER_RATE_LIMIT_MAX', 'ISSUER_READ_RATE_LIMIT_MAX',
]) {
  assert.match(files.env, new RegExp(`^${key}=`, 'm'), `.env.example is missing ${key}`);
}

console.log(JSON.stringify({ ok: true, contract: 'qrv-api-v1', schemaVersion: schemaFromServer, routes: requiredRoutes.length }));
