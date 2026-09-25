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

Deliberate deviation: after stripping, a key that is exactly `1` plus a North American number (`/^1[2-9]\d{9}$/`) drops the `1`, so `+1 336 555 0123` and `336-555-0123` are the same donor. The workbook kept the country code, which let a donor re-entered with `+1` slip past the duplicate-donor check. Area codes never start with 0 or 1, so `10551234567` is unchanged, and a leading `0` still counts.

Deliberate deviation: before stripping, the phone is NFKC-normalized (full-width digits and punctuation become ASCII) and Arabic-Indic and Persian/Urdu digits are read as `0`–`9`, and the stripped set also covers the invisible direction and zero-width marks U+200B–U+200F, U+202A–U+202E, U+2060–U+2064 and U+2066–U+2069. Mac Contacts and right-to-left-aware apps wrap copied numbers in these marks, so without this a pasted number that looks identical to the pledge's matches nothing, and a phone of only marks counts as present. The server's blank-phone check (`PHONE_IGNORED` in `Code.gs`) applies the same NFKC step and marks.

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
- Beyond the workbook: the lookup shows the matched donor's payment history. When the input is not a whole phone number, the lookup lists the candidate rows instead: a name substring (case-insensitive) or phone digits found anywhere in a row's key, the same rule as the list searches. The list shows at most 20 rows with "Showing 20 of N — keep typing to narrow it down.", so a one-letter search at event scale stays instant without a debounce. With no candidates, the app says "No donor found." and offers **Add a pledge**, prefilled with the typed text as the phone only when it is a phone number and nothing else (all digits once `matchKey` strips its formatting; any letter means a name). The exact-key rule above (`findByPhone`) is unchanged, because the parity fixture asserts it.
- The donor card is also a place to fix mistakes: **Edit pledge** and each payment row open the same edit forms as Pledges and Payments, and **Log a payment** opens a new payment with the donor's phone filled in. Once the pledge editor is opened from the card, the card stays on that pledge rather than on the search text, so changing the phone that was searched for does not turn it into "No donor found.".
- The donor card's phone is a `tel:` link, built from the phone's digits and `+` only because the field is free text, and left as plain text when it has no digits.
- A negative balance shows on the card as "Credit $50.00", not as the accounting "($50.00)".
- The donor card prints as a statement for the donor (a narrowing of §9's "receipts and emails" exclusion, for printing only). **Print** calls `window.print()`. The page gains the heading "Islamic Center of Greensboro — pledge statement, printed <date>" and a **Total paid** line, and a print rule scoped to the Find donor view leaves off the search, the pledge and payment notes, the duplicate warning and Amount received. Total paid is the sum of the listed payments, not the donor's `receivedCents`, which is blank for a pledge with no amount. The statement has no tax-acknowledgment wording until the organiser and treasurer ask for it.
- The lookup searches the volunteer's own last load, so a donor another volunteer has just pledged looks missing, and a second pledge for them double-counts (§5.2). When the last load is over 2 minutes old, "No donor found." adds "Your list was last updated N minutes ago. If they pledged with another volunteer since then, press Refresh before adding a pledge." A server-side duplicate-phone warning on create is deferred until duplicates show up in real use.

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
- **Signed out:** Sign out lands on its own page, "You are signed out", instead of asking for sign-in again. The app can't end the volunteer's Google session, so an immediate prompt would offer the next person on a shared computer "Continue as <volunteer>". The page says so, links to Google sign-out labelled for shared computers only (it also signs the browser out of Gmail), and has a "Sign in again" button. "Use a different account" on the not-on-the-list screen still goes straight to Google's account chooser. The Help guide recommends a Guest or private window on shared and projector computers, closed after signing out.
- **Summary:** an "Updated <date, time>" line giving the last load from the Sheet (printed too, while its "tap Refresh" prompt is screen-only), KPI tiles (B5–B8), a goal progress bar (B14) with the goal editable inline, status counts, Unmatched Payments (highlighted when ≠ 0, with a note chosen by sign: above 0, logged money not counted toward any pledge; below 0, money counted twice, usually a donor listed twice; both point to Data Health, since the net can hide one cause behind the other), the Data Health list (every check's count printed as a number, with a "Show" link beside any above 0, followed by a neutral note when `load` reports rows with no id, which no health check can see), the method breakdown, and a "Download .xlsx" export.
- **Pledges and Payments:** a totals band, a search box that filters on phone, name and notes, sortable column headers, and an "Add" button.
  - With no column sorted, the most recently added row comes first (the reverse of Sheet order), so a just-added row is on the first page (an edited row keeps its place). A third tap on a sorted header returns to the default order.
  - Derived columns are read-only and styled differently.
  - Red rows: duplicate pledges and not-counted payments. Amber cell: a future payment date. The tint is never the only sign: a duplicate pledge's phone number is followed by "· Listed more than once", a not-counted payment shows its `⚠` reason in Donor Name, and a future date is followed by "(future)" (not `⚠`, since the payment still counts).
  - On narrow screens the table collapses to cards. The column headers are hidden there, so a "Sort by" list above the table takes over sorting. Each option names its direction ("Amount: largest first"), and "Default order" returns to the default. On wider screens the sorted header shows a ▲ or ▼ arrow.
  - While a filter is on, "Download this list" beside "Showing N of M" saves exactly the rows on screen, filtered and sorted, to a workbook of that list (a plain table) plus an "About this list" sheet: the filter, when it was made, the figures' last load, the row count and the totals. A printout names the filter after "Showing N of M", and a paged list prints how many rows it left out.
- **Add/edit dialog**
  - Entry fields only.
  - Payment method is a `<select>` from Settings.
  - In the Payments dialog, the donor name (or `⚠` reason) resolves live as the phone is typed. For `⚠ phone not in Pledges` on a new payment it also says how to record a donor who hasn't pledged: Cancel, then Pledges → Add pledge → Save and log a payment. An existing payment never says this, as that path would enter its money a second time; adding a plain pledge with that phone makes it count. When the list was loaded over 2 minutes ago, it says first that a donor who pledged with another volunteer will match once the list refreshes, so the payment should be saved and no second pledge added.
  - For `⚠ phone not in Pledges`, new or existing, the Payments dialog also asks about up to 3 pledges whose number is probably the one meant, comparing digits only: first the same number (the same last 10 digits when both have 10 or more, which covers a country code against a trunk 0, or identical digits; a US `+1` is already an exact match, see 5.1), then a number of the same length, 7 digits or more, with one digit different or two neighbouring digits swapped. More than 3 of the latter means the numbers are too close to guess, so none of them is offered. Each is a question naming the donor, "Is this from Aisha Rahman (555-010-0101)?", with a **Use their number** button that fills in that pledge's phone. It is only ever a suggestion, never applied by itself, and the match key and the join are unchanged.
  - On a new payment the donor line also says what the donor still owes ("owes $400.00 of $500.00", "has paid in full" or "has paid $50.00 more than pledged"). An edit shows no balance, as its payment is already in it; a pledge of 0 shows none; a donor listed more than once shows "listed more than once" instead, as their balance is double-counted. An amber note under the amount says when a payment with the same match key, amount and date is already logged — the Possible duplicate payments rule, applied while typing — and to press Cancel (Delete, on an edit) if it is the same payment. Both are advisory: Save stays enabled, since two real installments can match, and the note only knows the payments already loaded on that device.
  - The Add pledge dialog, from Pledges or from Find donor's Add a pledge, has a **Save and log a payment** button, shown once a phone is typed. It saves the pledge as Save does, then opens the Payments dialog with that phone filled in, so a donor who pledges and pays at once is entered with the phone typed once. A Payments dialog opened with the phone filled in (from a pledge, the donor card or this button) starts with the cursor in the amount.
  - The Add pledge and Log a payment dialogs opened from the Pledges and Payments headers have a **Save and add another** button. It saves as Save does, then opens an empty dialog for the next entry that keeps the date (and, for payments, the method) and starts in the phone number. That dialog saves nothing until something is typed in it: Save just closes it and Save and add another does nothing, so a double tap never enters a blank pledge. Nothing carries over otherwise: a plain Add or Log starts on today with no method, so a forgotten method still shows under "No method recorded" rather than a remembered one that looks right.
  - The Edit pledge dialog warns when a new phone number would leave payments behind. Payments keep the number they were logged with, so once the typed number differs from the old one (ignoring formatting) it says how many payments were logged under the old number and that, after saving, each needs changing to the new number on Payments. It stays quiet while another pledge keeps the old number, since those payments stay matched to it. It never moves the payments itself.
  - In the edit-pledge dialog, **Call** (`tel:`) and **Text** (`sms:`) links under the phone field reach the number as typed, built from its digits and `+` only and hidden while it has none. The list rows get no such link, because each row is a button that opens this dialog, and neither does Add pledge: that donor is usually present, and the links would sit in the Tab path from Phone to Name.
  - Help text under each field reuses the workbook's header tooltips.
  - Delete lives inside the edit dialog and asks for confirmation.
- **Export:** "Download .xlsx" first reloads from the Sheet (through the same load as Refresh), so a tab left open all evening still exports every volunteer's entries; if that reload fails, no file is made. SheetJS then builds a workbook that opens on a Summary sheet, followed by a Pledges sheet (entries plus derived columns) and a Payments sheet, each list ending with "Last changed by" and "Last changed at" (`updatedBy`, and `updatedAt` in the downloading device's local time). It's a treasurer copy, not a backup, and not a round-trip format: it has no row ids and no Allowlist, so the backup is the Sheet's own **File → Make a copy** (`docs/SETUP.md`, Data safety routine). Changed 2026-09-25. It's laid out to be read in Excel as it opens: columns sized to their contents (capped at about 40 characters), money in the app's accounting style ($1,650.30, a credit as ($50.00)), and a header filter on Pledges and Payments. The Summary sheet's first row, "Figures as of", gives the date and time the figures were loaded from the Sheet — that reload, finishing just after the click — and the file is named for that minute (`ICG-Fundraiser-2026-09-24-1401.xlsx`), so two copies from one day are told apart. There are no print titles (a malformed `_xlnm.Print_Titles` name makes Excel offer to repair the file) and no frozen header row (SheetJS CE can't write one).

