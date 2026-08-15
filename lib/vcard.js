const FIELD_NAMES = Object.freeze([
  'formattedName', 'givenName', 'familyName', 'organization', 'title',
  'phones', 'emails', 'address', 'website', 'socialLinks', 'note', 'photoUrl',
]);

const FIELD_SET = new Set(FIELD_NAMES);
const PHONE_TYPES = new Set(['work', 'cell', 'home', 'fax', 'voice', 'other']);
const EMAIL_TYPES = new Set(['work', 'home', 'other']);
const SOCIAL_LABELS = new Set([
  'linkedin', 'x', 'twitter', 'facebook', 'instagram', 'youtube', 'tiktok',
  'github', 'website', 'portfolio', 'other',
]);

export class ContactCardValidationError extends Error {
  constructor(message, field = 'contact') {
    super(message);
    this.name = 'ContactCardValidationError';
    this.field = field;
  }
}

function text(value, maximum, field, { required = false } = {}) {
  const normalized = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !normalized) throw new ContactCardValidationError(`${field} is required`, field);
  if (normalized.length > maximum) throw new ContactCardValidationError(`${field} exceeds ${maximum} characters`, field);
  return normalized || null;
}

function url(value, field) {
  const normalized = text(value, 2048, field);
  if (!normalized) return null;
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new ContactCardValidationError(`${field} must be a valid HTTPS URL`, field);
  }
  if (parsed.protocol !== 'https:') throw new ContactCardValidationError(`${field} must use HTTPS`, field);
  parsed.username = '';
  parsed.password = '';
  return parsed.toString();
}

function email(value, field) {
  const normalized = text(value, 254, field);
  if (!normalized) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new ContactCardValidationError(`${field} must be a valid email address`, field);
  }
  return normalized.toLowerCase();
}

function phone(value, field) {
  const normalized = text(value, 40, field);
  if (!normalized) return null;
  if (!/^[+0-9().\-\s]{5,40}$/.test(normalized)) {
    throw new ContactCardValidationError(`${field} contains unsupported characters`, field);
  }
  return normalized;
}

function list(value, maximum, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ContactCardValidationError(`${field} must be an array`, field);
  if (value.length > maximum) throw new ContactCardValidationError(`${field} supports at most ${maximum} entries`, field);
  return value;
}

function normalizePhones(value) {
  return list(value, 10, 'contact.phones').map((entry, index) => {
    const field = `contact.phones[${index}]`;
    const type = String(entry?.type || 'work').toLowerCase();
    if (!PHONE_TYPES.has(type)) throw new ContactCardValidationError(`${field}.type is unsupported`, `${field}.type`);
    return { type, value: phone(entry?.value, `${field}.value`) };
  }).filter((entry) => entry.value);
}

function normalizeEmails(value) {
  return list(value, 10, 'contact.emails').map((entry, index) => {
    const field = `contact.emails[${index}]`;
    const type = String(entry?.type || 'work').toLowerCase();
    if (!EMAIL_TYPES.has(type)) throw new ContactCardValidationError(`${field}.type is unsupported`, `${field}.type`);
    return { type, value: email(entry?.value, `${field}.value`) };
  }).filter((entry) => entry.value);
}

function normalizeAddress(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ContactCardValidationError('contact.address must be an object', 'contact.address');
  }
  const address = {
    type: ['work', 'home', 'other'].includes(String(value.type || 'work').toLowerCase())
      ? String(value.type || 'work').toLowerCase()
      : 'other',
    street: text(value.street, 200, 'contact.address.street'),
    locality: text(value.locality ?? value.city, 100, 'contact.address.locality'),
    region: text(value.region ?? value.state, 100, 'contact.address.region'),
    postalCode: text(value.postalCode, 32, 'contact.address.postalCode'),
    country: text(value.country, 100, 'contact.address.country'),
  };
  return Object.values(address).some((item, index) => index > 0 && item) ? address : null;
}

function normalizeSocialLinks(value) {
  return list(value, 12, 'contact.socialLinks').map((entry, index) => {
    const field = `contact.socialLinks[${index}]`;
    const label = String(entry?.label || 'other').toLowerCase();
    if (!SOCIAL_LABELS.has(label)) throw new ContactCardValidationError(`${field}.label is unsupported`, `${field}.label`);
    return { label, url: url(entry?.url, `${field}.url`) };
  }).filter((entry) => entry.url);
}

