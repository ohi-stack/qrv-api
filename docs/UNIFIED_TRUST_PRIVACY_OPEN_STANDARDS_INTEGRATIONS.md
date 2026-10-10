# QR-V™ Unified Trust and Interoperability Profile

**Status:** implementation guidance / normative-profile proposal; not a declaration of deployed controls  
**Date:** 2026-10-10  
**Authority:** QRVP-1 is the protocol definition; QVS-1.0 is the verification standard. Any normative amendments require separate review and versioning.

## 1. Architecture and trust boundaries

```text
Human verifier / issuer / holder / agent / enterprise system
                 ↓
qrv.network — browser experience, wallet references, issuer UI
                 ↓
api.qrv.network — trusted API, authorization, signatures, records, audit
                 ↓
Canonical PostgreSQL registry
```

The browser application is never a signing-key or writable registry authority. Legacy QR-V hostnames are compatible entry/redirect points only after canonical route acceptance.

## 2. Uniform cryptographic record envelope (target)

For every supported record class, define and validate at minimum:

- immutable QRVID, record type and versioned canonicalization profile
- tenant/issuer ID and verified issuer authorization state
- canonical payload hash (SHA-256)
- Ed25519 signature, algorithm profile, immutable `kid`, signing-key binding and historical public-key validation
- issuance timestamp, optional expiration timestamp, lifecycle state and revocation history
- privacy policy ID/version and allowed claims or fields
- request correlation IDs, mutation/audit evidence and verification timestamp

Use deterministic canonicalization before hashing and signing. Exclude noncanonical transport formatting. Treat unknown key IDs, invalid signatures, tampered hashes, revoked/compromised issuer keys and database failures as non-VERIFIED outcomes. A signature on a record is not proof that the underlying legal claim is true; verify issuer authority independently.

**Current-state discipline:** The presence of SHA-256/Ed25519 code, tables, templates or an open PR does not establish that signing, rotation or verification is enabled in production. Keep the Ed25519 key-registry cutover as an explicit release gate, with test evidence.

## 3. Privacy and selective disclosure (target)

Policy classes: PUBLIC, RESTRICTED, PRIVATE and SELECTIVE-DISCLOSURE. Each subject or verifier access decision must be made server-side using issuer scope, viewer authorization and field-level policy. Do not expose private values in QR payloads, signed public URLs, browser bundles, analytics or logs.

- Only disclose permitted fields in `/api/v1/verify/:qrvid` responses.
- Prefer claim minimization and bounded-purpose disclosure over full-document exposure.
- Sensitive Google Drive/Sheets/other provider references are non-authoritative attachments; never substitute provider tokens or external file metadata for a QR-V record.
- Re-check disclosure and revocation for each authorized verification; short-lived caching must never elevate stale VERIFIED states.
- Holder-wallet enrollment/possession does not confer issuer authority or ownership of the record.

## 4. Deterministic result contract

The canonical response must distinguish at least VERIFIED, REVOKED, EXPIRED, NOT_FOUND, INVALID_FORMAT, INVALID_SIGNATURE/integrity, SUSPENDED_ISSUER and UNAVAILABLE as appropriate to the implemented QVS-1.0 mapping. Preserve the current OpenAPI schema and avoid unilateral status renames.

An absent or unreachable upstream, failed integrity check, unauthorized signer, or malformed response **must not** become VERIFIED. Expose implementation/revision identifiers and trace/request IDs where safe. Do not leak sensitive record contents in error responses.

## 5. Existing-system integration profiles

| Source system | Intended adapter | Required boundary |
|---|---|---|
| LMS/education | certificate issuance + event callbacks | issuer-scoped writes and course completion authority |
| CRM/HRIS/ERP | REST, batch imports, webhooks | tenant isolation and authorization |
| WordPress/WooCommerce | server-side plugin/API bridge | authenticated provenance, no embedded privileged secrets |
| Google Sheets | consent-based batch import | validate every row; idempotent writes |
| Google Drive/Picker | file selection/storage | approved OAuth scopes, content hashing, no alternate registry |
| Gmail | post-commit notifications | queued delivery, error visibility; mail is not record authority |
| Developer SDKs/agents | REST/OpenAPI, scoped keys | deterministic results, rate limits, idempotency and audit |
| Property/financial records | attestations of issuer-defined provenance only | no independent government/title/license authority claim |

External credentials, OAuth refresh tokens, database connections, webhooks and signing keys stay server-side. Public documentation must distinguish planned adapters from working/validated connectors.

## 6. Security and conformance gates

1. ISSUER authentication and cross-tenant authorization; scoped API and service credentials.
2. Canonical payload hash/signature, issuer-key binding, `kid` lifecycle and key-compromise behavior.
3. Privacy-mode matrix for anonymous, authorized verifier, holder and issuer; no leakage.
4. Real PostgreSQL issuance, QR URL resolution, VERIFIED, revocation of **the same QRVID**, REVOKED, persisted audit events.
5. EXPIRED, NOT_FOUND, INVALID_FORMAT/SIGNATURE, SUSPENDED_ISSUER, DB outage and throttle tests.
6. API/SDK interoperability, schema/OpenAPI compliance, backward compatibility and observable request IDs.
7. CI/security/QA evidence, backup-restore rehearsal, Hostinger/API-host routing and rollback approval.

No feature can be described as production-operational solely because its implementation or this guidance has been committed.
