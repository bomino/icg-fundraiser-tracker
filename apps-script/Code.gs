// ICG Fundraiser Tracker API. Bound to the data Sheet; deployed as a web app that executes as
// the owner, so only this script ever touches the Sheet. Every request must carry a Google ID
// token for an allowlisted, verified email.

const HEADERS = {
  Pledges: ['id', 'phone', 'name', 'datePledged', 'amountPledged', 'notes', 'updatedAt', 'updatedBy'],
  Payments: ['id', 'phone', 'dateReceived', 'amountReceived', 'method', 'notes', 'updatedAt', 'updatedBy'],
};
const ENTRY_FIELDS = {
  Pledges: ['phone', 'name', 'datePledged', 'amountPledged', 'notes'],
  Payments: ['phone', 'dateReceived', 'amountReceived', 'method', 'notes'],
};
const AMOUNT_FIELDS = ['amountPledged', 'amountReceived'];
const DATE_FIELDS = ['datePledged', 'dateReceived'];
const DEFAULT_SETTINGS = [['goal', 10000], ['paymentMethods', 'Cash,Bank Transfer,Card,Check,Online,Other']];
// Keep in step with web/src/validate.ts.
const MAX_TEXT = 500;
const MAX_AMOUNT = 1000000000;
const WARNING_MARK = '⚠';
const TOKEN_CACHE_SECONDS = 300;
const LOCK_WAIT_MS = 10000;
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ApiError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.code = code;
    this.extra = extra || {};
  }
}

function doPost(e) {
  let body;
  try {
    const request = JSON.parse(e.postData.contents);
    const email = verifyToken_(request.idToken);
    body = { ok: true, data: dispatch_(request.op, request.payload || {}, email) };
  } catch (err) {
    body = { ok: false, error: errorBody_(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function dispatch_(op, payload, email) {
  switch (op) {
    case 'load':
      return { pledges: readRows_('Pledges'), payments: readRows_('Payments'), settings: readSettings_(), me: email };
    case 'upsertPledge':
      return withLock_(() => upsert_('Pledges', payload, email));
    case 'upsertPayment':
      return withLock_(() => upsert_('Payments', payload, email));
    case 'deletePledge':
      return withLock_(() => remove_('Pledges', payload));
    case 'deletePayment':
      return withLock_(() => remove_('Payments', payload));
    case 'setSetting':
      return withLock_(() => setSetting_(payload));
    default:
      throw new ApiError('BAD_REQUEST', 'Unknown operation: ' + op);
  }
}

function errorBody_(err) {
  if (err instanceof ApiError) return Object.assign({ code: err.code, message: err.message }, err.extra);
  // Never log err.message: for a JSON.parse failure it can echo the raw request body, idToken included.
  console.error('Unhandled server error', err && err.name);
  return { code: 'INTERNAL', message: 'Something went wrong on the server. Try again.' };
}

function clientId_() {
  const clientId = PropertiesService.getScriptProperties().getProperty('CLIENT_ID');
  // Without it every token looks foreign, which would read to volunteers as an endless "sign-in expired".
  if (!clientId) throw new ApiError('INTERNAL', 'The server is not configured: set the CLIENT_ID script property (see docs/SETUP.md).');
  return clientId;
}

function verifyToken_(token) {
  if (typeof token !== 'string' || token === '') throw new ApiError('UNAUTHENTICATED', 'Please sign in.');
  const clientId = clientId_();
  assertPlausibleToken_(token, clientId);
  const cache = CacheService.getScriptCache();
  const cacheKey = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  let email = cache.get(cacheKey);
  if (!email) {
    const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw new ApiError('UNAUTHENTICATED', 'Your sign-in has expired. Please sign in again.');
    const info = JSON.parse(response.getContentText());
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expSeconds = Number(info.exp);
    const valid = info.aud === clientId && info.email_verified === 'true' && GOOGLE_ISSUERS.indexOf(info.iss) >= 0 && expSeconds > nowSeconds && info.email;
    if (!valid) throw new ApiError('UNAUTHENTICATED', 'Your sign-in has expired. Please sign in again.');
    email = String(info.email).toLowerCase();
    cache.put(cacheKey, email, Math.min(TOKEN_CACHE_SECONDS, expSeconds - nowSeconds));
  }
  // Not cached, so removing someone from the Allowlist takes effect on their next request.
  if (allowlist_().indexOf(email) < 0) throw new ApiError('FORBIDDEN', email + ' is not on the volunteer list.');
  return email;
}

// Rejects malformed tokens and tokens minted for a different app locally, before spending a
// network call on them. Tokeninfo (in verifyToken_) remains the actual authority.
function assertPlausibleToken_(token, clientId) {
  const segments = token.split('.');
  const malformed = segments.length !== 3 || segments.some((segment) => segment === '');
  if (malformed) throw new ApiError('UNAUTHENTICATED', 'Your sign-in has expired. Please sign in again.');
  let payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(segments[1])).getDataAsString());
  } catch (err) {
    throw new ApiError('UNAUTHENTICATED', 'Your sign-in has expired. Please sign in again.');
  }
  if (payload.aud !== clientId) throw new ApiError('UNAUTHENTICATED', 'Your sign-in has expired. Please sign in again.');
}

function allowlist_() {
  return sheet_('Allowlist').getDataRange().getValues().slice(1)
    .map((row) => String(row[0]).trim().toLowerCase())
    .filter(Boolean);
}

function sheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new ApiError('INTERNAL', 'The "' + name + '" tab is missing. Run setup() in Apps Script.');
  return sheet;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) throw new ApiError('BUSY', 'The tracker is busy. Try again in a moment.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function readRows_(tab) {
  return sheet_(tab).getDataRange().getValues().slice(1)
    .filter((row) => row[0] !== '')
    .map((row) => toRecord_(tab, row));
}

