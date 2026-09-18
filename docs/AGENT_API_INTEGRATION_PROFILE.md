# QR-V™ Agent and Enterprise API Integration Profile

**Effective:** 2026-09-17  
**Tracking:** qrv-api#16  
**Release authority:** ohi-stack/qrv-node#7

## Principle

Approved software agents and enterprise systems are API clients, not trust authorities.

The canonical machine boundary is `https://api.qrv.network/api/v1`.

## Supported consumer classes

- QR-V web/BFF services
- approved issuer organizations
- enterprise integrations
- server applications
- approved software/AI agents
- public verification consumers

## Identity and authorization

Protected operations require issuer-scoped identity.

Production implementation must support:

- organization/issuer identity
- user membership and explicit roles
- service accounts
- scoped credentials
- credential expiration
- rotation and revocation
- tenant isolation on every protected query and mutation

A browser-visible global write secret is prohibited.

## Mutation contract

Create, update, revoke, and other write operations must support:

- authenticated actor identity
- issuer/tenant binding
- request ID
- idempotency key where retry is possible
- transactional audit attribution
- bounded input validation
- deterministic error responses

## Verification semantics

Clients must preserve QR-V deterministic states.

At minimum:

- `VERIFIED`
- `REVOKED`
- `EXPIRED`
- `NOT_FOUND`
- integrity/signature failure where contractually exposed
- suspended issuer state where applicable
- `UNAVAILABLE`

Timeout, dependency failure, DB outage, or 5xx must never be translated to `VERIFIED` or `NOT_FOUND`.

## Cryptographic requirements

Issuance must:

1. canonicalize the record payload
2. calculate SHA-256
3. select an active issuer signing key
4. sign with Ed25519
5. persist the immutable `kid` binding
6. retain historical verification capability

Key states must distinguish active, retired, revoked/compromised, and unknown.

Historical records must verify against the exact bound key rather than the current issuer key.

## Webhooks

Webhook delivery must include:

- signed payload
- event ID
- event type
- issuer attribution
- timestamp
- retry policy
- replay/idempotency guidance
- delivery history
- disable/dead-letter behavior

Webhook signing secrets must be independent from API credentials.

## Operational contract

Required production endpoints include distinct liveness and readiness checks.

Readiness must validate the dependencies necessary to safely serve trusted operations, including canonical datastore and required security/signing configuration.

## Required acceptance sequence

Automated acceptance must prove:

`organization/service identity → authenticated issue → QRVID → VERIFIED → audit attribution → revoke → REVOKED`

Negative/failure coverage must include:

- EXPIRED
- NOT_FOUND
- malformed QRVID
- invalid hash/signature
- revoked/compromised/unknown signing key
- unauthorized actor
- cross-tenant mutation
- duplicate idempotency key
- webhook replay
- rate limiting
- database unavailable
- downstream dependency unavailable

## Agent safety boundary

Agents may automate only actions granted by their scoped service identity.

They must not receive:

- PostgreSQL credentials
- migration credentials
- platform master secrets
- browser-global write keys
- Ed25519 private material outside an explicitly approved signing-service design

All mutations must remain attributable in the QR-V audit log.
