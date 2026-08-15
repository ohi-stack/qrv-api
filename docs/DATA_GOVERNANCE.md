# Data Governance and Privacy

## Classification

- Public: fields expressly approved for public verification.
- Restricted: validity plus an explicit field allowlist.
- Private: validity, issuer, type, lifecycle, and integrity outcome only.
- Secret: database credentials, write credentials, private signing keys, session secrets, and provider tokens. Secret data is never registry payload data.

## Data minimization

Do not place Social Security numbers, government identifier numbers, financial account numbers, health records, authentication secrets, or unnecessary personal data in public registry payloads. A QR code is a public locator. Privacy depends on server-side disclosure rules, not obscurity of the QRVID.

## Retention baseline

- Canonical record and revocation evidence: retained for the issuer's approved legal and contractual period.
- Audit events: retain at least one year unless a longer period is approved for the use case.
- Application and security logs: 30-90 days based on provider capacity and incident needs.
- Acceptance-test records: revoke immediately after the test and retain only as clearly labeled release evidence.

Retention, deletion, legal hold, subject rights, and cross-border processing terms require documented approval for each production vertical. Registry evidence must not be deleted merely because the public view is restricted; deletion must preserve required revocation and audit evidence.
