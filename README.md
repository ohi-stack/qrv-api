# QR-V™ API

Canonical programmatic interface for the QR-V™ Global Verification Network.

The API enables approved issuers, public verifiers, applications, and enterprise systems to create, retrieve, verify, revoke, and audit registry-backed records through deterministic, versioned REST endpoints.

## Service Boundary

```text
Public and issuer clients
        ↓
api.qrv.network
        ↓
registry.qrv.network / PostgreSQL
        ↓
canonical records, issuers, hashes, signatures, revocations, audit logs
```

The API is the mutation authority. Public interfaces must not write directly to the database.

## Canonical Base URL

```text
https://api.qrv.network/api/v1
```

## Core Endpoints

### System

```http
GET /health
GET /healthz
GET /readyz
GET /version
GET /ping
```

### Public verification

```http
GET /verify/:qrvid
```

### Authenticated issuance

```http
POST /registry/create
GET  /issuer/records
GET  /issuer/records/:qrvid
GET  /issuer/analytics
```

### Authenticated lifecycle

```http
POST /revoke
```

## Canonical Lifecycle

```text
AUTHENTICATE
→ VALIDATE REQUEST
→ AUTHORIZE ISSUER
→ GENERATE QRVID
→ CANONICALIZE PAYLOAD
→ SHA-256 HASH
→ ED25519 SIGN
→ PERSIST RECORD
→ WRITE AUDIT EVENT
→ RETURN VERIFICATION URL
```

Revocation must use the same authorization and audit controls.

## Deterministic Verification Statuses

```text
VERIFIED
REVOKED
EXPIRED
NOT_FOUND
INVALID_FORMAT
INVALID_SIGNATURE
SUSPENDED_ISSUER
UNAVAILABLE
```

The API must never convert dependency failure into `NOT_FOUND` or `VERIFIED`.

## Canonical Demo

```text
QRVID: QRV-PROD-CERT-000001
Verification URL: https://verify.qrv.network/QRV-PROD-CERT-000001
```

The demo record must come from the production registry. Static fallback data may be used only in isolated test environments and must be clearly identified.

## Authentication

Protected endpoints require approved authentication such as:

```http
Authorization: Bearer <jwt>
x-api-key: <issuer-api-key>
x-issuer-id: <issuer-id>
```

Requirements:

- issuer-scoped API keys;
- role-based authorization;
- token expiration and revocation;
- idempotency keys for retryable mutations;
- strict production CORS allowlist;
- no secrets in browser-readable configuration.

## Request Validation

Validate:

- QRVID syntax and length;
- record type enum;
- issuer authority;
- required subject fields;
- issue and expiration timestamps;
- privacy level;
- metadata size and allowed structure;
- lifecycle transition rules;
- idempotency and uniqueness.

## Audit Events

At minimum:

```text
registry_create
registry_verify
registry_update
registry_revoke
issuer_authenticated
issuer_authorization_failed
api_key_used
api_key_revoked
```

Every audit event should include request ID, actor, issuer, record, operation, result, canonical UTC timestamp, source service, and version.

## Security Requirements

- TLS everywhere.
- Parameterized SQL.
- Central validation middleware.
- Rate limiting by IP, API key, issuer, and route.
- Safe structured errors without stack traces.
- SHA-256 and Ed25519 verification.
- Restricted/private field filtering.
- Readiness checks for required dependencies.
- Graceful shutdown and database pool drainage.
- Secrets supplied through deployment configuration only.

## Environment

```env
NODE_ENV=production
PORT=3000
APP_VERSION=1.0.0
DATABASE_URL=
JWT_SECRET=
CORS_ALLOWED_ORIGINS=https://qrv.network,https://verify.qrv.network,https://issuer.qrv.network,https://registry.qrv.network
QRV_VERIFY_BASE_URL=https://verify.qrv.network
QRV_REGISTRY_BASE_URL=https://registry.qrv.network
QRV_PROTOCOL_VERSION=QRVP-1
QVS_VERSION=QVS-1.0
```

## Production Gate

A release is not complete until:

1. health and readiness pass;
2. migrations are current;
3. create, verify, and revoke integration tests pass;
4. invalid signatures fail closed;
5. restricted/private data is filtered;
6. the canonical demo returns a deterministic result;
7. the issuer lifecycle works without direct database intervention;
8. audit events exist for create, verify, and revoke.

The published API reference is maintained in `ohi-stack/qrv-docs/openapi.yaml`.
