# QR-V™ Verified Contact Card

`VCARD` is a registry-backed QR-V record type. The printed QR always resolves to:

```text
https://qrv.network/verify/{qrvid}
```

The destination remains stable when an authorized issuer updates contact details. Each revision is canonicalized, hashed with SHA-256, signed with Ed25519, stored in PostgreSQL, and recorded in the audit log.

## Capabilities

- contact name, organization, role, phones, emails, address, website, social links, note, and HTTPS photo reference;
- public, restricted, and private records;
- field-level disclosure for restricted records;
- standards-compatible vCard 3.0 download;
- dynamic updates without changing the QRVID;
- aggregate verification and contact-download analytics;
- transactional bulk issuance for 1–100 cards;
- revocation and expiration through the core QR-V lifecycle.

The API does not collect or expose precise location, raw IP addresses, or cross-site identity for analytics. Counts are derived from registry verification and vCard-download audit events.

## Create one card

```http
POST /api/v1/registry/create
X-API-Key: <issuer write key>
X-Issuer-Id: <issuer id>
Content-Type: application/json
```

```json
{
  "recordType": "VCARD",
  "issuer": "Example Organization",
  "visibility": "restricted",
  "contact": {
    "formattedName": "Ada Lovelace",
    "organization": "Example Organization",
    "title": "Researcher",
    "phones": [{ "type": "work", "value": "+1 555 0100" }],
    "emails": [{ "type": "work", "value": "ada@example.com" }],
    "website": "https://example.com/",
    "socialLinks": [{ "label": "linkedin", "url": "https://www.linkedin.com/in/example" }],
    "publicFields": ["formattedName", "organization", "title", "emails"]
  }
}
```

## Public operations

```http
GET /api/v1/verify/{qrvid}
GET /api/v1/vcards/{qrvid}.vcf
```

Only a `VERIFIED` card with a disclosed formatted name can produce a VCF download. Revoked and expired cards return a non-active response; private cards fail closed.

## Issuer operations

```http
POST /api/v1/issuer/vcards/{qrvid}/update
POST /api/v1/issuer/vcards/bulk
GET  /api/v1/issuer/vcards/{qrvid}/analytics
```

An update preserves the QRVID and issuance timestamp, creates a new payload hash and signature, retains prior hashes in the hash registry, and writes `vcard_update` to the audit log. Bulk issuance is atomic: an invalid card rolls back the complete batch.

## Production acceptance

The standard API release gate remains mandatory. In addition, verify:

1. create a public `VCARD` record;
2. resolve it as `VERIFIED`;
3. download and import the `.vcf` on Android, iOS, Google Contacts, and Outlook;
4. update a contact field and confirm the QRVID does not change;
5. confirm the new payload hash and a `vcard_update` event;
6. confirm aggregate analytics increment;
7. revoke the card and confirm verification returns `REVOKED` and VCF download is unavailable.
