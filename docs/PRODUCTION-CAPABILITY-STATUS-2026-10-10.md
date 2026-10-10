# QR-V production capability classification — 2026-10-10

## Authority and status
This document distinguishes specification from production evidence. QRVP-1 and QVS-1.0 define intended behavior; a published route or source implementation does not prove production acceptance.

Status vocabulary: SPECIFIED, IMPLEMENTED, TESTED, DEPLOYED, PRODUCTION_VERIFIED. Only the last may be advertised as operational production capability, backed by date, commit, live run, and reproducible evidence.

## Canonical topology
- qrv.network: human-facing Verify, Issuer, Wallet, Registry, Developers, Docs, Pricing, Status and customer workflows.
- api.qrv.network: single trusted JSON API, issuer authorization, persistent record mutation, cryptography, verification and audit.
- One canonical writable PostgreSQL registry. Do not create a second writable registry in qrv-node or Wallet.
- Legacy verify/issuer/registry/wallet/docs/developers/explorer hostnames: compatibility entry points; enable permanent redirects only after canonical destination and deep links pass acceptance.

## Intended capabilities, not blanket production claims
Certificate issuance, identity and membership records, document verification, product authentication, asset/property and financial-record references, issuer administration, lifecycle-aware public verification, API/SDK integrations, wallet holding and re-verification, audit history, analytics, white-label services, and subscriptions.

The issuer is responsible for underlying claims and legal authority. QR-V record verification does not itself create government credentials, land title, financial instruments or legal entitlement.

## Release-blocking evidence
1. Authenticated issuer creates a real canonical PostgreSQL record; persists after restart.
2. Canonicalization and SHA-256 integrity; Ed25519 signing and historical public-key verification with key IDs, key rotation and revocation.
3. QR contains canonical https://qrv.network/verify/{qrvid} and resolves from an independent browser.
4. API returns VERIFIED for authorized valid record; same QRVID becomes REVOKED after issuer revocation; audit records persist.
5. Negative tests: EXPIRED, NOT_FOUND, malformed input, invalid hash/signature, suspended issuer, redaction/privacy, outage fail-closed, cross-issuer access and rate limits.
6. Wallet holder can save a reference, re-verify on open, and sees REVOKED after issuer revocation; possession does not imply ownership. Wallet cannot mutate authoritative records.
7. Production auth, secret isolation, least-privilege DB networking, backup/restore, readiness, monitoring, rollback and CI security gates pass.
8. Exact-head live acceptance job passes, with release evidence and human approval.

## Known historical gaps — recheck before claiming resolution
- Issuer placeholder browser session and issuer/API route contract mismatch were documented.
- Ed25519 live enablement and key lifecycle were unproven.
- Production acceptance has had failures; do not substitute CI source tests for live evidence.
- Earlier Cloud SQL configuration allowed broad external access; verify current restrictions.
- qrv-node README references ChatGPT Sites slug qrv-global-verification version 11, commit 3ca2be27b40e2eb8eb47891beea7ff7bf9906e22. Verify current source before replacing synchronized UI.

## Public-safe description
“QR-V™ Global Verification Network is a registry-backed verification infrastructure platform under active production development, based on QRVP-1 and QVS-1.0. It is designed to support issuer-managed records, QR-based verification, lifecycle status, auditability and developer integration. Specific production capabilities are identified only after successful live acceptance.”

## Implementation policy
No new protocol semantics, unverified readiness percentages, mock VERIFIED responses, secrets in browser bundles, unapproved database migrations, or premature legacy 308 redirects. Open PRs, test and review before merging/deploying.