**Validation**, identical on client and server:
- `phone` is required on payments. On pledges it's optional, but a blank phone shows up in health check B23.
- Amounts are numbers ≥ 0 with at most 2 decimals. A pledge's amount may be blank; a payment's may not (0 is allowed), because a payment with no amount still counts toward # Payments and moves Last Payment, which drops a donor who paid nothing off Needs follow-up. Health check B24 still catches blank amounts on rows typed into the Sheet or saved before this rule.
- Dates are blank or valid `YYYY-MM-DD`.
- `method` is blank or one of the configured methods.
- Text fields are at most 500 characters.
- Spreadsheet-formula injection: any value starting with `=`, `+`, `-` or `@` is written to the Sheet with a leading `'`. Phones starting with `+` are stored with the `'` prefix and read back without it.

**Errors and state**
- A first-load skeleton. After 5 s its line changes to "Still loading — the shared sheet can take up to 20 seconds. Please keep this page open.", so a slow first load isn't mistaken for a hang and reloaded.
- Saves are optimistic: the table updates at once, is rolled back on failure, and a toast shows the error.
- While a save, delete or goal change is still in flight, Sign out asks "A change is still saving. Signing out now could lose it. Sign out anyway?", and closing or reloading the tab triggers the browser's own leave-page question, because a page that has gone can't show the failure. The same holds while a failed save's Reopen toast is showing, or waiting behind an open form to show, since it holds the only copy of what was typed: Sign out asks "A change could not be saved. Signing out now loses it. Sign out anyway?", and closing the tab asks too. Phones mostly don't ask (iOS ignores the leave-page question), so the Help guide tells volunteers there to wait until "Saving…" clears.
- `CONFLICT` shows a dialog, "Someone else changed this row since you opened it", with a Reload option. A reload always re-runs `load`.
- `UNAUTHENTICATED` triggers a silent Google re-prompt, then the sign-in screen.
- The Google ID token is kept in the tab's `sessionStorage` while it is fresh, so reloading the same tab within the token's hour loads without the sign-in dialog. A kept token issued for another client ID is ignored, so reloading after the site's client ID is corrected signs in afresh. A new tab signs in again, and Sign out removes the kept token before it leaves the page. "Could not load the tracker" offers Try again, which reloads the page, so a site rebuilt with a corrected script address or client ID is the one that tries; the kept token makes that reload cost no sign-in. Pull-to-refresh is turned off (`overscroll-behavior-y: contain`); the Refresh button reloads the data.
- `FORBIDDEN` shows a screen: "`<email>` isn't on the volunteer list — ask the organiser." At startup it offers Use a different account. A `FORBIDDEN` from Refresh, the auto-refresh on return or the refresh that "Download .xlsx" starts with (someone taken off the Allowlist while their page was open) closes any open form and replaces the page with the same screen, offering Try again, which reloads the page. A `FORBIDDEN` on a save stays an error toast with Reopen, and the Friday display keeps its figures, so a mistaken Allowlist edit neither discards unsaved entries nor reaches the projector.
- A network failure or `navigator.onLine === false` shows a banner. The app makes no attempt to work offline.
- A site and `Code.gs` deployed out of step show a banner after any load. The site is built for the `API_VERSION` in its own copy of `Code.gs` and compares it with `load`'s `apiVersion`. A missing or lower server version reads "The tracker's server is out of date. Organiser: redeploy Code.gs as a new version (see setup guide).", a higher one "The tracker was updated. Reload this page to get the latest version." Neither blocks saving, and the server never rejects a request over its version. Added 2026-09-25.

