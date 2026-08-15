# QR-V Security Policy

## Supported branch

Security fixes target `main` and the active production release branch. A release is supported only while its exact commit is deployed and recorded in the operational release log.

## Reporting

Do not publish suspected vulnerabilities, credentials, personal data, signing material, or exploit details in a public issue. Use GitHub private vulnerability reporting for this repository. Include affected commit, route, expected behavior, observed behavior, and a minimal reproduction that does not contain production secrets.

## Security boundary

- `api.qrv.network` is the only application with production PostgreSQL and Ed25519 private-key access.
- `qrv.network` may hold one server-side platform write credential. It must never expose that credential to browser JavaScript.
- Public verification is read-only, rate limited, privacy filtered, and fail closed.
- A QR-V result is affirmative only when `verificationState` is exactly `VERIFIED` and both hash and signature validation succeed.
- Issuer mutations are restricted to the configured issuer ID. The platform credential cannot assume an arbitrary issuer identity.

## Required production controls

TLS, host-level secret storage, database network restrictions, restorable backups, log retention, alerting, WAF/rate policy, signing-key custody, and independent live acceptance are deployment controls. Repository tests do not substitute for them.
