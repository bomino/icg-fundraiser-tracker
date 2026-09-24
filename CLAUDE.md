# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Two hand-maintained Office artifacts, plus a web app that reimplements them, all shipping to masjid fundraiser volunteers:

- `Masjid_Fundraiser_Tracker_v3.xlsx` — the original tracker (the "application")
- `Fundraiser_Tracker_User_Guide.docx` — the end-user manual for that tracker
- `Masjid_Fundraiser_Tracker_v3.BACKUP-before-trim.xlsx` — restore point from before the 2026-09-15 rework
- `web/` (Vite + TypeScript) and `apps-script/Code.gs` — a second implementation of the workbook, backed by a private Google Sheet instead of a local file; see "The web app" below

There is no build and no generator script checked in for the workbook, so it **is** the source of truth for its own behaviour. Edit it in place, via its OOXML parts. The web app is ordinary source under `web/` and `apps-script/`, with its own build and test suite (`npm run check`).

The workbook ships with zero data rows — a blank template with formulas pre-filled down every row. That is what makes wholesale row regeneration safe; assert it before doing so.

## Inspecting and editing the artifacts

`openpyxl` 3.1.5 and `python-docx` are installed, and **Excel and Word are both driveable over COM** — the only way to actually evaluate the formulas. For reading structure, go straight to the OOXML parts:

```bash
PYTHONIOENCODING=utf-8 python -c "
import zipfile; z=zipfile.ZipFile('Masjid_Fundraiser_Tracker_v3.xlsx')
print(z.read('xl/tables/table1.xml').decode())"      # PledgeLog column + formula contract
# sheet1=Pledges, sheet2=Payments, sheet3=Summary; xl/comments1.xml + comments2.xml = header tooltips
```

`PYTHONIOENCODING=utf-8` is required on this machine — the workbook contains `⚠`, and cp1252 stdout will crash the dump. The docx skill's `pack.py` additionally needs `PYTHONUTF8=1`, or its validator fails reading `numbering.xml`. In PowerShell COM scripts remember variable names are case-insensitive: a `$S` folder path and a `$s` Summary sheet are the same variable.

**Verify structural changes by driving Excel**, not by reasoning about the XML: copy the file, open it with `New-Object -ComObject Excel.Application` (`Visible=$false`, `DisplayAlerts=$false`), `Unprotect()` the sheets, write sample donors and payments, `CalculateFullRebuild()`, then read values back. That is the only check that catches a formula that parses but computes the wrong thing. Note that `DisplayAlerts=$false` also hides a *repair* prompt, so separately confirm Excel kept the structure — re-open, check `ListObjects` ranges and `FormatConditions.Count`, and `Save()` to see which parts survive.

### Do not round-trip the workbook through openpyxl

`load_workbook(...)` then `save(...)` silently drops the x14 conditional-formatting extension — the shipped file keeps both Payments rules there (the red `⚠` row and the amber future date). It also discards the taskpane webextension. Use openpyxl for reading and verification only; write by editing the XML parts and rewriting the zip.

## Architecture

Three sheets. Pledges is the donor dimension, Payments is the transaction fact table, Summary is the read-only dashboard. They join on a **normalized match key**, not on the raw phone number.

```
Payments (PaymentLog, A4:G2000)        Pledges (PledgeLog, A4:K2000)          Summary
  A Phone (entry)                        A Phone (entry, donor ID)             B4  Goal (entry)
  B Donor Name  ← INDEX/MATCH or ⚠ ────► B Donor Name                          B5  SUM(Pledges D)
  C Date Received (entry)                C Date Pledged (entry)                B6  SUM(Pledges F)
  D Amount Received (entry) ── SUMIF ──► D Amount Pledged (entry)              B7  SUMIF(G,">0")
  E Payment Method (dropdown)            E Last Payment Date ← MAXIFS          B8  ABS(SUMIF(G,"<0"))
  F Notes (entry)                        F Amount Received  ← SUMIF            B9 donors; B10:B13 by Status
  G Match Key  ← hidden, normalized      G Balance Due = D-F                   B15 SUM(Payments D)
        └──────── joins on ─────────────► H # Payments      ← COUNTIF          B16 B15-B6 = unmatched $
                                          I Status                             B21:B26 data-health counts
                                          J Notes (entry)                      B30:B37 by payment method
                                          K Match Key ← hidden, normalized     B41 lookup key (entry)
                                                                               D41 hidden normalized key
                                                                               B42:B50 INDEX/MATCH fields
```

