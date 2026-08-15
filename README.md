# QR-V™ API — Canonical Backend Node

`api.qrv.network` is the only production backend application node for the QR-V™ Global Verification Network.

## Two-Node Architecture

```text
Browser / scanner / issuer
        ↓
https://qrv.network
        ↓
https://api.qrv.network/api/v1
        ↓
PostgreSQL QR-V registry
```

All public and authenticated browser experiences live under `qrv.network/<route>`. The API owns registry persistence, issuance, verification, revocation, audit access, and future billing/integration services.

## Canonical Public Verification URL

```text
https://qrv.network/verify/{qrvid}
```

Previously issued links using `verify.qrv.network` should be preserved through permanent compatibility redirects during migration.

## Canonical API Base

```text
https://api.qrv.network/api/v1
```

## Core Endpoints

```http
GET  /healthz
GET  /readyz
GET  /version
GET  /metrics

GET  /api/v1/verify/:qrvid
GET  /api/v1/registry/:qrvid
GET  /api/v1/registry/hash/:hash
GET  /api/v1/registry/:qrvid/audit

POST /api/v1/registry/create
POST /api/v1/revoke
POST /api/v1/registry/:qrvid/revoke
```

The normative machine-readable contract is [`openapi/qrv-api-v1.yaml`](openapi/qrv-api-v1.yaml). `npm run contract:check` prevents route, schema-version, state, and environment drift.

## Verified Contact Cards

QR-V supports dynamic, signed `VCARD` records with field-level disclosure, one-tap VCF download, aggregate analytics, and transactional bulk issuance. See [`docs/VERIFIED_CONTACT_CARD.md`](docs/VERIFIED_CONTACT_CARD.md).

## Canonical Lifecycle

```text
AUTHENTICATE
→ AUTHORIZE ISSUER
→ VALIDATE REQUEST
→ GENERATE QRV-{ENV}-{TYPE}-{SEQUENCE}
→ CANONICALIZE PAYLOAD
→ SHA-256 HASH
→ ED25519 SIGN
→ WRITE POSTGRESQL RECORD
→ WRITE AUDIT EVENT
→ RETURN qrv.network/verify/{qrvid}
```

## Verification States

```text
VERIFIED
REVOKED
EXPIRED
NOT_FOUND
INVALID_SIGNATURE
```

Dependency failure must fail closed as an API error. It must never be represented as `VERIFIED` or `NOT_FOUND`.

## Database

Run the migration before first deployment or after schema upgrades:

```bash
npm install
npm run migrate
npm run validate:prod
npm start
```

The migration owns:

```text
qrv_record_seq
qr_objects
qr_issuers
qr_hash_registry
qr_certificates
qr_audit_log
registry_records view
```

## Security

Production requires:

- `DATABASE_URL` configured only on the API node;
- TLS-protected PostgreSQL connectivity;
- `QRV_WRITE_API_KEY` for write endpoints;
- strict CORS to `https://qrv.network`;
- rate limiting;
- parameterized SQL;
- append-oriented audit events;
- SHA-256 hashes;
- Ed25519 signing keys when `REQUIRE_SIGNATURES=true`;
- secrets stored only in deployment configuration.

## Environment

```env
NODE_ENV=production
PORT=3000
APP_VERSION=2.1.0
QRV_PUBLIC_BASE_URL=https://qrv.network
QRV_API_BASE_URL=https://api.qrv.network/api/v1
QRV_ENV_CODE=PROD
DATABASE_URL=
DATABASE_SSL=true
DATABASE_SSL_REJECT_UNAUTHORIZED=true
QRV_WRITE_API_KEY=
REQUIRE_SIGNATURES=true
SIGNING_PRIVATE_KEY=
SIGNING_PUBLIC_KEY=
# Base64 alternatives may be used when the deployment panel cannot preserve PEM line breaks.
SIGNING_PRIVATE_KEY_BASE64=
SIGNING_PUBLIC_KEY_BASE64=
CORS_ALLOWED_ORIGINS=https://qrv.network
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=180
ISSUER_RATE_LIMIT_WINDOW_MS=60000
ISSUER_RATE_LIMIT_MAX=60
ISSUER_READ_RATE_LIMIT_WINDOW_MS=60000
ISSUER_READ_RATE_LIMIT_MAX=240
```

## Production Gate

A release is complete only when:

1. `/healthz` returns 200;
2. `/readyz` confirms database and security readiness;
3. migrations are current;
4. an authorized create request returns a canonical QRVID;
5. `/api/v1/verify/{qrvid}` returns `VERIFIED`;
6. `qrv.network/verify/{qrvid}` renders the same state;
7. revocation succeeds;
8. the same public route renders `REVOKED`;
9. create, verify, and revoke audit events exist.

Run the guarded live gate only after the production hostname, database, and secrets are configured:

```bash
QRV_ACCEPTANCE_CONFIRM=CREATE_AND_REVOKE_TEST_RECORDS npm run validate:live
```

The command creates two expressly identified acceptance records and revokes both before completion. See [`docs/PRODUCTION_DEPLOYMENT.md`](docs/PRODUCTION_DEPLOYMENT.md) for the ordered deployment and rollback procedure.

Production governance and operations are defined in:

- [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md)
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- [`docs/CRYPTOGRAPHIC_KEY_MANAGEMENT.md`](docs/CRYPTOGRAPHIC_KEY_MANAGEMENT.md)
- [`docs/DATA_GOVERNANCE.md`](docs/DATA_GOVERNANCE.md)
- [`SECURITY.md`](SECURITY.md)

The consolidation removes `registry.qrv.network`, `verify.qrv.network`, `issuer.qrv.network`, `docs.qrv.network`, `developers.qrv.network`, and similar browser-facing services from the required production deployment topology. Those hostnames may remain temporarily as redirect-only compatibility endpoints.
