# QR-V™ API — Canonical Backend Node

`api.qrv.network` is the private backend/data/API node for the QR-V™ Global Verification Network.

## QR-V Production Architecture v1.0

```text
Human users / issuer users
        ↓
https://qrv.network
        ↓ authenticated server-to-server calls
https://api.qrv.network/api/v1
        ↓
Canonical QR-V registry datastore
        ↓
records / certificates / issuers / hashes / audit logs
```

The production runtime uses only two active nodes:

1. `qrv.network` — public platform/application layer.
2. `api.qrv.network` — private backend/data/API layer.

There is no separate public registry application in the target architecture. Registry persistence, verification lookup, lifecycle mutation, cryptographic processing, audit access, privileged admin reads, and server-side integrations belong behind this API node.

## Strict responsibility boundary

Everything privileged, persistent, cryptographic, or machine-facing belongs here.

The API node owns:

- `/api/v1`;
- PostgreSQL / managed database access;
- record creation;
- verification resolution;
- deterministic lifecycle status;
- revocation and expiration handling;
- issuer authorization;
- SHA-256 hashing;
- Ed25519 signing/verification when production-ready;
- audit logging;
- webhooks;
- server-side billing/entitlement checks;
- rate limiting;
- privileged admin API operations;
- backend secrets.

The public platform must not receive database credentials, Supabase secret/server keys, signing private keys, unrestricted admin secrets, or payment-provider secrets.

## Canonical API base

```text
https://api.qrv.network/api/v1
```

## Core endpoints

```http
GET  /healthz
GET  /readyz
GET  /version
GET  /api/v1/verify/:qrvid
GET  /api/v1/records/:qrvid
POST /api/v1/records
POST /api/v1/records/:qrvid/revoke
GET  /api/v1/records
GET  /api/v1/audit/:qrvid
```

Write/list/audit operations require server-side authorization. If required authorization or issuer context is missing, operations fail closed.

## Admin API requirements

Protected administrative endpoints should support aggregated, least-privilege reads and audited mutations for:

```text
GET  /api/v1/admin/summary
GET  /api/v1/admin/issuers
GET  /api/v1/admin/issuers/:issuerId
GET  /api/v1/admin/records
GET  /api/v1/admin/verifications
GET  /api/v1/admin/security-status
POST /api/v1/admin/issuers/:issuerId/approve
POST /api/v1/admin/issuers/:issuerId/suspend
```

Billing/revenue data must be joined or fetched through a secured server-side billing boundary rather than exposing payment-provider credentials to the public platform.

The admin summary should be able to expose, when available:

- paying issuers;
- pilot issuers;
- production records;
- active / revoked / expired record counts;
- verification counts by period;
- API request counts;
- signing state;
- suspicious/error events;
- implementation revenue and contracted MRR summaries.

## Database authority

There must be exactly **one canonical registry datastore**.

Current production contract: PostgreSQL / Google Cloud SQL via `DATABASE_URL`.

Only this repository should receive production database credentials.

Run migrations with:

```bash
npm install
npm run migrate
```

The migration creates or upgrades:

```text
qr_objects
qr_certificates
qr_issuers
qr_hash_registry
qr_audit_log
```

Commercial implementations may require additional issuer entitlement/billing reference fields, but payment secrets must not be stored in ordinary registry records.

## Supabase policy

Supabase is optional, not additive.

If QR-V later adopts Supabase as the canonical persistence layer, configure it **only on `api.qrv.network`** using server-side credentials such as:

```env
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

and replace the PostgreSQL adapter intentionally.

Do **not** run `DATABASE_URL` and Supabase as competing registry authorities. The production system must have one canonical source of truth.

## Deterministic public states

```text
VERIFIED
REVOKED
EXPIRED
NOT_FOUND
```

Dependency failures are not converted into `VERIFIED` or `NOT_FOUND`.

## Cryptographic production gate

QRVP-1 requires SHA-256 integrity plus Ed25519 signatures. Treat these as distinct operational states.

Ed25519 is production-ready only when:

1. issuer keys are provisioned and protected;
2. canonical record payloads are signed;
3. signatures are persisted with the record;
4. verification loads the issuer public key;
5. invalid signatures fail verification;
6. key rotation/revocation is auditable.

Do not report `signatureValid: true` unless those checks actually execute successfully.

## Security baseline

- HTTPS in production.
- Strict CORS allowlist for `https://qrv.network`.
- PostgreSQL access only from the API node.
- Parameterized SQL.
- Server-side write authorization.
- Public verification rate limiting.
- Create, verify, revoke, issuer-admin, and privileged admin audit events.
- Production writes fail closed when authorization is absent.
- Admin endpoints require stronger authorization than ordinary issuer endpoints.
- No database/payment/admin secrets returned to browser clients.

## Production environment

```env
NODE_ENV=production
PORT=3000
APP_VERSION=2.0.0
QRV_PLATFORM_ORIGIN=https://qrv.network
DATABASE_URL=
DATABASE_POOL_MAX=20
PG_CONNECTION_TIMEOUT_MS=5000
PG_IDLE_TIMEOUT_MS=10000
PGSSLMODE=require
QRV_PLATFORM_API_KEY=
CORS_ALLOWED_ORIGINS=https://qrv.network
PUBLIC_RATE_WINDOW_MS=60000
PUBLIC_RATE_LIMIT=240
```

`QRV_PLATFORM_API_KEY` must match the server-side key used by `qrv.network` and must never be exposed to browser JavaScript.

## 30-day commercial priority

The backend must prioritize the **QR-V™ Verified Certificate Pilot** and first paying external issuers.

Do not expand infrastructure unless it directly supports:

```text
issuer approval/authentication
→ entitlement
→ production record creation
→ QR verification
→ expiration / revocation
→ audit trail
→ admin/revenue visibility
```

## Deployment

```text
Repository: ohi-stack/qrv-api
Branch: main
Node: 20+
Install: npm install
Migration: npm run migrate
Start: npm start
Domain: api.qrv.network
```

## Commercial acceptance gate

QR-V Production Architecture v1.0 is commercially ready only when:

1. `/healthz` returns 200.
2. `/readyz` confirms canonical database access.
3. an approved/authorized issuer can create a production certificate record.
4. `qrv.network/verify/{QRVID}` returns `VERIFIED` through this API.
5. expiration produces `EXPIRED` deterministically.
6. an authorized revoke operation changes the same public URL to `REVOKED`.
7. audit events exist for creation, verification, revocation, and privileged admin changes.
8. admin summary metrics can be retrieved without exposing privileged credentials.
9. billing/entitlement state can prevent unauthorized issuance.
10. Ed25519 status is reported truthfully and fails closed when signature validation is required but unavailable.
