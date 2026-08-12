# QR-V API Production Deployment

This runbook governs the deployment of `qrv-api` as the sole backend application at `https://api.qrv.network`. It does not authorize deployment of `qrv-node` or retirement of legacy QR-V hosts.

## Release conditions

Do not merge or route production traffic until all of the following are true:

1. the current PR head has a successful GitHub Actions `CI` run;
2. PostgreSQL has a verified, restorable backup;
3. `api.qrv.network` is assigned to this application rather than the issuer interface;
4. production environment values are installed through the host's secret manager;
5. migration `2026-08-11-api-owned-v3` is applied;
6. `/healthz`, `/readyz`, and the guarded live acceptance command pass.

## Required runtime

```text
Repository: ohi-stack/qrv-api
Node.js: 20 or later
Install: npm ci --omit=dev
Migration: npm run migrate
Start: npm start
Public hostname: api.qrv.network
```

The application must listen on the platform-provided `PORT`. The hostname must forward directly to the Node application without login middleware or HTML rendering.

## Required secrets and configuration

Install these values in the production host. Never commit their values.

```env
NODE_ENV=production
APP_VERSION=2.0.0
QRV_PUBLIC_BASE_URL=https://qrv.network
QRV_API_BASE_URL=https://api.qrv.network/api/v1
QRV_ENV_CODE=PROD

DATABASE_URL=<production PostgreSQL connection URL>
DATABASE_SSL=true
DATABASE_SSL_REJECT_UNAUTHORIZED=true

QRV_WRITE_API_KEY=<cryptographically random value of at least 32 bytes>
QRV_DEFAULT_ISSUER_ID=<approved default issuer identifier>

REQUIRE_SIGNATURES=true
SIGNING_PRIVATE_KEY=<Ed25519 private key PEM>
SIGNING_PUBLIC_KEY=<matching Ed25519 public key PEM>

CORS_ALLOWED_ORIGINS=https://qrv.network
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=180
```

When the hosting panel cannot preserve multiline PEM values, store base64-encoded PEM in `SIGNING_PRIVATE_KEY_BASE64` and `SIGNING_PUBLIC_KEY_BASE64` instead. Do not configure both forms.

## Ordered deployment

1. Record the current API deployment version and hostname assignment.
2. Create and verify a restorable PostgreSQL backup.
3. Install dependencies with `npm ci --omit=dev`.
4. Install the required environment values.
5. Run `npm run migrate` once against production PostgreSQL.
6. Deploy and start `qrv-api`.
7. Assign `api.qrv.network` directly to the application.
8. Confirm `GET /healthz` returns HTTP 200 JSON from service `qrv-api` without a redirect.
9. Confirm `GET /readyz` returns HTTP 200 with:
   - `ready: true`;
   - `schemaVersion: 2026-08-11-api-owned-v3`;
   - `signingKeyPairValid: true`.
10. Run the live acceptance gate below.

## Guarded live acceptance

The gate creates one public and one private record expressly labeled as automated acceptance data, verifies privacy and integrity behavior, revokes both records, and confirms audit events.

```bash
export QRV_ACCEPTANCE_BASE_URL=https://api.qrv.network
export QRV_ACCEPTANCE_ISSUER_ID=<approved acceptance issuer>
export QRV_WRITE_API_KEY=<production write key>
export QRV_ACCEPTANCE_CONFIRM=CREATE_AND_REVOKE_TEST_RECORDS
npm run validate:live
```

A passing result reports `ok: true` and lists the revoked acceptance QRVIDs. Remove the shell variables from the session after the test.

## Rollback

If migration, readiness, or acceptance fails:

1. do not deploy `qrv-node`;
2. remove `api.qrv.network` from the failed application or restore the previous API assignment;
3. retain the failed deployment logs and acceptance run identifier;
4. restore PostgreSQL only when the migration caused a confirmed data or schema failure and the backup has been independently verified;
5. correct the cause on a new commit and rerun CI before another production attempt.

Do not point `api.qrv.network` back to the issuer application as a steady state. If no healthy API build is available, return a controlled service-unavailable response while preserving the prior database.

## Downstream release

Only after this API gate passes may `qrv-node` be merged and deployed. Legacy browser hostnames must then be converted to the documented 308 compatibility redirects before their application deployments are retired.
