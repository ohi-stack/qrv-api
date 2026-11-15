# QR-V™ Demo Records

Canonical demo-record templates, seed specifications, QR-V test payloads, and verification fixtures for certificate, membership, product, document, identity, asset, property, event, and financial verification flows.

## Canonical production verification

A repository fixture does **not** prove that a record is live. Production status must be confirmed through the consolidated platform:

```text
https://qrv.network/verify/{QRVID}
```

## Canonical production demo

```text
QRVID: QRV-PROD-CERT-000001
Type: certificate
Verification URL: https://qrv.network/verify/QRV-PROD-CERT-000001
API URL: https://api.qrv.network/api/v1/verify/QRV-PROD-CERT-000001
```

The canonical demo exercises the complete lifecycle:

```text
SEED → VERIFY → REVOKE TEST → RESTORE OR RESEED
```

Production acceptance must never silently fall back to a local fixture when the API or registry is unavailable.

## Two-node architecture

```text
qrv.network/verify/{QRVID}
  ↓
api.qrv.network/api/v1/verify/{QRVID}
  ↓
PostgreSQL registry
```

## Fixture rules

- All fixture data must be fictional and public-safe.
- Never use real personal identifiers in public demo records.
- Hashes and signatures must be generated during controlled seed execution.
- Do not commit signing private keys.
- Production and test QRVID namespaces must remain distinct.
- Verification status must come from the API-backed registry, not static UI code.
- Re-seeding must be idempotent and must not duplicate QRVIDs.

## Canonical identifier pattern

```text
QRV-{ENV}-{TYPE}-{SEQUENCE}
```

Examples:

```text
QRV-PROD-CERT-000001
QRV-TEST-ID-000001
QRV-TEST-PROD-000001
```

## Required demo set

1. Verified certificate
2. Revoked certificate
3. Expired certificate
4. Restricted membership record
5. Private identity validity record
6. Product-authentication record
7. Document-verification record
8. Asset-registration record
9. Property-record reference
10. Financial-record reference

## Safety statement

QR-V demo records illustrate registry presence, issuer status, record status, expiration, revocation, hash integrity, and signature validation only when those checks are actually configured and executed. They do not establish legal title, governmental approval, investment validity, ownership, licensure, or the truth of an underlying issuer claim.
