// ICG Fundraiser Tracker API. Bound to the data Sheet; deployed as a web app that executes as
// the owner, so only this script ever touches the Sheet. Every request must carry a Google ID
// token for an allowlisted, verified email.

// The site is built against this number (vite.config.ts reads this exact line) and compares it with
// the one `load` returns, so a volunteer sees a banner instead of saves failing in misleading ways
// when this script and the site are deployed out of step. Raise it on every edit to this file;
// test/server/code.test.ts fails until you do.
const API_VERSION = 4;

const HEADERS = {
  Pledges: ['id', 'phone', 'name', 'datePledged', 'amountPledged', 'notes', 'updatedAt', 'updatedBy'],
  Payments: ['id', 'phone', 'dateReceived', 'amountReceived', 'method', 'notes', 'updatedAt', 'updatedBy'],
};
const ENTRY_FIELDS = {
  Pledges: ['phone', 'name', 'datePledged', 'amountPledged', 'notes'],
  Payments: ['phone', 'dateReceived', 'amountReceived', 'method', 'notes'],
};
const HISTORY_HEADERS = ['changedAt', 'changedBy', 'action'];
const AMOUNT_FIELDS = ['amountPledged', 'amountReceived'];
const DATE_FIELDS = ['datePledged', 'dateReceived'];
const DEFAULT_SETTINGS = [['goal', 10000], ['paymentMethods', 'Cash,Bank Transfer,Card,Check,Online,Other'], ['campaignName', 'Fundraiser']];
// Keep in step with web/src/validate.ts.
const MAX_TEXT = 500;
const MAX_AMOUNT = 1000000000;
const WARNING_MARK = '⚠';
const TOKEN_CACHE_SECONDS = 300;
const LOCK_WAIT_MS = 10000;
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
// Keep in step with IGNORED_CHARACTERS in web/src/matchKey.ts: a phone of only these is blank.
const PHONE_IGNORED = /[\s\-().+\u2010-\u2015\u2212]/g;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ApiError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.code = code;
    this.extra = extra || {};
  }
}

