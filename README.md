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

There is no separate public registry application in the target architecture. Registry persistence, verification lookup, lifecycle mutation, and audit access are consolidated behind this API node.

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
```

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

Write/list/audit operations require the server-side `QRV_PLATFORM_API_KEY`. If that secret is missing, write operations fail closed.

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

## Deterministic public states

```text
VERIFIED
REVOKED
EXPIRED
NOT_FOUND
```

Dependency failures are not converted into `VERIFIED` or `NOT_FOUND`.

## Security baseline

- HTTPS in production.
- Strict CORS allowlist for `https://qrv.network`.
- PostgreSQL access only from the API node.
- Parameterized SQL.
- Server-side write authorization.
- Public verification rate limiting.
- Create, verify, and revoke audit events.
- Production writes fail closed when authorization is absent.

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

## Acceptance gate

Production is ready only when:

1. `/healthz` returns 200.
2. `/readyz` confirms PostgreSQL access.
3. an authorized record can be created.
4. `qrv.network/verify/{QRVID}` returns `VERIFIED` through this API.
5. an authorized revoke operation changes the same public URL to `REVOKED`.
6. audit events exist for creation, verification, and revocation.