function toRecord_(tab, row) {
  const record = {};
  HEADERS[tab].forEach((field, i) => {
    record[field] = fromCell_(field, row[i]);
  });
  return record;
}

// Tolerates rows typed straight into the Sheet: real dates become ISO text (in the
// spreadsheet's own zone, which is how Sheets built the Date cell in the first place), junk
// amounts become blank, and a date-column cell holding non-ISO text reads as blank rather than
// an unparseable string the engine would otherwise compare against real ISO dates.
function fromCell_(field, value) {
  if (AMOUNT_FIELDS.indexOf(field) >= 0) return amountFromCell_(value);
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return DATE_FIELDS.indexOf(field) >= 0
      ? Utilities.formatDate(value, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd')
      : Utilities.formatDate(value, 'UTC', "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
  }
  if (DATE_FIELDS.indexOf(field) >= 0) return typeof value === 'string' && isIsoDate_(value) ? value : '';
  return value === null || value === undefined ? '' : String(value);
}

// A real number if finite, a non-blank string only if it parses to a finite number, otherwise
// blank: a stray whitespace cell or a checkbox left in an amount column must not silently
// become 0 (JS coerces '   ' and booleans to numbers) or a "twelve"-style typo.
function amountFromCell_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const amount = Number(trimmed);
    return isFinite(amount) ? amount : null;
  }
  return null;
}

// The apostrophe is the only text-forcing mechanism — do not also format Pledges/Payments
// columns as plain text ('@') in setup(): a '@'-formatted cell stores the apostrophe itself
// instead of stripping it, corrupting every id/date/text value written this way.
// It forces Sheets to store text verbatim: keeps leading zeros and '+', stops dates being
// reinterpreted, and prevents a value like '=HYPERLINK(...)' running as a formula.
function toSheetRow_(tab, record) {
  return HEADERS[tab].map((field) => {
    const value = record[field];
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' && value !== '') return "'" + value;
    return value;
  });
}

function invalid_(field, message) {
  return new ApiError('BAD_REQUEST', message, { field: field });
}

function isIsoDate_(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function amountProblem_(value) {
  if (value === null) return '';
  if (!isFinite(value) || value < 0) return 'Enter an amount of 0 or more.';
  if (value > MAX_AMOUNT) return 'That amount is too large.';
  if (Math.abs(Math.round(value * 100) - value * 100) > 1e-6) return 'Use at most 2 decimal places.';
  return '';
}

function validateRow_(tab, payload, methods) {
  const row = {};
  ENTRY_FIELDS[tab].forEach((field) => {
    const value = payload[field];
    if (AMOUNT_FIELDS.indexOf(field) >= 0) {
      if (value !== null && typeof value !== 'number') throw invalid_(field, 'Amount must be a number.');
      const problem = amountProblem_(value);
      if (problem) throw invalid_(field, problem);
      row[field] = value === null ? null : Math.round(value * 100) / 100;
      return;
    }
    if (typeof value !== 'string') throw invalid_(field, 'Expected text.');
    if (value.length > MAX_TEXT) throw invalid_(field, 'Keep this under ' + MAX_TEXT + ' characters.');
    if (DATE_FIELDS.indexOf(field) >= 0 && value !== '' && !isIsoDate_(value)) throw invalid_(field, 'Enter a valid date.');
    row[field] = value;
  });
  if (tab === 'Pledges' && row.name.indexOf(WARNING_MARK) === 0) throw invalid_('name', 'A name cannot start with ' + WARNING_MARK + '.');
  if (tab === 'Payments') {
    if (row.phone.trim() === '') throw invalid_('phone', "Enter the donor's phone number.");
    if (row.method !== '' && methods.indexOf(row.method) < 0) throw invalid_('method', 'Pick a method from the list.');
  }
  return row;
}

function findRow_(sheet, tab, id) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) return { rowNumber: i + 1, record: toRecord_(tab, values[i]) };
  }
  return null;
}

