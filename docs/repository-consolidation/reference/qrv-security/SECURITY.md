# QR-V Security Policy

## Reporting a Vulnerability
Please report security issues privately to the maintainers before public disclosure.

## Scope
- qrv-api
- qrv-registry
- qrv-verify
- issuer-qrv
- qrv-explorer

## Baseline Controls
- HTTPS only
- Rate limiting on public endpoints
- Signed verification records
- Audit logging for admin actions
- Secret rotation
- Dependency patching

## Public Verify Endpoints
Responses should avoid leaking sensitive metadata and should return deterministic statuses.
