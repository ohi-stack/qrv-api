# QR-V Wallet API trust-boundary contract (P0)

Date: 2026-10-10. Status: proposed contract, NOT evidence of implementation.

The qrv.network Wallet is a holder-facing reference collection, not an issuer, a separate writable registry or a verification authority. api.qrv.network remains the sole authority for QVS-1.0 status, integrity, revocation, expiration and disclosure. PostgreSQL remains canonical for registry records.

Required integration behavior:
- Validate QRVIDs and accepted canonical/legacy verification URLs; reject arbitrary QR payloads and unsafe redirects.
- Return current permitted verification result for each Wallet record open and explicit re-verification. No cached VERIFIED state can override REVOKED, EXPIRED, INVALID_SIGNATURE, NOT_FOUND or UNAVAILABLE.
- API errors/outages fail closed: Wallet must show UNAVAILABLE, not VERIFIED.
- Define and enforce holder identity, per-user wallet association authorization, issuer/holder role separation, row ownership and disclosure policies. A QRVID alone never proves record ownership.
- Store only permitted Wallet association metadata (holder ID, QRVID, added time, preferences and optional non-authoritative cache). Wallet removal deletes the association only, never the registry record.
- Share public https://qrv.network/verify/{qrvid} URLs or API-authorized disclosure tokens; never leak session credentials, private subject data or signing keys.
- Audit protected operations without exposing secrets; rate-limit and protect against IDOR, CSRF, replay, session fixation and cross-user access.

Required contract tests: actual R1 VERIFIED → Wallet add → issuer revoke → Wallet re-open → API REVOKED → Wallet REVOKED; EXPIRED; INVALID_SIGNATURE; NOT_FOUND; API outage; unauthorized holder access; no issuer privilege escalation; disclosure redaction; removal does not mutate canonical record.

Implementation must follow existing OpenAPI/route conventions after inspecting current code. Do not invent endpoints, migrate the registry, change signature policy or deploy based solely on this document. Gate changes on exact-head CI, migration safety, audit/security review and live acceptance.
