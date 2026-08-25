# QR-V™ API — Commercialization Baseline

## Canonical role

The QR-V API is the machine boundary for verification and authorized issuer operations. It must support the live QRV.Network commercial v1 without becoming a competing public application.

## 30-day priorities

1. Keep public verification stable.
2. Add or complete authenticated issuer issuance.
3. Add or complete authenticated revocation.
4. Expose safe admin metrics for issuer, record, verification, and audit status.
5. Complete Ed25519 signing support end-to-end before reporting signature validation as active.
6. Support payment/entitlement provisioning through server-side integration.

## Required API capabilities

Public:

```text
GET /api/v1/status
GET /api/v1/verify/:qrvid
GET /api/v1/registry
```

Protected issuer/admin direction:

```text
POST /api/v1/records
GET  /api/v1/records/:qrvid
POST /api/v1/records/:qrvid/revoke
GET  /api/v1/issuers/me
GET  /api/v1/audit/:qrvid
GET  /api/v1/admin/metrics
```

Exact route names may follow the existing server implementation, but the lifecycle contract must remain:

```text
issuer auth → create → registry persistence → verify → revoke/expire → audit
```

## Canonical verification states

```text
VERIFIED
REVOKED
EXPIRED
NOT_FOUND
```

Do not introduce competing state names at UI boundaries.

## Security gates

- fail closed on missing issuer/admin authorization;
- never expose database credentials or signing private keys;
- audit privileged mutations;
- rate-limit public and protected endpoints appropriately;
- revocation checks must bypass stale cache;
- Ed25519 is PENDING until key lifecycle, signature storage, and verification are operational end-to-end.

## Deferred

Do not make v1 dependent on a wallet, blockchain registry, separate explorer service, mobile scanner app, federated nodes, or multi-region replication.
