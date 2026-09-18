# QR-V™ Multi-Builder API Development Contract

**Status date:** September 18, 2026  
**Applies to:** ChatGPT Sites, Google AI Studio, integration previews, and other non-production QR-V builders.

## Canonical authority

```text
https://api.qrv.network/api/v1
```

is the production API/data-plane authority.

No ChatGPT Sites preview, Google AI Studio project, Vite preview, local Express process, or integration environment becomes an independent verification or registry authority.

The canonical public route architecture is maintained in `ohi-stack/qrv-node`:

```text
config/routes.manifest.json
docs/PRODUCTION_SITEMAP.md
```

Current sitemap baseline:

```text
0949815c020e7f27f388f48f696bd931a6504b0a
```

That public sitemap is not the normative API specification. Exact API paths, methods, schemas, authentication, errors, and request/response contracts must come from the OpenAPI specification maintained by `qrv-api`.

## Development topology

```text
work/chatgpt-sites
        │
work/google-ai-studio
        │
integration/multi-builder
        ▼
qrv-node Express boundary
        ▼
qrv-api
        ▼
canonical registry
```

## API boundary

`api.qrv.network` is machine-oriented and must not become a second customer website.

Operational endpoints:

```text
/healthz
/readyz
/version
/metrics
```

Versioned API root:

```text
/api/v1
```

Intended capability families:

```text
status
verify
registry
issuers
certificates
contact-cards
analytics
audit
webhooks
keys
```

The exact endpoint inventory must be generated from / validated against OpenAPI rather than maintained as a competing hand-written contract.

## Default development behavior

Development lanes must default to a closed or isolated API target unless an explicitly approved non-production API environment exists.

Never copy production secrets into frontend builders.

Forbidden in browser/client configuration:

```text
DATABASE_URL
QRV_SIGNING_PRIVATE_KEY
QRV_PLATFORM_API_KEY
QRV_WEBHOOK_SECRET
SESSION_SECRET
database administrator credentials
payment-provider secrets
production signing material
```

## Protocol invariants

Builder-generated code must preserve:

- QRVP-1 identifier/resolution workflow;
- QVS-1.0 deterministic verification behavior;
- registry-backed authority;
- fail-closed verification;
- explicit lifecycle states;
- SHA-256 integrity checks;
- Ed25519 signing/verification architecture;
- revocation and auditability;
- issuer authorization boundaries.

## Promotion rule

Experimental API code must move through a reviewed `qrv-api` feature branch/PR and `qrv-node` integration validation. Builder output must never be pushed directly into the production API runtime without normal validation and acceptance.

A route or API capability may only be represented as production when it is implemented, integrated, documented, tested, and repeatable.

## Production lifecycle acceptance

The production gate remains:

```text
issue
→ persist canonical registry record
→ generate QRVID / QR
→ verify VERIFIED
→ revoke
→ verify REVOKED
→ confirm audit history
```

Additional negative-state acceptance must cover NOT_FOUND, EXPIRED, invalid integrity/signature, suspended issuer, API/data outage, privacy/redaction, and rate limiting where applicable.

## OpenAPI release gate

The existing production API program issue requires a normative OpenAPI 3.x contract. Until that contract is operational and CI-validated, public documentation may describe intended capability families but must not imply the complete API surface is finalized.
