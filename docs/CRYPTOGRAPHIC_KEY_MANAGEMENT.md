# Cryptographic Key Management

QR-V record integrity uses SHA-256 over canonical JSON and Ed25519 signatures. The private signing key is a production secret and must exist only in the API deployment boundary or an approved signing service.

## Custody requirements

- Generate keys with a cryptographically secure tool in the authorized production environment.
- Store the private key in the host secret manager or a managed KMS/HSM integration; never in GitHub, an image, a database row, logs, tickets, or chat.
- Limit private-key read access to the API runtime identity and designated recovery operators.
- Store an encrypted recovery copy under dual-control access.
- Record generation date, custodian, environment, algorithm, activation, rotation, and retirement in the internal key register.

## Rotation gate

Schema `2026-09-05-production-v6` stores an issuer-scoped `kid`, retained public keys, and the record-to-key binding in PostgreSQL. A routine rotation must use the signing-key registry API: activate the replacement key, retire the previous active key, confirm historical records verify with the retired key, and confirm new records carry the replacement `kid`.

If a key is revoked or compromised, stop issuance with it immediately. The verifier fails closed for records bound to that key; do not convert unverifiable historical records to `VERIFIED`. Preserve the audit trail and execute the approved incident and replacement-key procedure.