function assertUnchanged_(found, updatedAt) {
  if (!found) throw new ApiError('NOT_FOUND', 'Someone else deleted this row.');
  if (found.record.updatedAt !== updatedAt) {
    throw new ApiError('CONFLICT', 'Someone else changed this row since you opened it.', { current: found.record });
  }
}

function assertValidId_(id) {
  if (typeof id !== 'string' || id === '') throw invalid_('id', 'Missing the row id.');
}

function upsert_(tab, payload, email) {
  const methods = tab === 'Payments' ? readSettings_().paymentMethods : [];
  const record = validateRow_(tab, payload, methods);
  record.updatedAt = new Date().toISOString();
  record.updatedBy = email;
  const sheet = sheet_(tab);
  // No version means a create. The client names the row, so a create retried after a lost
  // response finds its own row instead of appending a duplicate.
  if (payload.updatedAt === undefined || payload.updatedAt === null) {
    if (typeof payload.id !== 'string' || !UUID_PATTERN.test(payload.id)) throw invalid_('id', 'Missing or malformed row id.');
    const existing = findRow_(sheet, tab, payload.id);
    if (existing) {
      // Same id and same values is a retry of a create that already landed; different values
      // must not be silently dropped in favour of the first copy.
      const same = ENTRY_FIELDS[tab].every((field) => existing.record[field] === record[field]);
      if (!same) throw new ApiError('CONFLICT', 'This entry was already saved with different values. Reopen it to check.', { current: existing.record });
      return existing.record;
    }
    record.id = payload.id;
    sheet.appendRow(toSheetRow_(tab, record));
    return record;
  }
  assertValidId_(payload.id);
  const found = findRow_(sheet, tab, payload.id);
  assertUnchanged_(found, payload.updatedAt);
  record.id = payload.id;
  sheet.getRange(found.rowNumber, 1, 1, HEADERS[tab].length).setValues([toSheetRow_(tab, record)]);
  return record;
}

function remove_(tab, payload) {
  assertValidId_(payload.id);
  if (typeof payload.updatedAt !== 'string') throw invalid_('updatedAt', 'Missing the row version.');
  const sheet = sheet_(tab);
  const found = findRow_(sheet, tab, payload.id);
  assertUnchanged_(found, payload.updatedAt);
  sheet.deleteRow(found.rowNumber);
  return { id: payload.id };
}

function readSettings_() {
  const values = {};
  sheet_('Settings').getDataRange().getValues().slice(1).forEach((row) => {
    values[String(row[0]).trim()] = row[1];
  });
  const goal = values.goal === '' || values.goal === undefined ? null : Number(values.goal);
  return {
    goal: goal === null || isFinite(goal) ? goal : null,
    paymentMethods: String(values.paymentMethods || '').split(',').map((method) => method.trim()).filter(Boolean),
  };
}

function setSetting_(payload) {
  if (payload.key !== 'goal') throw invalid_('key', 'Only the goal can be changed from the app.');
  const value = payload.value;
  if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > MAX_AMOUNT) throw invalid_('goal', 'Enter a goal of 0 or more.');
  const goal = Math.round(value * 100) / 100;
  const sheet = sheet_('Settings');
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === 'goal') {
      sheet.getRange(i + 1, 2).setValue(goal);
      return readSettings_();
    }
  }
  sheet.appendRow(['goal', goal]);
  return readSettings_();
}

// Run once from the Apps Script editor. Safe to re-run: existing tabs are left alone.
function setup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach((tab) => {
    ensureTab_(spreadsheet, tab, HEADERS[tab], () => {});
  });
  ensureTab_(spreadsheet, 'Settings', ['key', 'value'], (sheet) => DEFAULT_SETTINGS.forEach((row) => sheet.appendRow(row)));
  ensureTab_(spreadsheet, 'Allowlist', ['email'], (sheet) => {
    const owner = Session.getEffectiveUser().getEmail();
    if (owner) sheet.appendRow([owner]);
  });
}

function ensureTab_(spreadsheet, name, headers, initialise) {
  if (spreadsheet.getSheetByName(name)) return;
  const sheet = spreadsheet.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  initialise(sheet);
}