**Wording** follows the workbook's column names and the guide's plain language.

**Visual design** follows `DESIGN.md` (ICG Heritage), agreed 2026-09-23:
- Every token (colours, dark-mode colours, type scale, radii, spacing, shadows) is mirrored as `:root` CSS custom properties in `web/src/styles/tokens.css`. Component CSS refers only to those variables, with no hex values outside the token file.
- Light mode is the default. Dark mode follows `prefers-color-scheme` on first visit, and a nav toggle saves the user's choice in `localStorage`. Print forces the light tokens.
- Fonts: Cormorant Garamond (500) for display headings and Inter for everything else, self-hosted through `@fontsource` so no third-party font requests are made. Amiri isn't loaded, since the app's own wording has no Arabic. Donor names and notes may still be typed in Arabic script; they show in the device's own Arabic font.
- Text direction: every text box (donor name, amounts, goal), notes box and search box carries `dir="auto"`, so text that starts in Arabic script runs right-to-left and anything else stays left-to-right. Phone, date and choice fields are left alone. Find donor's match list gives each phone `dir="ltr"`, because a phone placed right after an Arabic-script name would otherwise show its digit groups in reverse order.
- Component mapping:
  - Summary KPIs → `stat-card` (gold `numeric-xl` value, `eyebrow` label).
  - Goal → `progress-track`/`progress-fill`.
  - Tables → 48 px rows, `rule` dividers, no zebra striping, `eyebrow` header, money right-aligned with tabular numerals.
  - Dialogs → `modal` with the forest scrim.
  - Delete → `button-danger` behind a themed confirm dialog. `window.confirm` is never used.
  - Status badges: Paid → `badge-active`, Partial/Pending → `badge-inactive`, Overpaid → `badge-category`.
  - Row flags: red → `danger-tint`, amber → `warning-tint`.
