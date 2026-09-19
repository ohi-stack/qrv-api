# QR-V™ API Surface Roadmap

The normative API contract is `openapi.yaml`. It documents implemented behavior only.

The following endpoint families are part of the canonical production sitemap but remain **PLANNED** until code, tests, authorization, persistence, OpenAPI coverage, deployment and live acceptance exist:

- `/metrics`
- `/api/v1/issuers`
- `/api/v1/issuers/{issuerId}`
- certificate-specific aliases under `/api/v1/certificates`
- verified contact cards under `/api/v1/contact-cards`
- `/api/v1/analytics`
- `/api/v1/webhooks`
- `/api/v1/keys`

## Compatibility rule

The generic canonical registry lifecycle currently uses:

- `POST /api/v1/records`
- `GET /api/v1/records/{qrvid}`
- `POST /api/v1/records/{qrvid}/revoke`
- `GET /api/v1/verify/{qrvid}`
- `GET /api/v1/audit/{qrvid}`

Future product-specific endpoint families must either delegate to this lifecycle or explicitly supersede it through a versioned OpenAPI change.

## Operational claim rule

Do not publish an endpoint as available merely because it appears in a sitemap or roadmap. OpenAPI inclusion must follow implementation and test coverage, and production availability requires live acceptance.
