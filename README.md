# QR-V™ API — Canonical Backend Node

`api.qrv.network` is the single backend node for the consolidated QR-V™ Global Verification Network.

## Canonical architecture

```text
Human users
  ↓
https://qrv.network
  ↓ server-to-server
https://api.qrv.network/api/v1
  ↓
PostgreSQL / Google Cloud SQL
```

There is no separate public registry application in the target architecture. Registry persistence, verification lookup, lifecycle mutation, audit access, and secured admin summaries are consolidated behind this API node.

## 30-day commercial priority

The backend must prioritize the **QR-V™ Verified Certificate Pilot** and the first paying external issuers.

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

## Public platform routes

Human-facing functionality belongs on `qrv.network`:

```text
/verify
/verify/:qrvid
/issuer
/issuer/dashboard
/issuer/records
/registry
/registry/:qrvid
/explorer
/docs
/developers
/api-reference
/status
/store
/admin
```

`/admin` is private and must call protected admin API endpoints server-side.

## API base

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

Write/list/audit operations require server-side authorization. If the required secret or authenticated issuer context is missing, write operations fail closed.

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

Billing/revenue data should be joined or fetched through a secured server-side billing boundary rather than exposing payment-provider credentials to the public platform.

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

## Database ownership

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
QRV_PLATFORM_API_KEY=
CORS_ALLOWED_ORIGINS=https://qrv.network
PGSSLMODE=require
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

Production v1 is commercially ready only when:

1. `/healthz` returns 200.
2. `/readyz` confirms PostgreSQL access.
3. an approved/authorized issuer can create a production certificate record.
4. `qrv.network/verify/{QRVID}` returns `VERIFIED` through this API.
5. expiration produces `EXPIRED` deterministically.
6. an authorized revoke operation changes the same public URL to `REVOKED`.
7. audit events exist for creation, verification, revocation, and privileged admin changes.
8. admin summary metrics can be retrieved without exposing privileged credentials.
9. billing/entitlement state can prevent unauthorized issuance.
10. Ed25519 status is reported truthfully and fails closed when signature validation is required but unavailable.
