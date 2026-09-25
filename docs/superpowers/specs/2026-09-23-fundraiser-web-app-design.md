# Fundraiser Tracker Web App — Design

Note (2026-09-24): the Excel workbook referenced below is a separate project, not part of this app; parity is now checked against a frozen fixture (test/fixtures/).

Date: 2026-09-23
Status: awaiting review
Source of truth for behaviour: `Masjid_Fundraiser_Tracker_v3.xlsx` (see repo `CLAUDE.md`)

## 1. Intent

Turn the masjid fundraiser tracker workbook into a small web app hosted on GitHub Pages, so that several volunteers can record pledges and payments from any device, phones included, and see the same live totals.

**What the user decided**
- The data is stored in a Google Sheet the organiser owns. An Apps Script web app is the only thing that reads or writes it.
- Access uses Google sign-in, checked against an allowlist of volunteer emails kept in the Sheet.
- The Sheet holds the raw entries only. The app reproduces every calculated field in TypeScript.
- Build: Vite + TypeScript, no UI framework, Vitest, deployed to GitHub Pages by GitHub Actions.
- There is no existing data to migrate.

**Assumptions (correct these if wrong)**
- The xlsx and the user guide stay in service. The app is an alternative, not a replacement, so the business rules exist in two places and parity is enforced by tests (§6).
- Everyone on the allowlist has equal rights: add, edit, delete, and change the goal.
- The app is used online only. Expected volume is about 1,500 pledges and a few thousand payments.

**Success criteria**
1. With the same data, every calculated value in the app equals what Excel computes in the v3 workbook, including all the awkward cases listed in §6.
2. A Google account that isn't on the allowlist can't read or write any donor data, even when calling the Apps Script URL directly.
3. Two volunteers editing the same row can't silently overwrite each other's changes.
4. A volunteer with no spreadsheet experience can log a payment on a phone and sees immediately whether it will be counted.

## 2. Architecture

```
Browser — GitHub Pages (Vite + TS)                Apps Script web app                  Google Sheet (owner's Drive)
                                                  (execute as: owner; access: anyone)
auth.ts  GIS sign-in ─► Google ID token
api.ts   POST text/plain {idToken, op, payload} ─► doPost
                                                   ├ verifyToken (tokeninfo, cached) ─► Allowlist
                                                   ├ LockService (writes)            ─► Pledges
store.ts ◄─ JSON {ok, data | error} ◄──────────── └ dispatch op                      ─► Payments
engine.ts (pure) → derived rows, summary, health                                     ─► Settings
ui/*     Summary · Pledges · Payments · Find donor
```

- **Full load and client-side calculation.** `load` returns every row of every tab. The engine recalculates everything in memory after each load or change. At the expected volume the payload is under 1 MB and the calculation takes milliseconds, so the O(n²) lookup cost of the sheet formulas goes away.
- **No CORS preflight.** Requests are `POST` with `Content-Type: text/plain;charset=utf-8` and a JSON body. Apps Script can't answer an `OPTIONS` preflight, and its responses reach the browser through a `googleusercontent.com` redirect, which `fetch` follows.
- **Config** comes from two build-time variables: `VITE_SCRIPT_URL` and `VITE_GOOGLE_CLIENT_ID`. Neither is secret, because security rests on the server-side token check and allowlist. A build without them still succeeds and shows "Not set up yet", so the deploy workflow checks both before uploading the site and deploys nothing when either is missing or malformed (§8). Added 2026-09-25.

## 3. Google Sheet schema

Row 1 holds the headers and data starts at row 2. There are no formulas anywhere. `setup()` in Apps Script creates the tabs and headers and freezes row 1. Pledges and Payments are read and written by column position, so every read and write first checks their row 1 (ignoring case and anything but letters and digits) and answers `INTERNAL`, naming the first column out of place, if a column was inserted, moved or deleted; extra columns after `updatedBy` are allowed. Leading zeros in `phone` are kept by apostrophe-prefixing the text at write time (`toSheetRow_`), not by formatting the column as Plain text — a Plain-text cell stores the apostrophe literally instead of hiding it, corrupting ids, phone numbers and dates (see `CLAUDE.md`).

