# Cryptographic Key Management

QR-V record integrity uses SHA-256 over canonical JSON and Ed25519 signatures. The private signing key is a production secret and must exist only in the API deployment boundary or an approved signing service.

## Custody requirements

- Generate keys with a cryptographically secure tool in the authorized production environment.
- Store the private key in the host secret manager or a managed KMS/HSM integration; never in GitHub, an image, a database row, logs, tickets, or chat.
- Limit private-key read access to the API runtime identity and designated recovery operators.
- Store an encrypted recovery copy under dual-control access.
- Record generation date, custodian, environment, algorithm, activation, rotation, and retirement in the internal key register.

## Rotation gate

The current schema stores signatures but not a public `kid`-based trust chain. Therefore a routine signing-key rotation must not occur silently: replacing the verification public key can make historical records fail integrity checks. Before the first rotation, implement and test key identifiers, retained historical public keys, record-to-key binding, compromise revocation, and a migration for existing signed records.

Until that work is complete, an emergency compromise response must prioritize stopping issuance, preserving evidence, revoking the affected deployment credential, and executing a reviewed data and trust migration. Do not convert unverifiable historical records to VERIFIED.
