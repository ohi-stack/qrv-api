import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ContactCardValidationError,
  normalizeContactCard,
  publicContactCard,
  renderVCard,
} from '../lib/vcard.js';

const contact = normalizeContactCard({
  givenName: 'Ada',
  familyName: 'Lovelace',
  organization: 'QR-V',
  title: 'Verifier',
  phones: [{ type: 'work', value: '+1 555 0100' }],
  emails: [{ type: 'work', value: 'ADA@EXAMPLE.COM' }],
  website: 'https://qrv.network/',
  socialLinks: [{ label: 'linkedin', url: 'https://www.linkedin.com/in/ada' }],
  publicFields: ['formattedName', 'organization', 'emails'],
});

test('normalizes a contact card without preserving unsafe values', () => {
  assert.equal(contact.formattedName, 'Ada Lovelace');
  assert.equal(contact.emails[0].value, 'ada@example.com');
  assert.equal(contact.schema, 'qrv-contact-card/1.0');
});

test('restricted contact cards disclose only selected fields', () => {
  const disclosed = publicContactCard(contact, 'restricted');
  assert.equal(disclosed.formattedName, 'Ada Lovelace');
  assert.equal(disclosed.organization, 'QR-V');
  assert.equal(disclosed.phones, undefined);
  assert.equal(publicContactCard(contact, 'private'), null);
});

test('renders interoperable vCard 3.0 output with QR-V provenance', () => {
  const output = renderVCard(contact, 'QRV-PROD-VCARD-000001', 'https://qrv.network/verify/QRV-PROD-VCARD-000001');
  assert.match(output, /BEGIN:VCARD\r\nVERSION:3\.0/);
  assert.match(output, /FN:Ada Lovelace/);
  assert.match(output, /X-QRV-ID:QRV-PROD-VCARD-000001/);
  assert.match(output, /END:VCARD\r\n$/);
  assert.ok(output.split('\r\n').every((line) => Buffer.byteLength(line, 'utf8') <= 75));
});

test('rejects insecure URLs and contact cards without a reachable channel', () => {
  assert.throws(
    () => normalizeContactCard({ formattedName: 'Unsafe', website: 'http://example.com' }),
    ContactCardValidationError,
  );
  assert.throws(
    () => normalizeContactCard({ formattedName: 'No Channel' }),
    /at least one phone, email, website, or social link/,
  );
});
