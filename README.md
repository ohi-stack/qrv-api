# QR-V™ API — Canonical Backend Node

`api.qrv.network` is the trusted backend, API, and canonical data boundary for the QR-V™ Global Verification Network.

## Production architecture

QR-V uses exactly two runtime nodes:

1. `qrv.network` — public platform/application node.
2. `api.qrv.network` — trusted backend/API/data node.

```text
Browser / issuer user
        ↓
https://qrv.network
        ↓ authenticated HTTPS
https://api.qrv.network/api/v1
        ↓
Canonical QR-V registry datastore
```

All human-facing routes belong to `qrv.network`. All privileged, persistent, cryptographic, machine-facing, audit, and mutation logic belongs here.

## Canonical API

```text
https://api.qrv.network/api/v1
```

Core endpoints:

```http
GET  /healthz
GET  /readyz
GET  /version
GET  /api/v1/verify/:qrvid
GET  /api/v1/records/:qrvid
GET  /api/v1/records
POST /api/v1/records
POST /api/v1/records/:qrvid/revoke
GET  /api/v1/audit/:qrvid
```

The public platform may preserve `qrv.network/api/v1/*` as a compatibility/proxy surface, but authoritative backend execution occurs only on `api.qrv.network`.

## Canonical datastore rule

QR-V must have exactly one writable canonical registry authority.

The preferred production contract supports Supabase as a managed PostgreSQL authority without creating a second registry:

```env
QRV_DATA_BACKEND=supabase-postgres
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
DATABASE_URL=<postgres connection string from the SAME Supabase project>
```

`SUPABASE_SECRET_KEY` is server-only. The current Node API uses PostgreSQL for transactional registry operations; when Supabase is selected, `DATABASE_URL` must point to the PostgreSQL database belonging to the same Supabase project identified by `SUPABASE_URL`.

Direct managed PostgreSQL/Cloud SQL remains supported as an explicit alternative:

```env
QRV_DATA_BACKEND=postgres
DATABASE_URL=<canonical managed PostgreSQL URL>
```

Do not configure Supabase and Cloud SQL as two independent writable authorities.

## Environment contract

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
DATABASE_POOL_MAX=20
PG_CONNECTION_TIMEOUT_MS=5000
PG_IDLE_TIMEOUT_MS=10000
PGSSLMODE=require

QRV_API_KEY=
QRV_PLATFORM_API_KEY=
QRV_WEBHOOK_SECRET=

CORS_ORIGINS=https://qrv.network
CORS_ALLOWED_ORIGINS=https://qrv.network
LOG_LEVEL=info

PUBLIC_RATE_WINDOW_MS=60000
PUBLIC_RATE_LIMIT=240
```

`QRV_API_KEY` is the canonical protected server API secret. `QRV_PLATFORM_API_KEY` is retained temporarily as a compatibility alias for the same secret until every caller is migrated.

## Secret-placement rule

Never expose any of the following to browser JavaScript:

```text
SUPABASE_SECRET_KEY
DATABASE_URL
QRV_API_KEY
QRV_PLATFORM_API_KEY
QRV_WEBHOOK_SECRET
JWT_SECRET
Ed25519 private signing keys
database administrator credentials
```

## Registry model

The current migration provisions the core QR-V registry tables:

```text
qr_objects
qr_certificates
qr_issuers
qr_hash_registry
qr_audit_log
```

Run:

```bash
npm install
npm run migrate
```

When using Supabase, the migration connection must target the same Supabase PostgreSQL project used in production.

## Deterministic verification states

Public verification state is limited to:

```text
VERIFIED
REVOKED
EXPIRED
NOT_FOUND
```

Infrastructure failures must not be converted into `NOT_FOUND` or `VERIFIED`; they are service failures.

## Cryptographic state

SHA-256 integrity is active in the current implementation. Ed25519 must not be represented as operational until issuer key provisioning, canonical signing, signature persistence, public-key resolution, signature validation, key rotation, and failure handling are all implemented and tested.

## Security baseline

- HTTPS only in production.
- Strict CORS allowlist for `https://qrv.network`.
- Database access only from this backend boundary.
- Parameterized SQL and transactional writes.
- Protected issuance and revocation.
- Rate-limited public verification.
- Auditable create, verify, revoke, and privileged operations.
- Fail-closed writes when API authorization is missing.
- No backend secrets returned to clients.

## Deployment

```text
Repository: ohi-stack/qrv-api
Branch: main
Runtime: Node.js 20+
Install: npm install
Migration: npm run migrate
Start: npm start
Domain: api.qrv.network
```

## Production acceptance

A production release is accepted only when:

1. `/healthz` returns HTTP 200.
2. `/readyz` confirms access to the canonical registry.
3. an authorized issuer can create a record.
4. `qrv.network/verify/{QRVID}` resolves through this API.
5. the record returns `VERIFIED` when valid.
6. expiration returns `EXPIRED` deterministically.
7. revocation changes the same public URL to `REVOKED`.
8. missing records return `NOT_FOUND`.
9. audit events exist for issuance, verification, and revocation.
10. the configured data authority is singular and traceable to the intended Supabase/PostgreSQL project.