### The match key

Both tabs carry a hidden helper column holding
`IF(A5="","","#"&TRIM(SUBSTITUTE(…six times…)))` — stripping `-`, `(`, `)`, `.`, `+` and spaces. Every cross-sheet join uses it, so `555-010-0110`, `(555) 010 0110` and `5550100110` are the same donor. Two details are deliberate:

- **The `"#"` prefix is required.** Without it a key like `0551234` is coerced to a number by `COUNTIF`/`SUMIF` criteria and collides with `551234`. Keep any new key formula text-prefixed.
- **E, F and H guard on `$K{row}=""`, not just on the pledge amount.** A pledge row with no phone has an empty key, and `SUMIF(range,"")` would otherwise match every payment that also lacks a phone.

The key columns are hidden and locked; the tables own them, so new rows get the formula automatically.

### Invariants that will silently break things

**Formulas use plain A1 ranges, never structured table references,** and no `LET`, `LAMBDA` or dynamic arrays. The file must keep working after upload to Google Sheets, which the guide instructs volunteers to do. `_xlfn.MAXIFS` is the one modern function used (fine in Excel 2019+/365 and Sheets).

**Google Sheets computes the same values as Excel (verified 2026-09-16).** A sample-data copy uploaded to Drive and opened in Sheets' Office-compatibility mode matched Excel on all 333 compared cells, including Summary `B22` (range-as-criteria `COUNTIF` inside `SUMPRODUCT`) and the `_xlfn.MAXIFS` column. Not yet verified there: conditional-format colours, protection, dropdowns, tooltips, and a fully converted Google Sheet (the guide's Import → Replace route). To re-test without a browser, share the file by link and pull values with `gviz/tq?tqx=out:csv&sheet=<tab>&range=<A1>&headers=0` — that endpoint type-infers each column and silently blanks text in numeric/date columns and skips empty rows, so match rows by key and fetch blanked cells one at a time; `export?format=csv` returns 400 for unconverted .xlsx files.

**Two deliberate extents: tables end at 2000, scans end at 2500.** Tables, autofilters and data validation stop at row 2000 (1,996 data rows); every cross-sheet formula and conditional-formatting rule scans `$5:$2500`. Never let the two meet — flush extents mean a row added past the table looks live but is excluded from every Summary total. Sizing rationale: the owner puts a realistic pledge count at ~1500, and the lookups are O(n²), which matters most in Google Sheets. Growing the sheet means bumping table refs and validation `sqref` **and** every SUMIF/COUNTIF/MAXIFS/MATCH range in one pass, preserving the gap.

**Status has four values**: blank-or-zero → `Pending`; `ROUND(F-D,2)>0` → `Overpaid`; `=0` → `Paid`; else `Partial`. The rounding is deliberate — exact float equality would leave cent-level residues stuck on `Partial` (verified: 0.1 + 0.2 against a 0.30 pledge reads `Paid`). Summary `B10:B13` are `COUNTIF`s over those four literal strings, so rewording a status breaks the counts.

**Two guards exist because of edge cases found in testing, not theory.** Column E counts matching payments with `COUNTIFS(…, Payments!$C$5:$C$2500,"<>")` — requiring a *dated* payment — because `MAXIFS` over payments that all lack a date returns 0, which renders as `1900-01-00`. Column G wraps its subtraction in `ROUND(…,2)` so float dust neither displays as `($0.00)` nor leaks into the Summary's `SUMIF(G,">0")` outstanding figure. Do not simplify either back.

**Payments `B` is the single source of "this payment is not counted".** It shows `⚠ phone not in Pledges` (no key match) or `⚠ no amount on Pledges` (matched donor has blank `D`, so Pledges `F` ignores the payment), a blank for a nameless donor (never `0`), otherwise the name. Both the red row rule (`LEFT($B5,1)="⚠"`) and Summary `B21` (`COUNTIF(…,"⚠*")`) key off that leading `⚠` — any new warning must start with it, and a name never may. Excel moves that red rule out of the x14 extension on save, since it no longer references another sheet; that is expected.

**Outstanding excludes credits.** `B7` is `SUMIF(G,">0")`, not `B5-B6`, so an overpaying donor's negative balance cannot mask another donor's real debt; the credit is reported separately in `B8`. The Pledges row-3 totals band applies the same rule to column G. Keep the two consistent.

**Summary row numbers are referenced from three places** — the `B16<>0` conditional format, the `MATCH($D$41,…)` lookup block, and `SUM(B30:B36)` reconciling the method breakdown. Inserting a row on Summary means re-checking all three.

