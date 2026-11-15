# QR-V™ Verification Status Contract

**Protocol:** QRVP-1  
**Standard:** QVS-1.0  
**Contract version:** 1.0.0

## 1. Scope

This document defines the normative public verification states returned by QR-V services. Implementations must return one deterministic primary status for each verification request.

## 2. Status Precedence

Evaluate in this order:

1. identifier format;
2. record existence;
3. issuer status;
4. revocation;
5. expiration;
6. signature integrity;
7. hash integrity;
8. verified result.

A lower-priority success condition must not override a higher-priority failure condition.

## 3. Canonical Statuses

### `VERIFIED`

Return only when:

- the QRVID is valid;
- the canonical record exists;
- the issuer is active and authorized;
- the record is not revoked;
- the record is not expired;
- the stored payload hash matches the canonical payload;
- the Ed25519 signature validates where signatures are required.

Recommended HTTP status: `200`.

### `REVOKED`

Return when the record exists but has an effective revocation.

Required public fields:

- `qrvid`
- `status`
- `issuer`
- `recordType`
- `revokedAt`
- public-safe `revocationReason`, when disclosure is permitted
- `verifiedAt`

Recommended HTTP status: `410` for API responses. Public HTML pages may return `200` while clearly rendering `REVOKED`.

### `EXPIRED`

Return when the record exists, is not revoked, and its expiration timestamp is in the past.

Recommended HTTP status: `200` with deterministic status `EXPIRED`.

### `NOT_FOUND`

Return when no canonical record exists for the normalized QRVID.

Recommended HTTP status: `404`.

Do not disclose whether a private record previously existed.

### `INVALID_FORMAT`

Return when the supplied identifier fails canonical syntax or length validation.

Recommended HTTP status: `422`.

The verifier should reject invalid identifiers before calling upstream registry services.

### `INVALID_SIGNATURE`

Return when a required issuer signature cannot be validated against the active issuer public key.

Recommended HTTP status: `401` or `422`, according to the implementation's API policy.

Public copy must state that record integrity could not be confirmed. It must not present the record as authentic.

### `SUSPENDED_ISSUER`

Return when the record exists but the issuer is suspended, revoked, or otherwise not authorized at verification time.

Recommended HTTP status: `403`.

### `UNAVAILABLE`

Return when the verifier cannot reach a required dependency or cannot complete a reliable determination.

Recommended HTTP status: `503` for API responses. A public HTML interface may return a branded unavailable page with `503`.

Never convert an unavailable result into `NOT_FOUND` or `VERIFIED`.

## 4. Canonical JSON Envelope

```json
{
  "ok": true,
  "status": "VERIFIED",
  "qrvid": "QRV-PROD-CERT-000001",
  "recordType": "certificate",
  "issuer": {
    "code": "QRV-DEMO",
    "name": "QR-V Demo Issuer",
    "status": "active"
  },
  "subject": {
    "displayName": "Demo Recipient"
  },
  "title": "QR-V Verified Certificate Demonstration",
  "issuedAt": "2026-08-01T00:00:00Z",
  "expiresAt": null,
  "privacyLevel": "public",
  "integrity": {
    "hashAlgorithm": "SHA-256",
    "hashValid": true,
    "signatureAlgorithm": "Ed25519",
    "signatureValid": true
  },
  "registryReference": "https://registry.qrv.network/records/QRV-PROD-CERT-000001",
  "verifiedAt": "2026-08-01T00:00:01Z",
  "protocolVersion": "QRVP-1",
  "standardVersion": "QVS-1.0"
}
```

## 5. Privacy Modes

### Public

Return all fields approved for public display.

### Restricted

Return only approved metadata such as status, issuer, record type, title, issue date, and expiration date.

### Private

Return only the minimum determination, such as status, issuer, record type, and verification timestamp. Do not expose subject data or private payload metadata.

## 6. Verification Disclaimer

QR-V verifies the state and integrity of a registry record under the applicable issuer and network rules. It does not independently adjudicate legal title, governmental authority, financial validity, professional licensure, ownership, or the truth of every underlying issuer assertion.

## 7. Cache Rules

- Verification records may be cached for up to five minutes.
- Revocation and issuer-status checks must bypass stale cache or use a cache invalidation mechanism that guarantees prompt status changes.
- Responses should include cache metadata where applicable.

## 8. Audit Requirements

Every verification attempt should record:

- request ID;
- normalized QRVID;
- result status;
- issuer ID, if resolved;
- record ID, if resolved;
- verification timestamp;
- response duration;
- privacy mode;
- failure category;
- source service and version.
