# QR-V API Operations

## Service objectives

- Public verification availability objective: 99.9% monthly after the first production baseline is established.
- API application latency objective: p95 under 500 ms and p99 under 1 second, measured at the service boundary and excluding scanner network time.
- Recovery time objective: 60 minutes.
- Recovery point objective: 15 minutes or better when the database provider supports continuous point-in-time recovery.

These are operating objectives, not current performance claims.

## Monitoring

Monitor:

- `/healthz` for process reachability;
- `/readyz` for database, schema, signing, write authorization, and issuer readiness;
- HTTP 5xx, 429, and latency by route class;
- PostgreSQL connection count, saturation, storage, replication, and backup status;
- `INVALID_SIGNATURE`, `INVALID_STATUS`, and issuer-scope denial counts;
- migration and deployment commit identity.

Do not send the write credential to a public uptime monitor. The protected `/metrics` route is for a trusted internal collector only.

## Incident classes

| Severity | Example | Initial response objective |
|---|---|---|
| SEV-1 | false VERIFIED result, signing-key exposure, destructive database event | 15 minutes |
| SEV-2 | verification unavailable, widespread 5xx, failed revocation | 30 minutes |
| SEV-3 | degraded latency, partial issuer workflow failure | 4 hours |
| SEV-4 | documentation or non-production defect | next business cycle |

For a suspected false-positive verification or signing-key compromise, fail closed first: disable issuance, preserve read evidence, rotate the affected credential or key under the approved procedure, and publish only verified incident facts.

## Backup and recovery evidence

Each production release record must contain the backup identifier, backup completion time, restore-test date, schema version, deployed commit, operator, live-acceptance result, and rollback decision point. A backup that has never been restored in a test environment is not considered verified.