**Sheets are protected, entry formats carry `locked="0"`.** Protection is on all three sheets with no password; sorting, filtering, formatting and row insert/delete stay permitted. What makes a cell editable is its *style*: `cellXfs` indices 3, 9, 11, 12, 13, 22, 23, 28, 29, 30, 31, 32 are the unlocked entry formats. A new entry cell must reuse one of those, or it ships locked. Consequence to remember: while protected, rows past 2000 cannot be typed into at all, so the 500-row buffer is inert until someone unprotects.

**`fullCalcOnLoad="1"` is set** in `workbook.xml`. New or edited formula cells therefore need no cached `<v>`; Excel recalculates everything on open. Do not remove it without re-populating cached values.

**Header row is row 4, data starts at row 5**, both data tabs, `ySplit="4"` frozen panes. Pledges row 3 holds a totals band above the header.

**Header cells carry the inline documentation.** `xl/comments1.xml` / `comments2.xml` hold a tooltip per column, and they are a third place the behaviour is documented — alongside the guide and this file. They were refreshed on 2026-09-15 for the four statuses and phone normalization, and on 2026-09-16 for the `⚠ no amount on Pledges` warning (Payments A4/B4, Pledges D4); changing any of those means editing the tooltip too. Box size comes from the `<x:Anchor>` in `xl/drawings/vmlDrawing*.vml` (7th value = bottom row) — grow it when a tooltip gets longer, or the text is cut off. The comment body is the *last* `<t xml:space="preserve">` run in the `<comment>` element (the first run is the author name). *(The two Match Key columns have no tooltip — they are hidden, so that is intentional.)*

**Table column names must equal the header cell text exactly,** or Excel repairs the file on open. When widening a table, add the `<tableColumn>`, bump `count`, extend `ref` and `autoFilter`, and write the matching header cell.

**Deleting rows invalidates `xl/calcChain.xml`.** Drop the part, its workbook relationship, *and* its `[Content_Types].xml` Override (the MIME type contains slashes, so match on `[^>]*`). A dangling Override triggers the repair prompt; Excel rebuilds the chain on next save.

### Known behaviour that looks like a bug but is not

**Duplicate donor rows double-count.** A donor entered on two Pledges rows has their payments counted once per row — both rows show the full received amount, inflating `Total Received` and usually producing a phantom `Overpaid` credit. Inherent to the one-row-per-donor design, and flagged by red fill on both rows and the `Donors listed more than once` health count; it also drives `Unmatched Payments` (`B16`) negative and can produce a credit in `B8`.

**`% of Goal Received` (`B14`) divides `B6` by the goal — money matched to pledges, not `B15` (everything logged).** A payment whose phone matches no donor, or whose donor has a blank Amount Pledged, therefore does not count toward the goal. That is the defensible reading (only attributable money counts) and is moot whenever `Unmatched Payments` is 0, but it is a judgment call, not a self-evident truth. Revisit it if unmatched payments ever become normal rather than exceptional.

**`Donors whose payments predate their pledge` (`B26`) only compares each donor's *latest* payment date.** One mis-dated payment among several will not be caught. Exact per-payment coverage needs a lookup per row, which costs too much at this sheet size. The future-date check (`B25`) is exact.

### Verification expectations

Structural checks on the XML are necessary but have repeatedly proven insufficient — the 2026-09-15 review found two formula bugs (a `1900-01-00` date from `MAXIFS` over undated payments; float dust surfacing as `($0.00)`) that every structural check passed. Before claiming a change works:

1. Drive Excel over COM with sample data covering the *awkward* cases, not just the happy path: a payment with an amount but no date, cent-level float sums, an overpayment, a duplicate donor, a phone typed four different ways, a leading-zero phone next to the same digits without it, a donor with a phone but no Amount Pledged, and a donor with no name.
2. Re-audit the guide and the header tooltips against the workbook — they are two more copies of the same facts and go stale silently.
3. Confirm new Summary labels fit column A (width 44) when a value sits in column B, or they render clipped.
4. For formula changes, re-run the Google Sheets value comparison described above; the sample-data generator used on 2026-09-16 injected entry values straight into the sheet XML (replacing `<c r="A5" s="28"/>` with an `inlineStr` or `<v>` cell) so the test copy is byte-identical to the shipped file apart from the data.

## The web app

