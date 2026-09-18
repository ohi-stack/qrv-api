import fs from 'node:fs';

const spec = fs.readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8');
const required = [
  'openapi: 3.1.0',
  '/healthz:',
  '/readyz:',
  '/version:',
  '/api/v1/status:',
  '/api/v1/verify/{qrvid}:',
  '/api/v1/records:',
  '/api/v1/records/{qrvid}:',
  '/api/v1/records/{qrvid}/revoke:',
  '/api/v1/audit/{qrvid}:'
];
for (const token of required) {
  if (!spec.includes(token)) throw new Error('OpenAPI contract missing required token: ' + token);
}
if (spec.includes('/api/v1/contact-cards:') || spec.includes('/api/v1/webhooks:')) {
  throw new Error('Planned endpoint family was added to normative OpenAPI before implementation.');
}
console.log(JSON.stringify({ok:true,contract:'openapi.yaml',authority:'api.qrv.network'},null,2));
