# QR-V™ Production Environment Contract

**Status:** Authoritative deployment contract  
**Architecture:** two-node-consolidated  
**Public platform:** `https://qrv.network`  
**Trusted backend:** `https://api.qrv.network`

## 1. Non-negotiable boundary

Every QR-V production capability belongs to exactly one runtime boundary:

- `qrv.network` — human-facing platform, UI, sessions, navigation, verification presentation, issuer workspace, registry/explorer views, documentation, pricing, status, billing UI, and administration UI.
- `api.qrv.network` — canonical API/data boundary, authentication/authorization, registry persistence, issuance, revocation, audit logging, server integrations, hashing, signing, rate limiting, and backend secrets.

No other QR-V repository may be mapped as an independent production application. Historical subdomains remain redirect-only compatibility aliases.

## 2. Canonical public URLs

```text
https://qrv.network/
https://qrv.network/verify/{QRVID}
https://qrv.network/issuer
https://qrv.network/registry
https://qrv.network/explorer
https://qrv.network/docs
https://qrv.network/developers
https://qrv.network/api-reference
https://qrv.network/protocol
https://qrv.network/standards
https://qrv.network/security
https://qrv.network/pricing
https://qrv.network/status
https://qrv.network/store
https://qrv.network/admin
```

Canonical backend:

```text
https://api.qrv.network/api/v1
```

`https://qrv.network/api/v1/*` may exist only as a compatibility proxy/redirect surface. It must not execute a second copy of backend business logic.

## 3. qrv.network environment

```env
NODE_ENV=production
PORT=3000
APP_VERSION=1.0.0

APP_BASE_URL=https://qrv.network
QRV_PLATFORM_ORIGIN=https://qrv.network

API_BASE_URL=https://api.qrv.network/api/v1
QRV_API_BASE_URL=https://api.qrv.network/api/v1

VERIFY_BASE_URL=https://qrv.network/verify
REGISTRY_BASE_URL=https://qrv.network/registry
ISSUER_BASE_URL=https://qrv.network/issuer
DOCS_BASE_URL=https://qrv.network/docs
DEVELOPERS_BASE_URL=https://qrv.network/developers
STATUS_BASE_URL=https://qrv.network/status

QRV_PLATFORM_API_KEY=<server-only shared service key>
SESSION_SECRET=<strong random secret>
ISSUER_ACCESS_CODE=<pilot-only access code>
SESSION_TTL_MS=43200000
LOG_LEVEL=info
```

Forbidden on the public platform:

```text
DATABASE_URL
SUPABASE_SECRET_KEY
QRV_WEBHOOK_SECRET
Ed25519 private keys
database administrator credentials
payment provider secrets
```

## 4. api.qrv.network environment

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
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
DATABASE_URL=<PostgreSQL connection from the same Supabase project>
DATABASE_POOL_MAX=20
PG_CONNECTION_TIMEOUT_MS=5000
PG_IDLE_TIMEOUT_MS=10000
PGSSLMODE=require

QRV_API_KEY=<canonical protected backend key>
QRV_PLATFORM_API_KEY=<temporary compatibility alias for same key>
QRV_WEBHOOK_SECRET=<separate webhook secret>

CORS_ORIGINS=https://qrv.network
CORS_ALLOWED_ORIGINS=https://qrv.network
LOG_LEVEL=info
PUBLIC_RATE_WINDOW_MS=60000
PUBLIC_RATE_LIMIT=240
```

## 5. Datastore authority

QR-V must have exactly one writable canonical registry authority.

Preferred production mode:

```text
QRV_DATA_BACKEND=supabase-postgres
```

In that mode:

- `SUPABASE_URL` identifies the canonical QR-V Supabase project.
- `SUPABASE_SECRET_KEY` is server-only and may be used for Supabase server APIs.
- `DATABASE_URL` must point to the PostgreSQL database from that same Supabase project.
- Cloud SQL or any other PostgreSQL deployment must not simultaneously accept production writes.

Alternative mode:

```text
QRV_DATA_BACKEND=postgres
```

In that mode the direct managed PostgreSQL/Cloud SQL database is canonical and Supabase is not configured as a second authority.

## 6. Secret handling

Backend secrets must never be emitted through HTML, JSON responses, browser bundles, source maps, client environment variables, logs, or public repository files.

Server-to-server API keys and webhook secrets must be independent secrets. Ed25519 signing keys must be treated as a separate cryptographic key class and must not reuse API or session secrets.

## 7. Verification semantics

Current public verification states:

```text
VERIFIED
REVOKED
EXPIRED
NOT_FOUND
```

A dependency outage or failed registry read is `UNAVAILABLE`/service failure, not `NOT_FOUND`.

SHA-256 integrity is active. Full Ed25519 compliance may be claimed only after issuer keys, signing, persistence, validation, key rotation/revocation, and negative-path tests are operational.

## 8. Legacy compatibility

Legacy hostnames remain redirect-only:

```text
verify.qrv.network   → https://qrv.network/verify
issuer.qrv.network   → https://qrv.network/issuer
registry.qrv.network → https://qrv.network/registry
explorer.qrv.network → https://qrv.network/explorer
docs.qrv.network     → https://qrv.network/docs
developers.qrv.network → https://qrv.network/developers
status.qrv.network   → https://qrv.network/status
store.qrv.network    → https://qrv.network/store
```

Use HTTP 308 where method/path preservation is required.

## 9. Deployment order

1. Back up the current canonical registry.
2. Confirm the selected datastore authority and disable competing write paths.
3. Configure `api.qrv.network` secrets and datastore settings.
4. Run the QR-V registry migration against the canonical database.
5. Deploy `ohi-stack/qrv-api` to `api.qrv.network`.
6. Confirm `/healthz`, `/readyz`, `/version`, verification, issuance, revocation, and audit behavior.
7. Configure and deploy `ohi-stack/qrv-node` to `qrv.network`.
8. Verify `qrv.network` calls `api.qrv.network/api/v1` internally.
9. Enable compatibility aliases/proxy routes.
10. Run end-to-end production acceptance.

## 10. Production acceptance

The release passes only if one real record can complete:

```text
issuer login
→ create record
→ generate QRVID
→ generate QR
→ qrv.network/verify/{QRVID}
→ VERIFIED
→ revoke
→ same URL returns REVOKED
→ audit events exist
```

Do not represent the network as fully cryptographically compliant until the Ed25519 production gate passes.
