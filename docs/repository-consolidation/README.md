# QR-V repository consolidation

Use these pinned references to review the two-node architecture and plan runtime changes. The snapshots retain upstream wording and dates. The active runtime and its validated contracts determine current behavior.

| Source | Selected material and disposition |
| --- | --- |
| [ohi-stack/qrv-docs](https://github.com/ohi-stack/qrv-docs/tree/79659aecb1b76a52327ee8acf3bb65edbe54c982) | Expected lifecycle semantics. Current API behavior and readiness gaps are documented separately. [VERIFICATION_STATUS_CONTRACT.md](../../docs/repository-consolidation/reference/qrv-docs/VERIFICATION_STATUS_CONTRACT.md) |
| [ohi-stack/qrv-infra](https://github.com/ohi-stack/qrv-infra/tree/f51823dde04d52b11d2948a508a989c48181ea27) | Service ownership and environment reference. Runtime configuration remains in the deployment environment. [network.manifest.json](../../docs/repository-consolidation/reference/qrv-infra/network.manifest.json) [PRODUCTION_ENVIRONMENT_CONTRACT.md](../../docs/repository-consolidation/reference/qrv-infra/PRODUCTION_ENVIRONMENT_CONTRACT.md) |
| [ohi-stack/qrv-registry](https://github.com/ohi-stack/qrv-registry/tree/144a85413c90e67c818e095a5cb3164b44928174) | PostgreSQL schema and migrations have one owner. Legacy Redis workers, webhooks and duplicate writers require a separate contract and review.  |
| [ohi-stack/qrv-security](https://github.com/ohi-stack/qrv-security/tree/2ceac90126d81657caf60af26178ea919e96cf27) | Security requirements reference. Review evidence is required before claiming controls are operational. [SECURITY.md](../../docs/repository-consolidation/reference/qrv-security/SECURITY.md) |
| [ohi-stack/qrv-status](https://github.com/ohi-stack/qrv-status/tree/c68808fb661dd6798f4df330f31a501a62207fb3) | Pinned monitor inventory. Historical statuses are configuration labels. [services.json](../../docs/repository-consolidation/reference/qrv-status/services.json) |
| [ohi-stack/qrv-demo-records](https://github.com/ohi-stack/qrv-demo-records/tree/454abd4df4453da81e7e984e8f3fcdc3acf24209) | Seed-policy reference only. Demo payloads are excluded from production storage. [README.md](../../docs/repository-consolidation/reference/qrv-demo-records/README.md) |

The API owns registry persistence and privileged operations. Node owns the public verification, registry and issuer entry points. The remaining runtime work includes issuer-scoped authorization, signature enforcement, public-field disclosure, and hosted lifecycle acceptance. See [API PR #5](https://github.com/ohi-stack/qrv-api/pull/5) and [Node PR #62](https://github.com/ohi-stack/qrv-node/pull/62).

## API contract reconciliation

The current main implementation uses `GET /api/v1/verify/:qrvid` and `GET /api/v1/records/:qrvid`. Registry writes use `POST /api/v1/records` and `POST /api/v1/records/:qrvid/revoke`. The legacy developer portal's `/api/v1/registry/create` and the older SDK's unversioned routes should be treated as historical. The current API gate documents the endpoints and environment used by this repository.

The imported verification contract includes issuer authorization, cryptographic checks, and privacy requirements that must be validated separately against implementation. The current main API version endpoint reports Ed25519 as disabled. Registry migrations continue to run through the existing API migration path.
