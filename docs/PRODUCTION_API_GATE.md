# QR-V™ API Production Gate

This file defines the minimum production gate for `api.qrv.network`.

## Purpose

`api.qrv.network` is the trusted backend, API, registry, cryptographic, webhook, and audit boundary for QR-V. It is the only runtime node allowed to own canonical persistence and privileged write operations.

## Mandatory environment

```env
NODE_ENV=production
PORT=3000
APP_VERSION=2.1.0

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

## Required database tables

```text
qr_objects
qr_certificates
qr_issuers
qr_hash_registry
qr_audit_log
```

## Deterministic response rule

Verification must return only deterministic user-facing states:

```text
VERIFIED
REVOKED
EXPIRED
NOT_FOUND
```

Infrastructure failures must not be reported as `NOT_FOUND` or `VERIFIED`.

## Go-live test sequence

```bash
npm install
npm run check
npm run migrate
npm run validate:prod
npm start
```

Then verify:

```bash
curl -i https://api.qrv.network/healthz
curl -i https://api.qrv.network/readyz
curl -i https://api.qrv.network/version
curl -i https://api.qrv.network/api/v1/status
curl -i https://api.qrv.network/api/v1/verify/QRV-PROD-CERT-000001
```

## Launch proof

The API is not production-ready until this path works end to end:

```text
POST /api/v1/records
→ returns QRVID
→ GET /api/v1/verify/{QRVID} returns VERIFIED
→ POST /api/v1/records/{QRVID}/revoke
→ GET /api/v1/verify/{QRVID} returns REVOKED
→ GET /api/v1/audit/{QRVID} shows create, verify, revoke, verify events
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

## Current priority

Do not expand billing, wallets, or advanced modules until the first production certificate lifecycle passes:

```text
ISSUE → STORE → QR → VERIFY → REVOKE → REVOKED
```
