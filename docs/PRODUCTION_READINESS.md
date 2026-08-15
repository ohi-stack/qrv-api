# QR-V API Production Readiness

This document maps the QR-V production package to the seven-layer innovation blueprint and distinguishes repository controls from external deployment controls.

| Layer | Repository control | Production gate |
|---|---|---|
| Protocol | QRVP-1 routes, deterministic states, `openapi/qrv-api-v1.yaml`, contract check | Published version and compatibility policy |
| Data model | PostgreSQL migration owner, issuer scope, payload hash, signature, lifecycle, audit | Backup, dry run, migration evidence, retention approval |
| Infrastructure | Node 20 runtime, non-root container, health and readiness probes | Correct `api.qrv.network` routing, TLS, private database connectivity |
| Security | Ed25519, SHA-256, strict CORS, bounded input, rate limits, privacy filtering, dependency and CodeQL gates | Secret manager, key custody, WAF policy, incident contacts |
| Governance | Schema version, CODEOWNERS, release gates, security reporting | Approved issuer, change authority, documented release decision |
| Distribution | Stable REST contract and canonical `qrv.network/verify/{qrvid}` links | SDK and customer integration conformance |
| Economic | Issuer and aggregate analytics primitives | Billing, entitlements, invoice and webhook provider acceptance |

## Repository-complete controls

- create -> hash -> Ed25519 sign -> persist -> audit;
- verify -> integrity -> lifecycle -> privacy-filtered response;
- revoke -> transactional state change -> audit;
- public, restricted, and private disclosure;
- issuer-scoped reads and mutations;
- request correlation IDs;
- public and issuer mutation rate limits;
- production configuration, migration, integration, contract, dependency, container, CodeQL, and SBOM gates;
- guarded live acceptance with express authorization to create and revoke test records.

## External controls required before merge and deployment

1. Verify and record a restorable PostgreSQL backup.
2. Route `api.qrv.network` directly to this JSON service without an issuer-login redirect.
3. Restrict the database firewall to the API runtime and administrative migration path.
4. Install a 32-byte-or-longer write credential, approved issuer ID, matching Ed25519 key pair, strict CORS origin, and TLS-verifying database URL.
5. Apply migration `2026-08-15-production-v5` against a production-shaped copy before production.
6. Configure uptime checks for `/healthz` and `/readyz`, but do not expose write credentials to the monitor.
7. Configure logs and alerts for readiness failures, 5xx rates, authentication failures, rate-limit saturation, database pool errors, signature failures, and migration mismatch.
8. Run the guarded live acceptance and retain the resulting QRVIDs and release commit in the release record.

## Explicit exclusions

The current credential is a single server-to-server platform credential bound to one issuer ID. It is not a public multi-tenant developer credential system. Multi-issuer API keys, team RBAC, billing entitlements, webhooks, white-label tenants, and self-service onboarding require separate reviewed implementations before those capabilities may be advertised as operational.