export function normalizeContactCard(value, { partial = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContactCardValidationError('contact must be an object');
  }

  const givenName = text(value.givenName, 100, 'contact.givenName');
  const familyName = text(value.familyName, 100, 'contact.familyName');
  const inferredName = [givenName, familyName].filter(Boolean).join(' ');
  const formattedName = text(value.formattedName || inferredName, 200, 'contact.formattedName', { required: !partial });

  const publicFieldsInput = value.publicFields == null ? FIELD_NAMES : value.publicFields;
  if (!Array.isArray(publicFieldsInput)) {
    throw new ContactCardValidationError('contact.publicFields must be an array', 'contact.publicFields');
  }
  const publicFields = [...new Set(publicFieldsInput.map((item) => String(item)))];
  if (publicFields.some((field) => !FIELD_SET.has(field))) {
    throw new ContactCardValidationError('contact.publicFields contains an unsupported field', 'contact.publicFields');
  }

  const contact = {
    schema: 'qrv-contact-card/1.0',
    formattedName,
    givenName,
    familyName,
    organization: text(value.organization, 200, 'contact.organization'),
    title: text(value.title, 150, 'contact.title'),
    phones: normalizePhones(value.phones),
    emails: normalizeEmails(value.emails),
    address: normalizeAddress(value.address),
    website: url(value.website, 'contact.website'),
    socialLinks: normalizeSocialLinks(value.socialLinks),
    note: text(value.note, 1000, 'contact.note'),
    photoUrl: url(value.photoUrl, 'contact.photoUrl'),
    publicFields,
  };

  if (!partial && !contact.formattedName) {
    throw new ContactCardValidationError('contact.formattedName is required', 'contact.formattedName');
  }
  if (!partial && !contact.phones.length && !contact.emails.length && !contact.website && !contact.socialLinks.length) {
    throw new ContactCardValidationError('contact requires at least one phone, email, website, or social link');
  }
  return contact;
}

export function publicContactCard(contact, visibility = 'public') {
  if (!contact || visibility === 'private') return null;
  const allowed = new Set(Array.isArray(contact.publicFields) ? contact.publicFields : []);
  const output = { schema: 'qrv-contact-card/1.0' };
  for (const field of FIELD_NAMES) {
    if (visibility === 'public' || allowed.has(field)) output[field] = contact[field] ?? null;
  }
  if (!output.formattedName && visibility === 'restricted') return null;
  return output;
}

function vcardEscape(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function vcardType(value) {
  return String(value || 'other').replace(/[^A-Za-z0-9-]/g, '').toUpperCase() || 'OTHER';
}

function foldVCardLine(line) {
  const chunks = [];
  let current = '';
  let maximum = 75;
  for (const character of String(line)) {
    if (Buffer.byteLength(current + character, 'utf8') > maximum) {
      chunks.push(current);
      current = character;
      maximum = 74;
    } else {
      current += character;
    }
  }
  chunks.push(current);
  return chunks.map((chunk, index) => index === 0 ? chunk : ` ${chunk}`).join('\r\n');
}

export function renderVCard(contact, qrvid, verifyUrl) {
  if (!contact?.formattedName) throw new ContactCardValidationError('A public formatted name is required for vCard download');
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${vcardEscape(contact.formattedName)}`,
    `N:${vcardEscape(contact.familyName)};${vcardEscape(contact.givenName)};;;`,
  ];
  if (contact.organization) lines.push(`ORG:${vcardEscape(contact.organization)}`);
  if (contact.title) lines.push(`TITLE:${vcardEscape(contact.title)}`);
  for (const entry of contact.phones || []) lines.push(`TEL;TYPE=${vcardType(entry.type)}:${vcardEscape(entry.value)}`);
  for (const entry of contact.emails || []) lines.push(`EMAIL;TYPE=${vcardType(entry.type)}:${vcardEscape(entry.value)}`);
  if (contact.address) {
    const address = contact.address;
    lines.push(`ADR;TYPE=${vcardType(address.type)}:;;${vcardEscape(address.street)};${vcardEscape(address.locality)};${vcardEscape(address.region)};${vcardEscape(address.postalCode)};${vcardEscape(address.country)}`);
  }
  if (contact.website) lines.push(`URL:${contact.website}`);
  for (const entry of contact.socialLinks || []) lines.push(`X-SOCIALPROFILE;TYPE=${vcardType(entry.label)}:${entry.url}`);
  if (contact.photoUrl) lines.push(`PHOTO;VALUE=URI:${contact.photoUrl}`);
  if (contact.note) lines.push(`NOTE:${vcardEscape(contact.note)}`);
  lines.push(`X-QRV-ID:${vcardEscape(qrvid)}`);
  lines.push(`X-QRV-VERIFY:${verifyUrl}`);
  lines.push(`REV:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`);
  lines.push('END:VCARD');
  return `${lines.map(foldVCardLine).join('\r\n')}\r\n`;
}

export const contactCardFields = FIELD_NAMES;