`web/` (Vite + TypeScript) plus `apps-script/Code.gs` is a second implementation of the workbook: it has the same rules, but its data lives in a private Google Sheet. Spec: `docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md`. Setup guide: `docs/SETUP.md`.

- **The workbook stays the source of truth.** `web/src/engine/` must reproduce it cell for cell. `tools/excel-oracle.ps1` pushes `test/fixtures/parity-input.json` through the real workbook in Excel and writes `parity-expected.json`, and `test/engine/parity.test.ts` asserts the engine matches. **Any workbook formula change means re-running the oracle and fixing the engine in the same pass.** Never hand-edit the expected file.
- **Validation lives in two places.** It's in `web/src/validate.ts` and in `validateRow_` in `Code.gs`, and `test/support/validationCases.ts` runs against both. Change them together.
- **Code.gs is tested in Node** (`test/support/appsScript.ts` fakes the Apps Script services). After editing it, paste it into the Apps Script editor and deploy a **new version** of the existing deployment, so the URL doesn't change.
- **The client names new rows.** A create is an upsert with a `crypto.randomUUID()` id and *no* `updatedAt`; `upsert_` requires a UUID there and, if that id already exists with the same entry values, returns the row unchanged, so a Save retried after a lost response cannot add a duplicate; differing values answer `CONFLICT` with the saved row as `current`. Each opened form keeps one id across retries. An update carries `updatedAt` and is version-checked as before. This changed the wire contract: an older `Code.gs` deployment treats the id as an update and answers `NOT_FOUND`, so deploy the new version together with the site (see Troubleshooting in `docs/SETUP.md`).
- **Text written to the Sheet is apostrophe-prefixed** (`toSheetRow_`) — the only text-forcing mechanism. This keeps leading zeros and `+`, and stops formula injection. Don't remove it, and don't also format the Pledges/Payments data columns as **Plain text** in the Sheet UI: a Plain text cell stores the apostrophe literally instead of hiding it, which corrupts ids, phone numbers and dates.
- **Hand-typed dates are read in the spreadsheet's own time zone** (`fromCell_` uses `getSpreadsheetTimeZone()`). Non-ISO text typed directly into a date column loads as blank in the app rather than as an unparseable string.
- **A missing `CLIENT_ID` script property is reported as `INTERNAL` "The server is not configured…"**, not as an expired sign-in (`clientId_()` in `Code.gs`). A failed `fetch` on an online device adds a hint about the deployment's "Anyone" access, because that misconfiguration looks like a network error to the browser.
- **The server rejects a token cheaply before calling Google.** `assertPlausibleToken_` checks the token is a well-formed 3-part JWT with the right `aud` before `verifyToken_` spends a network call on `tokeninfo`; `tokeninfo` remains the actual authority.
- **Sign-in is its own modal `<dialog>`** (`web/src/auth.ts`). A form dialog makes the rest of the page inert, so a sign-in requested mid-save must open *after* it in the top layer. Dismissing it rejects every waiting `getToken` with `UNAUTHENTICATED` "Sign-in was cancelled." (the API does not retry that), and `refreshIfStale()` renews a token within 5 minutes of expiry on any click in `main` and when the tab becomes visible.
- **Other volunteers' changes arrive only on a reload.** The nav's **Refresh** button calls `store.load()`; returning to the tab reloads automatically when the last load (`store.lastLoadedAt()`) is over 2 minutes old, but never while any `<dialog open>` exists. List searches keep their text, focus and caret across store re-renders via `data-focus-key`.
- **A dev-only demo mode** exists for visual checks without Google sign-in or a deployed backend: `npm run dev`, then open `http://localhost:5173/?demo` (`web/src/demo.ts`, dynamically imported so it is excluded from production builds).
- **Styling** comes only from `web/src/styles/tokens.css` (from `DESIGN.md`). No other file contains colour literals.
- `npm run check` is the gate: typecheck, all tests and the build.

## Conventions

- Version bumps go in the filename (`_v3`), not inside the workbook.
- Keep volunteer-facing wording plain — the guide's audience has no spreadsheet experience.
- The guide and the workbook are in sync as of 2026-09-16. Changing a column name, status value, warning string or Summary section means updating `Fundraiser_Tracker_User_Guide.docx` in the same pass. The guide covers the workbook only; the web app is documented in `docs/SETUP.md`.
- The guide's template defines no named styles; apply `w:pStyle` values (`Heading1`, `Heading2`, `ListParagraph`) directly — python-docx cannot resolve them by name. Bullets are `numId` 2; numbered step lists use `numId` 3, 4 and 5.