function doPost(e) {
  let request = {};
  let body;
  try {
    request = readRequest_(e);
    const email = verifyToken_(request.idToken);
    body = { ok: true, data: dispatch_(request.op, request.payload || {}, email) };
  } catch (err) {
    body = { ok: false, error: errorBody_(err, request) };
  }
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

// Parsed on its own so that a JSON.parse error, which quotes the raw body and its idToken, is
// never logged: a body that can't be read has no known token to mask.
function readRequest_(e) {
  let request;
  try {
    request = JSON.parse(e.postData.contents);
  } catch (err) {
    request = null;
  }
  if (request === null || typeof request !== 'object') throw new ApiError('BAD_REQUEST', 'The request could not be read.');
  return request;
}

function dispatch_(op, payload, email) {
  switch (op) {
    case 'load':
      return load_(email);
    case 'upsertPledge':
      return withLock_(() => upsert_('Pledges', payload, email));
    case 'upsertPayment':
      return withLock_(() => upsert_('Payments', payload, email));
    case 'deletePledge':
      return withLock_(() => remove_('Pledges', payload, email));
    case 'deletePayment':
      return withLock_(() => remove_('Payments', payload, email));
    case 'setSetting':
      return withLock_(() => setSetting_(payload));
    default:
      throw new ApiError('BAD_REQUEST', 'Unknown operation: ' + op);
  }
}

// doPost answers every error itself, so the Executions page lists each run as Completed and these
// lines are the owner's only trace of what went wrong. Every line has the caller's token masked.
function errorBody_(err, request) {
  if (err instanceof ApiError) {
    // The other refusals are the volunteer's to fix; these show how often the tracker is
    // overloaded, and who was turned away (an Allowlist typo, say).
    if (err.code === 'BUSY' || err.code === 'FORBIDDEN') console.warn(maskToken_(err.code + ' in ' + request.op + ': ' + err.message, request.idToken));
    return Object.assign({ code: err.code, message: err.message }, err.extra);
  }
  // The whole stack, message included, because "Service Spreadsheets timed out" and a TypeError
  // need different fixes. readRequest_ and fetchTokenInfo_ keep out the errors that quote the token.
  console.error(maskToken_('Unhandled server error in ' + request.op + ': ' + (err && err.stack ? err.stack : err), request.idToken));
  return { code: 'INTERNAL', message: 'Something went wrong on the server. Try again.' };
}

function maskToken_(text, token) {
  return typeof token === 'string' && token !== '' ? String(text).split(token).join('<token>') : String(text);
}

function clientId_() {
  // Trimmed, because a space or line break pasted in with the value would make every token look foreign.
  const clientId = (PropertiesService.getScriptProperties().getProperty('CLIENT_ID') || '').trim();
  // Without it every token looks foreign, and the answer would blame two different sign-in IDs
  // when the organiser has in fact left this one out.
  if (!clientId) throw new ApiError('INTERNAL', 'The server is not configured: set the CLIENT_ID script property (see docs/SETUP.md).');
  return clientId;
}

function verifyToken_(token) {
  if (typeof token !== 'string' || token === '') throw new ApiError('UNAUTHENTICATED', 'Please sign in.');
  const clientId = clientId_();
  assertPlausibleToken_(token, clientId);
  const cache = CacheService.getScriptCache();
  // clientId is folded into the key (defense in depth): assertPlausibleToken_'s aud check above
  // already re-verifies on a CLIENT_ID rotation, but a cache entry keyed on the token alone
  // would otherwise be reachable regardless of which clientId it was verified under.
  const cacheKey = 'tok_' + clientId + '_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  let email = cache.get(cacheKey);
  if (!email) {
    const response = fetchTokenInfo_(token);
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

// A failed fetch's own error quotes the URL, token included, so a fixed one is thrown instead.
function fetchTokenInfo_(token) {
  try {
    return UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  } catch (err) {
    throw new Error('tokeninfo request failed');
  }
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
  // The site signs volunteers in for its VITE_GOOGLE_CLIENT_ID, so a token for another audience
  // means that and CLIENT_ID differ. A fresh sign-in would carry the same audience, so this is not
  // UNAUTHENTICATED, which the app answers by asking for one. The unverified payload only picks
  // the message: the request is refused either way.
  if (payload.aud !== clientId) throw new ApiError('INTERNAL', 'This site and the server are set up with different Google sign-in IDs. Reload the page; if it keeps happening, tell the organiser.');
}

function allowlist_() {
  return sheet_('Allowlist').getDataRange().getValues().slice(1)
    .map((row) => String(row[0]).trim().toLowerCase())
    .filter(Boolean);
}

function sheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  // setup() only adds tabs, so following it after a rename would leave the records stranded in the renamed tab.
  if (!sheet) throw new ApiError('INTERNAL', 'The "' + name + '" tab is missing. If it was renamed, rename it back to "' + name + '". Run setup() only when setting up a new Sheet.');
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

function load_(email) {
  const pledges = readRows_('Pledges');
  const payments = readRows_('Payments');
  return {
    pledges: pledges.records,
    payments: payments.records,
    settings: readSettings_(),
    me: email,
    rowsWithoutId: { pledges: pledges.withoutId, payments: payments.withoutId },
    apiVersion: API_VERSION,
  };
}

function readRows_(tab) {
  const values = sheet_(tab).getDataRange().getValues();
  assertHeaders_(tab, values[0]);
  const rows = values.slice(1);
  return {
    records: rows.filter((row) => row[0] !== '').map((row) => toRecord_(tab, row)),
    withoutId: rows.filter((row) => row[0] === '' && looksLikeEntry_(tab, row)).length,
  };
}

// A row with no id is never loaded, so the Summary says how many look like real entries: a phone,
// and on Payments an amount. Totals and notes rows under the data have neither, and are left out.
function looksLikeEntry_(tab, row) {
  const record = toRecord_(tab, row);
  if (record.phone.replace(PHONE_IGNORED, '') === '') return false;
  return tab !== 'Payments' || record.amountReceived !== null;
}

// Rows are read and written by column position, so a column inserted, moved or deleted in the
// Sheet would misread every field after it and let the next edit overwrite the new column.
// Relabelling ("Amount Pledged") is harmless, and so are extra columns after updatedBy, which
// are never read or written.
function assertHeaders_(tab, header) {
  const cells = header || [];
  const expected = HEADERS[tab];
  for (let i = 0; i < expected.length; i++) {
    const cell = cells[i] === undefined ? '' : String(cells[i]).trim();
    if (headerKey_(cell) !== headerKey_(expected[i])) {
      const found = cell === '' ? 'blank' : '"' + cell + '"';
      const problem = 'The ' + ordinal_(i + 1) + ' column of the "' + tab + '" tab should be "' + expected[i] + '" but is ' + found + '.';
      // Volunteers see this too, so it names who can fix it.
      throw new ApiError('INTERNAL', problem + ' The organiser needs to undo the change with Version history, or move new columns to the right of updatedBy.');
    }
  }
}

function headerKey_(label) {
  return label.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function ordinal_(n) {
  const suffixes = { 1: 'st', 2: 'nd', 3: 'rd' };
  return n + (suffixes[n] || 'th');
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

function toSheetRow_(tab, record) {
  return HEADERS[tab].map((field) => toCell_(record[field]));
}

// The apostrophe is the only text-forcing mechanism — do not also format Pledges/Payments
// columns as plain text ('@') in setup(): a '@'-formatted cell stores the apostrophe itself
// instead of stripping it, corrupting every id/date/text value written this way.
// It forces Sheets to store text verbatim: keeps leading zeros and '+', stops dates being
// reinterpreted, and prevents a value like '=HYPERLINK(...)' running as a formula.
function toCell_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && value !== '') return "'" + value;
  return value;
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
  // Tolerance scales with the amount, as in web/src/validate.ts.
  if (Math.abs(Math.round(value * 100) / 100 - value) > 4 * Number.EPSILON * Math.max(1, Math.abs(value))) return 'Use at most 2 decimal places.';
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
    if (row.phone.replace(PHONE_IGNORED, '') === '') throw invalid_('phone', "Enter the donor's phone number.");
    if (row.amountReceived === null) throw invalid_('amountReceived', 'Enter the amount received.');
    if (row.method !== '' && methods.indexOf(row.method) < 0) throw invalid_('method', 'Pick a method from the list.');
  }
  return row;
}

// Every append, update and delete looks its row up here first, so this header check guards every write.
function findRow_(sheet, tab, id) {
  const values = sheet.getDataRange().getValues();
  assertHeaders_(tab, values[0]);
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
  appendHistory_(tab, found.record, email, 'edit');
  sheet.getRange(found.rowNumber, 1, 1, HEADERS[tab].length).setValues([toSheetRow_(tab, record)]);
  return record;
}

function remove_(tab, payload, email) {
  assertValidId_(payload.id);
  if (typeof payload.updatedAt !== 'string') throw invalid_('updatedAt', 'Missing the row version.');
  const sheet = sheet_(tab);
  const found = findRow_(sheet, tab, payload.id);
  assertUnchanged_(found, payload.updatedAt);
  appendHistory_(tab, found.record, email, 'delete');
  sheet.deleteRow(found.rowNumber);
  return { id: payload.id };
}

// The script runs as the owner, so the Sheet's own version history can't say which volunteer
// changed a row, and restoring an old version there undoes everyone's work since. This keeps the
// version an edit or delete replaces, laid out so its first cells can be pasted straight back.
// It runs before the change and any failure fails the change, so nothing changes unrecorded.
function appendHistory_(tab, record, email, action) {
  const change = { changedAt: new Date().toISOString(), changedBy: email, action: action };
  historySheet_(tab).appendRow(toSheetRow_(tab, record).concat(HISTORY_HEADERS.map((field) => toCell_(change[field]))));
}

// Also created on first use, so a Sheet set up before history was kept needs no setup() re-run.
function historySheet_(tab) {
  return ensureTab_(SpreadsheetApp.getActiveSpreadsheet(), historyTabName_(tab), HEADERS[tab].concat(HISTORY_HEADERS), () => {});
}

function historyTabName_(tab) {
  return tab + ' history';
}

// A simple trigger: Sheets runs it for edits typed or pasted into the Sheet, never for this
// script's own writes. Without a new updatedAt, a volunteer who opened the row before the edit
// would pass the version check and save the old values back over it. Only rows that already have
// an id are stamped, since giving a row one would count a totals or notes row as an entry.
// Columns right of updatedBy are never read or written, so edits there need no new version.
function onEdit(e) {
  const sheet = e.range.getSheet();
  const tab = sheet.getName();
  if (Object.keys(HEADERS).indexOf(tab) < 0 || e.range.getColumn() > HEADERS[tab].length) return;
  const first = Math.max(e.range.getRow(), 2);
  const count = e.range.getLastRow() - first + 1;
  if (count < 1) return;
  // After a column is moved, updatedAt's place holds some other field, which a stamp would overwrite.
  assertHeaders_(tab, sheet.getRange(1, 1, 1, HEADERS[tab].length).getValues()[0]);
  const stamp = [[toCell_(new Date().toISOString()), toCell_((e.user && e.user.getEmail()) || 'edited in Sheet')]];
  const versionColumn = HEADERS[tab].indexOf('updatedAt') + 1;
  sheet.getRange(first, 1, count, 1).getValues().forEach((row, i) => {
    if (row[0] !== '') sheet.getRange(first + i, versionColumn, 1, 2).setValues(stamp);
  });
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
    campaignName: String(values.campaignName || '').trim(),
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
  Object.keys(HEADERS).forEach((tab) => historySheet_(tab));
}

// A simple trigger. The organiser's tasks sit in the Sheet's own menu because they ask before
// changing anything, and the Apps Script editor can't show a dialog (getUi() throws there), so
// they can't be started from its Run button by mistake either.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Fundraiser tracker').addItem('Start a new drive…', 'startNewDrive').addToUi();
}

// Keeps the finished drive in tabs named for it, which the app never reads, then empties the live
// tabs from row 2 down, all under the lock so that no save lands between the copy and the clear.
// It clears the rows rather than deleting them: Sheets refuses to delete every row below a frozen
// header, which deleting rows 2 to the last becomes once appendRow has grown a tab past 1,000 rows.
function startNewDrive() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.prompt(
    'Start a new drive',
    'This copies the Pledges and Payments tabs and their two history tabs into new tabs named with what you type, then empties the four originals from row 2 down, ready for the next drive. Ask volunteers to stop using the tracker first. Type a name for the finished drive, such as 2026:',
    ui.ButtonSet.OK_CANCEL,
  );
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  const label = answer.getResponseText().trim();
  if (label === '') {
    ui.alert('Start a new drive', 'Nothing was changed. Type a name for the finished drive, such as 2026.', ui.ButtonSet.OK);
    return;
  }
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const tabs = Object.keys(HEADERS);
  const names = tabs.concat(tabs.map((tab) => historyTabName_(tab)));
  const taken = names.map((name) => name + ' ' + label).filter((name) => spreadsheet.getSheetByName(name));
  if (taken.length > 0) {
    ui.alert('Start a new drive', 'Nothing was changed: there is already a tab named "' + taken[0] + '". Start again and type another name.', ui.ButtonSet.OK);
    return;
  }
  withLock_(() => {
    tabs.forEach((tab) => assertHeaders_(tab, sheet_(tab).getRange(1, 1, 1, HEADERS[tab].length).getValues()[0]));
    const sheets = tabs.map((tab) => sheet_(tab)).concat(tabs.map((tab) => historySheet_(tab)));
    // Every copy is made before anything is cleared, so a copy that fails costs no rows.
    sheets.forEach((sheet) => sheet.copyTo(spreadsheet).setName(sheet.getName() + ' ' + label));
    sheets.forEach((sheet) => {
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    });
  });
  ui.alert(
    'Start a new drive',
    'Done. The finished drive is in the tabs ending "' + label + '". Next, set the new goal and campaignName on the Settings tab, put the new volunteers on the Allowlist, and ask every volunteer to press Refresh before adding anything.',
    ui.ButtonSet.OK,
  );
}

function ensureTab_(spreadsheet, name, headers, initialise) {
  const existing = spreadsheet.getSheetByName(name);
  if (existing) return existing;
  const sheet = spreadsheet.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  initialise(sheet);
  return sheet;
}
