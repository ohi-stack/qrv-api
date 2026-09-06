# QR-V™ API Production Gate

This file defines the minimum production gate for `api.qrv.network`.

## Purpose

`api.qrv.network` is the trusted backend, API, registry, cryptographic, webhook, and audit boundary for QR-V. It is the only runtime node allowed to own canonical persistence and privileged write operations.

## Current release state

**Production acceptance is blocked until `api.qrv.network` is mapped to this application and the live acceptance suite passes.**

A frontend HTML response, login redirect, or framework 404 from an API route is an automatic release failure.

## Mandatory environment

```env
NODE_ENV=production
PORT=3000
APP_VERSION=2.1.1

QRV_API_BASE_URL=https://api.qrv.network
QRV_PUBLIC_BASE_URL=https://qrv.network
QRV_PLATFORM_ORIGIN=https://qrv.network
QRV_VERIFY_BASE_URL=https://qrv.network/verify
QRV_REGISTRY_BASE_URL=https://qrv.network/registry

QRV_DATA_BACKEND=supabase-postgres
SUPABASE_URL=
SUPABASE_SECRET_KEY=
DATABASE_URL=
PGSSLMODE=require

QRV_API_KEY=
QRV_PLATFORM_API_KEY=
QRV_WEBHOOK_SECRET=
CORS_ORIGINS=https://qrv.network
PUBLIC_RATE_WINDOW_MS=60000
PUBLIC_RATE_LIMIT=240
LOG_LEVEL=info
```

## One registry authority rule

Select one writable registry authority.

Accepted production options:

```text
QRV_DATA_BACKEND=supabase-postgres
QRV_DATA_BACKEND=postgres
```

If Supabase is used, `DATABASE_URL` must point to the PostgreSQL connection string belonging to the same Supabase project identified by `SUPABASE_URL`.

Do not configure Supabase and Cloud SQL as two independent writable registries.

## Required endpoints

```http
GET  /healthz
GET  /readyz
GET  /version
GET  /api/v1/status
GET  /api/v1/verify/:qrvid
GET  /api/v1/records/:qrvid
GET  /api/v1/records
POST /api/v1/records
POST /api/v1/records/:qrvid/revoke
GET  /api/v1/audit/:qrvid
```

All API endpoints must return JSON. Browser HTML, login pages, framework error pages, and redirects are invalid API responses.

## Required database tables

```text
qr_objects
qr_certificates
qr_issuers
qr_hash_registry
qr_audit_log
```

`/readyz` must confirm required database access and must return a non-2xx status when the canonical registry dependency is unavailable.

## Deterministic response rule

Verification must preserve these deterministic states:

```text
VERIFIED
REVOKED
EXPIRED
NOT_FOUND
```

Transport or dependency failures must never be converted into `NOT_FOUND` or `VERIFIED`.

### HTTP contract

```text
Known valid record       → 200 JSON VERIFIED
Known revoked record     → 200 JSON REVOKED
Known expired record     → 200 JSON EXPIRED
Valid but absent QRVID   → 404 JSON NOT_FOUND
Malformed QRVID          → 422 JSON INVALID_QRVID
Registry unavailable     → 5xx JSON error / unavailable state
Unauthorized write       → 401 JSON UNAUTHORIZED
Missing write config     → 503 JSON WRITE_AUTH_NOT_CONFIGURED
```

## Cryptographic gate

SHA-256 integrity and Ed25519 issuer signatures are separate production controls.

The API must not report `signatureValid: true` unless Ed25519 verification actually executes against the issuer public key.

Full QRVP-1 signing readiness requires:

1. issuer private keys provisioned outside the repository;
2. canonical payload serialization locked;
3. records signed on authorized issuance;
4. signature and key ID persisted;
5. issuer public key resolved during verification;
6. invalid signatures fail verification;
7. key rotation and compromise revocation are auditable.

Until then, public/API responses should truthfully indicate that SHA-256 is active and Ed25519 is pending.

## Go-live test sequence

```bash
npm install
npm run check
npm run migrate
npm run validate:prod
npm start
```

Then run the repeatable live gate:

```bash
QRV_API_URL=https://api.qrv.network \
QRV_DEMO_QRVID=QRV-PROD-CERT-000001 \
npm run acceptance:live
```

The live gate verifies:

```text
/healthz                         200 JSON
/readyz                          200 JSON + database connected
/version                         200 JSON
/api/v1/status                   200 JSON OPERATIONAL
/api/v1/verify/{known}           200 JSON VERIFIED
/api/v1/verify/{unknown}         404 JSON NOT_FOUND
/api/v1/verify/{malformed}       422 JSON INVALID_QRVID
```

## Launch proof

The API is not production-ready until this path works end to end against the canonical production registry:

```text
POST /api/v1/records
→ returns QRVID
→ GET /api/v1/verify/{QRVID} returns VERIFIED
→ POST /api/v1/records/{QRVID}/revoke
→ GET /api/v1/verify/{QRVID} returns REVOKED
→ GET /api/v1/audit/{QRVID} shows create, verify, revoke, verify events
```

## Hostinger cutover order

```text
1. Back up the canonical PostgreSQL registry.
2. Map api.qrv.network to ohi-stack/qrv-api.
3. Configure production environment variables.
4. Run npm run migrate.
5. Start/redeploy the API.
6. Confirm /healthz and /version return JSON.
7. Confirm /readyz reports database connected.
8. Run npm run acceptance:live.
9. Run authenticated create → verify → revoke → verify acceptance.
10. Only then deploy dependent qrv.network platform changes.
```

## Security gate

Before public launch:

- no database secrets in `qrv.network`
- no `SUPABASE_SECRET_KEY` in browser code
- no signing private keys in repositories
- CORS restricted to `https://qrv.network`
- write endpoints require `x-api-key` or stronger issuer auth
- rate limiting enabled
- readiness fails closed when database is unavailable
- migrations are repeatable
- database backup is captured before schema change
- database ingress is not left open to `0.0.0.0/0`

## Current priority

Do not expand billing, wallets, or speculative modules until the first production certificate lifecycle passes:

```text
ISSUE → STORE → QR → VERIFY → REVOKE → REVOKED
```
