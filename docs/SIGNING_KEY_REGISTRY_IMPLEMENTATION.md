# QR-V™ Signing Key Registry — Production Implementation

Status: Required production control for QR-V API
Protocol: QRVP-1
Standard: QVS-1.0
Scope: `api.qrv.network`

## Purpose

QR-V production verification must bind every Ed25519 signature to an explicit key identifier (`kid`). This prevents ambiguity during key rotation and preserves the ability to verify historical records after an issuer activates a replacement signing key.

## Required data model

### `qr_signing_keys`

Each issuer signing key must have a durable registry record:

- `kid` — immutable unique key identifier
- `issuer_id` — owning issuer
- `algorithm` — `ed25519`
- `public_key` — public verification material only
- `status` — `active`, `retired`, `revoked`, or `compromised`
- `not_before` — earliest issuance time
- `not_after` — optional end of issuance validity
- `created_at`
- `retired_at`
- `revoked_at`
- `revocation_reason`

Private keys must never be stored in this table.

### Record binding

Every newly signed `qr_objects` row must store:

- `signature`
- `signature_algorithm`
- `signing_key_id`

`signing_key_id` must reference `qr_signing_keys.kid`.

## Verification policy

A record may return `VERIFIED` only when all applicable checks pass:

1. Record lifecycle state is active/valid.
2. Canonical payload hash matches the stored SHA-256 hash.
3. `signing_key_id` resolves to a known key.
4. Signature verifies against that key's public key.
5. Key lifecycle policy permits historical verification.

Key policy:

- `active`: may issue and verify.
- `retired`: may verify historical records but must not issue new records.
- `revoked`: verification must fail closed.
- `compromised`: verification must fail closed and trigger incident handling.
- unknown `kid`: verification must fail closed.

## Issuance policy

New issuance must require one active issuer-scoped key. The API must reject issuance when:

- no active key exists;
- more than one ambiguous active key exists without an explicit configured `kid`;
- the configured key is retired/revoked/compromised;
- the private key does not correspond to the registered public key.

The selected `kid` must be persisted atomically with the signature and audit event.

## Rotation workflow

1. Generate a new Ed25519 keypair through approved key custody procedures.
2. Register the new public key with a new immutable `kid` in `qr_signing_keys`.
3. Validate private/public key pair correspondence before activation.
4. Set the new key to `active`.
5. Set the previous key to `retired`.
6. Confirm old records still verify with the retired key.
7. Confirm new records are signed with the new `kid`.
8. Write immutable audit events for activation and retirement.

## Compromise workflow

1. Mark the affected key `compromised` or `revoked`.
2. Stop issuance with that key immediately.
3. Verification of records bound to the compromised key must not return `VERIFIED` until an approved incident policy determines a replacement state.
4. Activate a replacement key with a new `kid`.
5. Record the event in the audit log and incident documentation.

## Legacy records without `kid`

Legacy signatures must not be silently relabeled.

Migration behavior must be explicit:

- unsigned or unverifiable legacy records fail closed;
- legacy records with known historical key provenance may be mapped only through an explicit migration process and audit record;
- absence of `kid` is not enough to infer the current production signing key.

## API contract additions

Verification responses should expose public-safe key metadata:

```json
{
  "integrity": {
    "hashAlgorithm": "SHA-256",
    "signatureAlgorithm": "Ed25519",
    "kid": "issuer-001-ed25519-2026-01",
    "signatureValid": true,
    "keyStatus": "active"
  }
}
```

Private key material must never appear in API responses, logs, audit metadata, or repository fixtures.

## Acceptance criteria

Production release remains blocked until all of the following pass:

1. Key A signs record A; record A verifies.
2. Key B becomes active and key A becomes retired.
3. Record A continues to verify using key A.
4. New record B is signed with key B and includes key B's `kid`.
5. Unknown `kid` fails closed.
6. Revoked/compromised key fails closed.
7. Key lifecycle operations create audit events.
8. Database backup/restore preserves record-to-key binding.
9. OpenAPI, migration, fixtures, conformance tests, and live acceptance reflect the same policy.

## Deployment rule

Do not merge or deploy QR-V production issuance until this control is implemented in code and validated against PostgreSQL.