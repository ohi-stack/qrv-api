# QR-V™ Normative API Contract Policy

**Effective:** 2026-09-17  
**Authority:** `api.qrv.network`

## Rule

The QR-V API MUST have one normative machine-readable OpenAPI specification. Human-written API sitemaps, README endpoint lists, developer pages, SDK documentation, and examples are explanatory derivatives and MUST NOT become independent sources of truth.

Target source:

```text
openapi/qrv-api-v1.yaml
```

Until that file is present and contract-tested, the currently implemented `server.js` routes remain the executable compatibility baseline and API expansion is release-gated.

## Canonical API namespace

```text
https://api.qrv.network/api/v1
```

Operational endpoints remain outside the versioned resource namespace:

```text
/healthz
/readyz
/version
/metrics
```

`/metrics` MUST be access-controlled or network-restricted when it exposes operationally sensitive data.

## Resource model

The generalized QR-V record lifecycle is foundational:

```text
records
  -> typed certificate/contact-card/etc. resources
  -> verification
  -> lifecycle status
  -> revocation/expiration
  -> audit
```

Typed resources MUST NOT create separate verification authorities or conflicting lifecycle semantics.

## Contract-generation direction

The normative OpenAPI specification should drive:

1. API reference documentation.
2. request/response validation.
3. contract tests.
4. TypeScript types.
5. SDK generation where practical.
6. developer examples.
7. changelog/version compatibility checks.

## Required v1 capability groups

The OpenAPI contract should model, when the implementation is production-ready:

```text
status
verification
records / registry
issuers
certificates
contact cards
analytics
audit
webhooks
keys
```

Adding a path to OpenAPI does not by itself make the capability production-ready. It must be implemented, secured, tested, documented, and repeatable.

## Deterministic errors

A syntactically valid but absent QRVID returns HTTP 404 with `NOT_FOUND`. A malformed QRVID returns HTTP 422 with `INVALID_QRVID`. Infrastructure/database failures MUST NOT be collapsed into either success or record absence.

## Security boundary

Database credentials, Supabase server secrets, API master/service secrets, webhook secrets, JWT signing secrets, and Ed25519 private keys remain server-side on the API/data boundary.

## Change control

Breaking API changes require an explicit versioning decision. OpenAPI, implementation, contract tests, SDKs, examples, and developer documentation must be reconciled in the same release before the change is described as production.