| Tab | Columns |
|---|---|
| `Pledges` | `id` · `phone` · `name` · `datePledged` · `amountPledged` · `notes` · `updatedAt` · `updatedBy` |
| `Payments` | `id` · `phone` · `dateReceived` · `amountReceived` · `method` · `notes` · `updatedAt` · `updatedBy` |
| `Settings` | key/value rows: `goal` (default 10000), `paymentMethods` (default `Cash,Bank Transfer,Card,Check,Online,Other`), `campaignName` (default `Fundraiser`; the Friday display's title, which reads `Fundraiser` when it is blank or missing; added 2026-09-25) |
| `Allowlist` | `email` (one per row, compared case-insensitively); the organiser may keep a `name` in column B, which is never read |
| `Pledges history` / `Payments history` | the `Pledges`/`Payments` columns, then `changedAt` · `changedBy` · `action` (`edit` or `delete`) |

- `id` is a UUID chosen by the client (`crypto.randomUUID()`) — the server only validates its shape. A create is therefore idempotent by id: a Save retried after a lost response cannot add a duplicate.
- `updatedAt` is an ISO timestamp and `updatedBy` an email, both stamped by the server. An edit typed or pasted straight into a Pledges or Payments row that has an `id` is stamped too, by an `onEdit` simple trigger (`updatedBy` is `edited in Sheet` when Google doesn't share the editor's email), so a volunteer's older copy fails the version check instead of overwriting the fix. The trigger never adds an `id`. Added 2026-09-25.
- Dates are stored as ISO `YYYY-MM-DD` text, so nothing is shifted by time zones.
- Amounts are stored as numbers with at most 2 decimals. A blank cell means "not entered", which is different from 0 (§5).
- Row order in the Sheet is insertion order. The engine keeps that order, because "first matching pledge" matters (§5.3).
- The history tabs hold the version of a row that each edit or delete replaced, with when, which volunteer (the caller's email) and which action, so the organiser can copy a row's first 8 cells back (`docs/SETUP.md`, Data safety routine). The script runs as the owner, so the Sheet's own version history names only the owner, and restoring a version there rolls back every volunteer's entries since. `load` never reads these tabs. Added 2026-09-25, reversing §9's original exclusion of any edit history.

## 4. Apps Script API (`apps-script/Code.gs`)

Every request looks like `{idToken, op, payload}`. Every response is `{ok: true, data}` or `{ok: false, error: {code, message}}`, always with HTTP 200, because Apps Script can't set status codes.

**Authentication on every call**
- Call `https://oauth2.googleapis.com/tokeninfo?id_token=…`.
- Require `aud == CLIENT_ID` (a Script property), `email_verified == "true"`, an `exp` in the future, and the email on the `Allowlist` tab.
- Cache the verified email in `CacheService`, keyed by a hash of the token, for `min(300 s, exp − now)`.
- Error codes: `UNAUTHENTICATED` for a bad or expired token, `FORBIDDEN` for an email not on the allowlist. A token whose own payload names an audience other than `CLIENT_ID` answers `INTERNAL` "This site and the server are set up with different Google sign-in IDs. Reload the page; if it keeps happening, tell the organiser.", because signing in again can't fix it (§7). Added 2026-09-25.

| op | payload | behaviour |
|---|---|---|
| `load` | — | `{pledges[], payments[], settings, me: email, rowsWithoutId: {pledges, payments}, apiVersion}`. Rows with a blank `id` are skipped; `rowsWithoutId` counts the skipped rows that look like entries (a non-blank phone, plus an amount on Payments), so a totals or notes row isn't counted. Ids are never filled in automatically. `apiVersion` is the script's `API_VERSION` (§7, Errors and state). |
| `upsertPledge` / `upsertPayment` | row (without `id` for an insert; with `id` and `updatedAt` for an update) | Validates (§7). For an update, if the stored `updatedAt` ≠ the sent `updatedAt`, returns `CONFLICT` with the current row. Otherwise appends the stored row to the history tab (§3), then stamps and writes the row and returns it. |
| `deletePledge` / `deletePayment` | `{id, updatedAt}` | Same conflict check, then appends the row to the history tab (§3) and deletes it from the sheet. `NOT_FOUND` if the row is gone. A history write that fails fails the edit or delete. |
| `setSetting` | `{key: "goal", value}` | Goal must be a number ≥ 0. `paymentMethods` can't be changed from the app; edit it in the Sheet. |

Writes run under `LockService.getScriptLock().tryLock(10000)`, which throws `BUSY` "The tracker is busy. Try again in a moment." rather than waiting indefinitely, and rows are found by scanning column A for the `id`. `setup()` is run once by hand from the Apps Script editor.

A body that isn't a JSON object answers `BAD_REQUEST` "The request could not be read." Any other unexpected failure answers `INTERNAL` "Something went wrong on the server. Try again." and is logged for the owner with its operation and stack; `BUSY` and `FORBIDDEN` are logged as one-line warnings. The caller's token is masked in every log line (see `docs/SETUP.md`, "Reading the server's log").

## 5. Calculation engine (`web/src/engine.ts`)

This is a pure module with no DOM and no network access. Money is handled internally in **integer cents**: the value from the Sheet is converted with `Math.round(x * 100)`. That gives exact sums, and it's why `ROUND(…,2)` in the workbook has a direct counterpart. "Blank" means the cell or field is empty. It is not zero.

### 5.1 Match key (Pledges K / Payments G)
`matchKey(phone)`:
1. Empty phone gives an empty key.
2. Otherwise, remove every `-`, `(`, `)`, `.`, `+` and space, trim, prefix with `#`, and **lower-case**. Lower-casing mirrors Excel's case-insensitive `COUNTIF`/`SUMIF`/`MATCH`.
3. A phone made only of punctuation therefore produces the key `"#"`, exactly as the workbook does.
4. An empty key never matches anything.

Deliberate deviation: keys are compared for exact string equality. Excel treats `*`, `?` and `~` inside a phone number as wildcards in `COUNTIF`/`SUMIF`; the app doesn't. Phones never legitimately contain those characters.

### 5.2 Pledge derived fields
Let `k` be the row's key and `M` the payments whose key equals `k`.

| Field | Rule (workbook formula it mirrors) |
|---|---|
| Amount Received (F) | blank if `amountPledged` is blank or `k` is empty; otherwise Σ `amountReceived` over `M`, where a blank amount counts as 0 |
| # Payments (H) | blank under the same condition; otherwise the count of `M`, including payments with no date or no amount |
| Last Payment Date (E) | blank under the same condition, or when no payment in `M` has a date; otherwise the latest `dateReceived` in `M` |
| Balance Due (G) | blank if `amountPledged` is blank; otherwise `pledged − (received or 0)` in cents |
| Status (I) | blank if `amountPledged` is blank; else `Pending` if received is blank or 0; else `Overpaid` if received − pledged > 0; else `Paid` if it's = 0; else `Partial` |
| Duplicate flag | `phone` not blank **and** more than one Pledges row has the key `k` (the Pledges red-row rule) |

Status strings are exported constants: `Pending`, `Partial`, `Paid`, `Overpaid`.

Known behaviour kept for parity: each duplicate row counts the donor's payments in full, so Total Received is inflated. The duplicate flag and the health count make this visible.

### 5.3 Payment derived fields
**Donor Name (B)**
- Blank if `phone` is blank.
- Otherwise find the **first** Pledges row, in Sheet order, whose key equals the payment's key.
  - No match: `⚠ phone not in Pledges`.
  - That row's `amountPledged` is blank: `⚠ no amount on Pledges`.
  - That row's `name` is blank: blank.
  - Otherwise the name.

**Flags**
- **Not counted:** `phone` is not blank and the Donor Name starts with `⚠`. This is the red-row rule.
- **Future date:** `dateReceived` is not blank and is after today's local date. This is the amber rule.

The warning strings are exported constants.

### 5.4 Summary
| Workbook | Label | Rule |
|---|---|---|
| B4 | Fundraiser Goal ($) | `settings.goal` |
| B5 | Total Pledged ($) | Σ `amountPledged` |
| B6 | Total Received ($) | Σ Pledges F |
| B7 | Total Balance Outstanding ($) | Σ Pledges G where G > 0 |
| B8 | Total Overpaid / Credit ($) | abs(Σ Pledges G where G < 0) |
| B9 | Number of Donors (pledged) | count of rows with `amountPledged` > 0 |
| B10–B13 | Number Fully Paid / Partial / Pending / Overpaid | count of rows with Status = `Paid` / `Partial` / `Pending` / `Overpaid` |
| B14 | % of Goal Received | B6 ÷ B4, or 0 when the goal is 0 or blank |
| B15 | Payments Logged ($) | Σ `amountReceived` over all payments |
| B16 | Unmatched Payments ($) | B15 − B6; highlighted when ≠ 0 |

Pledges totals band (row 3): Σ D, Σ F, Σ G where G > 0, Σ H.
Payments totals band (row 3): count of payments with amount > 0 (shown as "N payments"), and Σ amount.

### 5.5 Data Health (every value should be 0)
| Workbook | Label | Rule |
|---|---|---|
| B21 | Payments not matched to a pledge | payments whose Donor Name starts with `⚠` |
| B22 | Donors listed more than once | Pledges **rows** whose key is non-empty and shared with another row (two copies count as 2) |
| B23 | Pledges missing a phone number | `amountPledged` > 0 and `phone` blank |
| B24 | Payments missing a date or amount | `phone` not blank and (`dateReceived` blank or `amountReceived` blank) |
| B25 | Payments dated in the future | `dateReceived` after today |
| B26 | Donors whose payments predate their pledge | Pledges E not blank and E < `datePledged` (a blank `datePledged` never triggers) |

Known limitation kept for parity: B26 compares only the latest payment date. B25 is exact.

Each non-zero item links to the Pledges or Payments view, filtered to the rows that caused it. This goes beyond the workbook, which can't do it.

### 5.6 Collected by Payment Method (B30–B37)
- One row per method in `settings.paymentMethods`, in the order they're listed, holding Σ `amountReceived` for that method.
- Then "No method recorded" (Σ where `method` is blank).
- Then "Other / unlisted": Σ where `method` is set but isn't in the list. The workbook can't reach this state; the row only shows when it's non-zero.
- Then a Total that should equal B15.

### 5.7 Donor lookup (B41–B50)
- The input is normalized with `matchKey`, and the result is the **first** Pledges row with that key. That row's fields are shown (name, date pledged, amount, last payment date, received, balance, # payments, status, notes), or "Not found".
- Beyond the workbook: the lookup also accepts a name search (case-insensitive substring), which lists the candidate rows, and it shows the matched donor's payment history.

## 6. Testing

1. **Engine unit tests** (Vitest). There is one test per rule in §5 plus the awkward cases from `CLAUDE.md`:
   - a payment with an amount but no date
   - 0.1 + 0.2 against a 0.30 pledge, which must read `Paid` and show a balance of 0
   - an overpayment
   - a duplicate donor
   - one phone typed four ways
   - `0551234` next to `551234`
   - a donor with a phone but no Amount Pledged
   - a donor with no name
   - a pledge with no phone next to a payment with no phone (the two must not match)
   - a phone made only of punctuation
   - a future-dated payment
   - a payment dated before its pledge
2. **Excel parity test.** A committed fixture (`web/test/fixtures/parity-input.json`) holds about 40 pledges and 80 payments covering every case above. `tools/excel-oracle.ps1`:
   - copies the v3 workbook and injects the fixture into the entry cells over COM;
   - runs `CalculateFullRebuild()`;
   - writes every calculated cell (Pledges E–I, Payments B, Summary B5–B37, and B42–B50 for a set of lookup inputs) to `parity-expected.json`.

   A Vitest test runs the engine over the same input and asserts equality: cents for money, ISO dates for dates, exact strings for text. The expected file is committed, so CI doesn't need Excel. Re-run the script whenever the workbook's formulas change.
3. **Apps Script.** Vitest loads `Code.gs` into a Node `vm` context with in-memory fakes for `SpreadsheetApp`, `UrlFetchApp`, `CacheService`, `LockService`, `PropertiesService` and `Utilities`. That covers token checks, the allowlist, validation, upsert and delete, and conflicts in CI. A shared table of validation cases runs against both the client's `validate.ts` and the server's `Code.gs`, so the two stay in step. The real-Sheet behaviour the fakes can't prove (apostrophe-prefixed text, date parsing) is checked in the manual end-to-end pass.
4. **CI** runs `tsc --noEmit`, `vitest run` and `vite build`. Deploy happens only if all three pass.
5. **End to end, by hand, before first use:** sign in with an allowlisted account and with one that isn't; add, edit and delete in both views; edit the same row in two tabs to trigger the conflict message; check on a phone.

## 7. UI (`web/src/ui/`)

Plain TypeScript and DOM, one module per view plus shared `table.ts`, `dialog.ts` and `toast.ts`. Mobile-first layout.

**Screens**
- **Top bar:** app name, the signed-in email, and sign-out. The tabs are Summary, Pledges, Payments and Find donor. The last view used is remembered in `localStorage`.
- **Summary:** KPI tiles (B5–B8), a goal progress bar (B14) with the goal editable inline, status counts, Unmatched Payments (highlighted when ≠ 0), the Data Health list with links (followed by a neutral note when `load` reports rows with no id, which no health check can see), the method breakdown, and a "Download .xlsx" export.
- **Pledges and Payments:** a totals band, a search box that filters on phone, name and notes, sortable column headers, and an "Add" button.
  - Derived columns are read-only and styled differently.
  - Red rows: duplicate pledges and not-counted payments. Amber cell: a future payment date.
  - On narrow screens the table collapses to cards.
- **Add/edit dialog**
  - Entry fields only.
  - Payment method is a `<select>` from Settings.
  - In the Payments dialog, the donor name (or `⚠` reason) resolves live as the phone is typed.
  - Help text under each field reuses the workbook's header tooltips.
  - Delete lives inside the edit dialog and asks for confirmation.
- **Export:** SheetJS builds a workbook with a Pledges sheet (entries plus derived columns), a Payments sheet and a Summary sheet. It's a treasurer copy, not a backup, and not a round-trip format: it has no row ids and no Allowlist, so the backup is the Sheet's own **File → Make a copy** (`docs/SETUP.md`, Data safety routine). Changed 2026-09-25.

**Validation**, identical on client and server:
- `phone` is required on payments. On pledges it's optional, but a blank phone shows up in health check B23.
- Amounts are blank or numbers ≥ 0 with at most 2 decimals.
- Dates are blank or valid `YYYY-MM-DD`.
- `method` is blank or one of the configured methods.
- Text fields are at most 500 characters.
- Spreadsheet-formula injection: any value starting with `=`, `+`, `-` or `@` is written to the Sheet with a leading `'`. Phones starting with `+` are stored with the `'` prefix and read back without it.

**Errors and state**
- A first-load skeleton.
- Saves are optimistic: the table updates at once, is rolled back on failure, and a toast shows the error.
- `CONFLICT` shows a dialog, "Someone else changed this row since you opened it", with a Reload option. A reload always re-runs `load`.
- `UNAUTHENTICATED` triggers a silent Google re-prompt, then the sign-in screen.
- `FORBIDDEN` shows a screen: "`<email>` isn't on the volunteer list — ask the organiser."
- A network failure or `navigator.onLine === false` shows a banner. The app makes no attempt to work offline.
- A site and `Code.gs` deployed out of step show a banner after any load. The site is built for the `API_VERSION` in its own copy of `Code.gs` and compares it with `load`'s `apiVersion`. A missing or lower server version reads "The tracker's server is out of date. Organiser: redeploy Code.gs as a new version (see setup guide).", a higher one "The tracker was updated. Reload this page to get the latest version." Neither blocks saving, and the server never rejects a request over its version. Added 2026-09-25.

**Wording** follows the workbook's column names and the guide's plain language.

**Visual design** follows `DESIGN.md` (ICG Heritage), agreed 2026-09-23:
- Every token (colours, dark-mode colours, type scale, radii, spacing, shadows) is mirrored as `:root` CSS custom properties in `web/src/styles/tokens.css`. Component CSS refers only to those variables, with no hex values outside the token file.
- Light mode is the default. Dark mode follows `prefers-color-scheme` on first visit, and a nav toggle saves the user's choice in `localStorage`. Print forces the light tokens.
- Fonts: Cormorant Garamond (500) for display headings and Inter for everything else, self-hosted through `@fontsource` so no third-party font requests are made. Amiri isn't loaded, since there's no Arabic text.
- Component mapping:
  - Summary KPIs → `stat-card` (gold `numeric-xl` value, `eyebrow` label).
  - Goal → `progress-track`/`progress-fill`.
  - Tables → 48 px rows, `rule` dividers, no zebra striping, `eyebrow` header, money right-aligned with tabular numerals.
  - Dialogs → `modal` with the forest scrim.
  - Delete → `button-danger` behind a themed confirm dialog. `window.confirm` is never used.
  - Status badges: Paid → `badge-active`, Partial/Pending → `badge-inactive`, Overpaid → `badge-category`.
  - Row flags: red → `danger-tint`, amber → `warning-tint`.
- Charts: Chart.js 4 draws a doughnut for "Collected by Payment Method", coloured from the `chart-*` variables and re-themed when the mode changes. The exact figures stay beside it in a table, because the chart is a visual aid, not the record.
- Deliberate deviations from DESIGN.md's implementation notes: the app keeps its Vite build and npm dependencies, and uses no Tailwind (plain CSS against the tokens). Those notes describe a different, build-free project.

## 8. Repository and deployment

```
/                                    (new git repo — the xlsx/docx stay out of it unless the user says otherwise)
├─ package.json, tsconfig.json, vite.config.ts   (one package; Vite root = web/)
├─ web/            index.html, src/{engine,api,auth,store,main}.ts, src/ui/*, src/styles/*
├─ test/           Vitest suites for engine, client modules, and Code.gs (via vm)
├─ apps-script/    Code.gs, appsscript.json
├─ tools/          excel-oracle.ps1
├─ docs/           this spec, SETUP.md
└─ .github/workflows/pages.yml
```

`SETUP.md` gives the one-time steps:
1. Create the Sheet.
2. Paste in `Code.gs` and run `setup()`.
3. Add emails to Allowlist.
4. Create a Google Cloud OAuth *Web* client ID, with the Pages origin as its only authorized JavaScript origin. Local work uses demo mode; `localhost` origins are added only for a session run against the real Sheet, and removed afterwards (clarified 2026-09-25).
5. Set the Script property `CLIENT_ID`.
6. Deploy as a web app: execute as me, access "Anyone".
7. Set the `VITE_SCRIPT_URL` and `VITE_GOOGLE_CLIENT_ID` repo variables and enable Pages from Actions.

The Vite `base` is set to the repo name. Vite also reads `API_VERSION` from `apps-script/Code.gs`, so every change to `Code.gs` raises it (a test enforces this) and is deployed before the site (§7, Errors and state).

Before uploading the site, the build job checks the two repo variables on every run except a pull request's: `VITE_SCRIPT_URL` must be an Apps Script `/exec` URL (the `/macros/s/…` form or a Workspace account's `/a/macros/<domain>/s/…`), and `VITE_GOOGLE_CLIENT_ID` must end in `.apps.googleusercontent.com` with no whitespace. Otherwise the run fails, naming the variable and the `SETUP.md` step, and the live site is left as it was. Added 2026-09-25.

**Privacy:** the repo, CI logs and the build contain no donor data. Fixtures use `555-01xx` numbers and made-up names. The Sheet stays private to the owner; only the Apps Script, running as the owner, touches it.

**End of a drive:** `SETUP.md` also covers closing a drive: a final copy, cutting the Allowlist down to the organiser (everyone on it can load every donor's phone number for as long as their row stays), archiving the deployment only if the tracker won't be reused (archiving kills the `/exec` URL), and a date for deleting donor phone numbers. The next drive reuses the same Sheet: the Sheet's **Fundraiser tracker → Start a new drive…** menu (`startNewDrive` in `Code.gs`, added by an `onOpen` simple trigger), or the organiser by hand, copies `Pledges`, `Payments` and both history tabs to tabs named with a label, which the app never reads, then clears the originals from row 2 down, never row 1. The script does it under the lock and with `clearContent()`, not `deleteRows`, which Sheets refuses once a tab has grown past its first 1,000 rows. Still one drive at a time (§9). Added 2026-09-25.

## 9. Out of scope

- offline use
- an in-app edit history or undo. (This line first excluded any edit history beyond `updatedAt`/`updatedBy`; since 2026-09-25 the Sheet's history tabs keep each edited or deleted row's old version for the organiser, §3. Goal changes are still not recorded.)
- roles or permissions
- receipts and emails
- multiple campaigns
- importing an xlsx
- editing `paymentMethods` or the allowlist from the app
- pagination (revisit above about 5,000 rows)
- updating the user guide (a separate task once the app exists)

## 10. Open questions

None are blocking. Two noted for review:
- Should the app's source live in this folder (making it a git repo alongside the xlsx and docx) or in a new folder or repo? The default is to make this folder the repo and add `*.xlsx` and `*.docx` to `.gitignore`, so the workbook, which may one day hold donor data, is never pushed.
- Is a GitHub Pages URL acceptable, given that the app shell is public even though the data isn't?