- Charts: "Collected by Payment Method" is a ring drawn in CSS (a `conic-gradient` with a masked hole), with no chart library. Its slices name the `chart-*` variables, so it follows the theme without a redraw. Each listed method takes the colour of its place in the Settings list, so its colour holds while an earlier method has no money; "No method recorded" and "Other / unlisted" each have their own neutral colour. The exact figures stay beside it in a table, because the chart is a visual aid, not the record, so the ring has no hover tooltip. (This replaced a Chart.js doughnut, which was most of the app's download for one small chart and redrew with an animation on every save.)
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

**Privacy:** the repo, CI logs and the build contain no donor data. Fixtures use `555-01xx` numbers and made-up names. The Sheet stays private to the owner; only the Apps Script, running as the owner, touches it. The .xlsx export holds every donor's name, phone number and amounts, so it is titled "ICG Fundraiser (confidential)" and the docs say to keep it private: on the organiser's own computer or in a folder only they and the second editor can open, never a shared drive, email or group chat.

**End of a drive:** `SETUP.md` also covers closing a drive: a final copy, cutting the Allowlist down to the organiser (everyone on it can load every donor's phone number for as long as their row stays), archiving the deployment only if the tracker won't be reused (archiving kills the `/exec` URL), and a date for deleting donor phone numbers. The next drive reuses the same Sheet: the Sheet's **Fundraiser tracker → Start a new drive…** menu (`startNewDrive` in `Code.gs`, added by an `onOpen` simple trigger), or the organiser by hand, copies `Pledges`, `Payments` and both history tabs to tabs named with a label, which the app never reads, then clears the originals from row 2 down, never row 1. The script does it under the lock and with `clearContent()`, not `deleteRows`, which Sheets refuses once a tab has grown past its first 1,000 rows. Still one drive at a time (§9). Added 2026-09-25.

## 9. Out of scope

- offline use
- an in-app edit history or undo. (This line first excluded any edit history beyond `updatedAt`/`updatedBy`; since 2026-09-25 the Sheet's history tabs keep each edited or deleted row's old version for the organiser, §3. Goal changes are still not recorded.)
- roles or permissions
- receipts and emails, apart from the printable donor statement on the Find donor card (§5.7), which carries no tax-acknowledgment wording
- multiple campaigns
- importing an xlsx
- editing `paymentMethods` or the allowlist from the app
- pagination (revisit above about 5,000 rows)
- updating the user guide (a separate task once the app exists)

## 10. Open questions

None are blocking. Two noted for review:
- Should the app's source live in this folder (making it a git repo alongside the xlsx and docx) or in a new folder or repo? The default is to make this folder the repo and add `*.xlsx` and `*.docx` to `.gitignore`, so the workbook, which may one day hold donor data, is never pushed.
- Is a GitHub Pages URL acceptable, given that the app shell is public even though the data isn't?
