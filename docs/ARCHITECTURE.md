# Architecture

The maintainer's detailed reference: how each part of the ICG Fundraiser Tracker works and why, organised by subsystem. `CLAUDE.md` states the rules in short form and points into this file.

`web/` (Vite + TypeScript) is the client, served from GitHub Pages. `apps-script/Code.gs` is the backend, a Google Apps Script web app over a private Google Sheet that only allowlisted Google accounts can reach. Setup is in `docs/SETUP.md`, the design spec in `docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md`, the visual system in `DESIGN.md`.

## Engine

### Tables, money and blanks

`web/src/engine/` is a pure module (no DOM, no network). Money is handled internally in integer cents. "Blank" means the field is empty; it is not zero, and the two are tracked separately throughout.

There are three logical tables: Pledges (donor dimension), Payments (transaction fact) and Summary (derived, read-only totals). They join on a normalized match key, not the raw phone number.

The engine's business rules were originally modelled on a volunteer-maintained Excel spreadsheet; that spreadsheet is a separate project and not part of this repo. The rules are this app's own, checked by this repo's tests rather than against any external file: the frozen fixture (`test/fixtures/`, see "The parity fixture" below) covers the core engine rules end to end, while the match key's Unicode, invisible-mark, Arabic-digit and `+1` handling and Possible duplicate payments are pinned only by unit tests (`test/foundation.test.ts`, `test/engine/summary.test.ts`).

### The match key

`web/src/matchKey.ts` applies NFKC (full-width digits and punctuation become ASCII), reads Arabic-Indic and Persian/Urdu digits as `0`–`9`, strips `-`, `(`, `)`, `.`, `+`, any whitespace (tabs and non-breaking spaces included), Unicode dashes (`‐`–`―`, `−`) and invisible direction and zero-width marks (U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+2066–U+2069), drops a US `+1` country code, lower-cases, and prefixes the result with `#`. Five details are deliberate.

**The `#` prefix is required.** Without it, a key like `0551234` could be coerced to a number and collide with `551234`. Keep any new key logic text-prefixed.

**A blank phone gets a blank key, and every join must guard on that**, not just match on `""`. Otherwise a pledge with no phone would match every payment that also lacks one.

**A phone with nothing left after stripping (`--`, `()`, `" "`) is blank too**, never a bare `#`, or every such placeholder would join every other one. Anything deciding "has a phone" must test `matchKey(phone) === ''`, not the raw text. These all do: the missing-phone health check, the Payments blank-phone validation (and its copy, `isBlankPhone_` in `Code.gs`, which also decides whether a row with no id looks like an entry), and the "Log a payment" and "Save and log a payment" buttons.

**A US number keys the same with or without its `+1`.** When what's left is exactly `1` plus a North American number (`/^1[2-9]\d{9}$/`), the `1` is dropped, so `+1 336 555 0123`, `1-336-555-0123` and `(336) 555-0123` are one donor. Phones and contact cards add the `+1` on their own, and a donor re-entered that way would otherwise dodge the duplicate hint and "Donors listed more than once". Area codes never start with 0 or 1, so `10551234567` keeps its `1`; every other digit counts, so `0551234` and `551234` stay different. `Code.gs` copies it into `phoneKey_`, so Add selected rows refuses a second pledge for a donor written the other way (see "Rows with no id"). A partial search typed from the front with the `1` (`1 336 555`) keeps it, since it isn't a whole number, so `matchesQuery` (`web/src/ui/search.ts`) also tries the key with the `1` put back (`keyWithUsCountryCode`), which the list searches and Find donor both use.

**A copied number's invisible marks are ignored.** Mac Contacts wraps a copied number in U+202D…U+202C, and right-to-left-aware apps add the same kind of direction marks. Kept in the key, a number that looks identical on screen would match nothing, and a phone of only marks would pass the blank-phone check. The marks are explicit ranges, not `\p{Cf}`, so the character class copies unchanged into `PHONE_IGNORED`, which `Code.gs` applies after the same NFKC step. `Code.gs`'s blank test needs no Arabic-digit mapping, since a digit is never blank, but `phoneKey_` copies it (as `EASTERN_DIGITS`) so Add selected rows joins phones exactly as the app does. The saved phone keeps whatever was typed; only the key ignores the marks.

### Statuses

There are four literal values, set only when Amount Pledged is filled in (a blank amount has no status). Nothing received (no phone, no matching payments, or payments that come to 0 cents) gives `Pending`, whatever was pledged. Otherwise the comparison is done in integer cents: each amount is rounded to cents on its own by `toCents` (`web/src/money.ts`, `Math.round(amount * 100)`) and the cents are summed. Then received > pledged gives `Overpaid`, equal gives `Paid`, else `Partial` (`statusFor` in `web/src/engine/derive.ts`). So a `0` pledge reads `Pending` until money arrives, then `Overpaid`.

Working in cents is deliberate: exact float comparison would misclassify cent-level residues. For example, 0.1 + 0.2 against a 0.30 pledge leaves 5.6e-17 and would read `Overpaid` instead of `Paid`.

Summary's status counts are `count`s over those four literal strings, so renaming a status breaks the counts.

### The ⚠ warnings

Every "this payment is not counted" signal keys off a leading `⚠` (`WARNING_MARK` in `web/src/engine/constants.ts`). Any new warning must start with it, and a donor name never may (`validate.ts` and `Code.gs` reject such names). The two warnings:

- `⚠ phone not in Pledges`: no match-key match. This includes a blank phone (only possible for a row typed straight into the Sheet, since both validators refuse it), so such a payment shows red, counts under "Payments not matched to a pledge" and exports as not counted instead of vanishing from every check.
- `⚠ no amount on Pledges`: the matched donor has a blank Amount Pledged, so the payment doesn't count toward that donor's Amount Received.

"Matched donor" means the first Pledges row in Sheet order with that match key (`createDonorResolver` in `derive.ts`), but every row with an amount sums all of the key's payments (`derivePledges`). So when a donor is listed twice and the first row has no amount but a later row does, the payment reads `⚠ no amount on Pledges` (red, under "Payments not matched to a pledge", exported as Counted = No) yet still counts toward the later row's Amount Received and Total received, so it is left out of Unmatched. This is the one case where the ⚠ does not mean the payment is left out of the totals; the "Donors listed more than once" check flags it.

A blank (never `0`) is shown for a matched-but-nameless donor.

### Outstanding, credits and duplicate donors

The outstanding total sums only positive per-donor balances, not `pledged - received` overall, so one donor's overpayment credit can never mask another donor's real debt; the credit is reported as a separate figure.

A donor entered on two Pledges rows has their payments counted once per row: both rows show the full received amount, inflating totals and usually producing a phantom `Overpaid` credit. This is inherent to the one-row-per-donor model, not a bug. The double-counting also pulls the unmatched-payments figure down, usually below zero (Total received exceeds Payments logged). The "Donors listed more than once" health check flags it.

### When a phone number isn't one donor

The phone number is the donor's ID, so the guidance for the cases where it isn't lives in wording, not code.

- A donor who won't give a number gets a made-up one such as `000-0001` (then `000-0002`…), used on every payment and noted in Notes (Help's How-to topic and the "Pledges missing a phone number" fix). This relies on the phone being checked for length only, so don't add a format check that rejects it.
- Two people sharing a household phone either keep one pledge with each share in Notes or use their own numbers (the pledge form's duplicate hint).
- A raised pledge keeps its original Date Pledged, or it trips "Donors whose payments predate their pledge" (Help's Edit topic and that check's fix).

Money with no donor at all (collection-box cash, a walk-in gift from someone who hasn't pledged) goes on one `General donations` pledge with the placeholder phone `000-000-0000`, Amount Pledged `0` and a blank Date Pledged (Help's "Record money with no phone number" How-to, pointed at from the `⚠ phone not in Pledges` entry, the Overpaid / credit definition and the overpaid-donor How-to). It counts toward Total received, the goal and the Friday display and keeps Unmatched at $0. Under the ordinary rules, though:

- it reads `Overpaid` and adds all its money to the credit figure;
- equal same-day gifts trip "Possible duplicate payments" and the payment form's already-logged note;
- the blank date keeps it out of the predates-pledge check, but until its first gift it reads `Pending`, so it joins Needs follow-up once `FOLLOW_UP_AFTER_DAYS` pass after it was saved (the save counts as activity), and Help says to add it only with a gift to log.

Its amount must stay `0`: raising it to match would add it to Total pledged and the pledged-donor count shown on the Friday display. Help says all of this, and `test/ui/help.test.ts` pins those effects so a rule change can't make the How-to wrong silently.

A reserved general-gift key that avoids the side effects (its own total, skipped by the duplicate check, a payment-form checkbox) is deliberately not built until the organiser confirms box money belongs in this app; existing `General donations` payments would then have to move to it, or they'd count twice.

### Health checks

`computeHealth` in `web/src/engine/summary.ts` returns seven checks. Six are original and covered by the parity fixture; the seventh is app-only (v1.1) and excluded from it.

1. Payments not matched to a pledge.
2. Donors listed more than once.
3. Pledges missing a phone number: only pledges with an Amount Pledged above 0 (a blank or $0 pledge with no phone is not flagged). "No phone" means `matchKey(phone) === ''`.
4. Payments missing a date or amount: only payments that have a phone. A phoneless one is already under #1. Both validators refuse a blank payment amount, so this now catches only a blank date, or a blank amount on a row typed into the Sheet or saved before that rule.
5. Payments dated in the future. This check is exact.
6. Donors whose payments predate their pledge. It compares only each donor's *latest* payment date, so one mis-dated payment among several isn't caught. Exact per-payment coverage would need a lookup per row, which costs too much at this data's scale.
7. *(app-only)* Possible duplicate payments: flags payments that share a phone number, amount and date. The grouping key is `duplicatePaymentKey`, which the payment form also uses to warn while a payment is typed in (see "The payment form's hints").

### Needs follow-up

The rule lives in `web/src/engine/followUp.ts` (`needsFollowUp`, `FOLLOW_UP_AFTER_DAYS = 30`): a Pending or Partial pledge qualifies once the latest of its last payment date, its pledge date and the local date of its `updatedAt` (`dates.ts` `localIsoDate()`; blank or unreadable is ignored) is more than 30 days before "today". It is pure and date-injected, like the rest of the engine; see `dates.ts` `todayIso()`.

`updatedAt` counts so that a note saved after a call ("Called 24 Sep – paying Friday") takes the donor off every volunteer's list with no schema change. The Help states the price: any saved edit (a typo fix, a bulk clean-up) restarts the 30 days too. A dedicated "last contacted" column was rejected: it changes the wire contract and needs a manual Sheet migration. The demo seeds each pledge's `updatedAt` on its pledge date, so its follow-up list isn't emptied by one recent shared stamp.

## Server (Code.gs)

### Testing and deploying Code.gs

`Code.gs` is tested in Node: `test/support/appsScript.ts` fakes the Apps Script services. After editing it, raise `API_VERSION` (see "API_VERSION handshake"), paste it into the Apps Script editor and deploy a **new version** of the existing deployment, so the URL doesn't change. Put the commit's short SHA in that version's Description: it's the only link from an Apps Script version number back to a commit, which a rollback needs (roll back the site and `Code.gs` together; see "Undoing a bad update" in `docs/SETUP.md`). Pasting into the editor can be replaced by pushing from a maintainer's own computer with clasp: see "Deploying Code.gs from your computer (optional, with clasp)" in `docs/SETUP.md`.

`test/contract.test.ts` drives the real `createApi` and store against it, so an op name, payload key or copied constant (`MAX_TEXT`, `MAX_AMOUNT`, `WARNING_MARK`, `PHONE_IGNORED`, read with the harness's `evaluate`) changed on one side only fails the gate, and so does a `phoneKey_` that keys a phone differently from `matchKey`, or a save, delete or goal change that no longer lands exactly once when Google loses its first response. It shows the two files agree in one commit, not that the live deployment matches them; the `API_VERSION` check covers that.

`apps-script/appsscript.json` lists `oauthScopes` explicitly, so Apps Script never adds a scope by itself. If a `Code.gs` change calls a Google service whose scope isn't in the list (today the list is `spreadsheets.currentonly`, `script.external_request` and `userinfo.email`), add the scope to the manifest in the same commit. The Node fake doesn't check scopes, so a missing one only shows up live, as a permission error on the calls that need it. Neither the hash test nor the `API_VERSION` banner checks the manifest. When it changes, the organiser must paste it too (SETUP step 1.4), then run `setup` once in the editor to approve the new permission (it's safe to run again), before deploying the new version.

### API_VERSION handshake

The site and the live `Code.gs` compare versions on every load (`web/src/version.ts`). `Code.gs` declares `const API_VERSION = N;` on a line of its own, which `vite.config.ts` reads with a regex into `define` as `__API_VERSION__` (so the two can't be typed differently), and `load` returns it as `apiVersion` (optional in `LoadResult`/`State`: a `Code.gs` from before it sends none).

After each load, `render()` in `app.ts` updates a `.banner-warning` under the offline one. A missing or lower server version shows "The tracker's server is out of date. Organiser: redeploy Code.gs…"; a higher one shows "The tracker was updated. Reload this page…", which is what catches a phone tab left open across a deploy (its tab-return refresh reloads data, never code). Neither blocks saving, and the server rejects nothing on a mismatch: most `Code.gs` edits are compatible validation changes, and a server-side rejection would turn those into failed saves that **Reopen** only repeats from the same stale code. (A new entry field is the exception: validation, not the version check, then refuses every save from an older site; see "Adding a field: background".)

Every edit to `Code.gs`, comments included, must raise `API_VERSION` and append the hash the failing test prints to `CODE_GS_HASHES` in `test/server/code.test.ts`, which is the only thing that forces the bump; then deploy `Code.gs` before the site. A new site against an older `Code.gs` can fail saves with misleading messages (a `Code.gs` from before create-by-upsert answers a create with `NOT_FOUND` "Someone else deleted this row."). An old site against a newer `Code.gs` is normally compatible. Either order shows a banner during the gap. In this order it is "The tracker was updated. Reload this page…", and a reload clears it once the Pages build lands.

`__BUILD_SHA__` (`GITHUB_SHA`, blank locally) and the version are shown on the Help tab for support. There is deliberately no `doGet`/CI version check and no `clasp` deploy from CI: clasp would need the owner's OAuth token, which reaches the donor Sheet, as a secret in a public repo.

### Validation

Validation lives in `web/src/validate.ts` and in `validateRow_` in `Code.gs`, and `test/support/validationCases.ts` runs against both. Change them together. Both sides check every field's length before the Payments-only blank-phone check runs, so a phone that is both blank and overlong reports as overlong on both.

A payment also needs an amount ("Enter the amount received."; 0 is allowed), though a pledge's may stay blank: a payment of nothing would still add to # Payments and move Last payment, dropping a donor who paid nothing off Needs follow-up.

### Client-named rows

The client names new rows. A create is an upsert with a `crypto.randomUUID()` id and *no* `updatedAt`; `upsert_` requires a UUID there and, if that id already exists with the same entry values, returns the row unchanged, so a Save retried after a lost response cannot add a duplicate; differing values answer `CONFLICT` with the saved row as `current`.

Each opened form keeps one id across retries: `openPledgeForm`/`openPaymentForm` make it when they open (the `newId` option) and Reopen passes it back, so a form reopened from a failed-save toast is the same open. Views never make ids. `store.savePledge`/`savePayment` take the row as a required argument (the edited row, or `{ id }` (`NewRow`) for a new one), so a create that forgot its id cannot compile. An update carries `updatedAt` and is version-checked as before.

This changed the wire contract: an older `Code.gs` deployment treats the id as an update and answers `NOT_FOUND`, so deploy the new version together with the site (see Troubleshooting in `docs/SETUP.md`).

### Authentication

`assertPlausibleToken_` rejects a token cheaply before calling Google: it checks the token is a well-formed 3-part JWT with the right `aud` before `verifyToken_` spends a network call on `tokeninfo`. `tokeninfo` remains the actual authority.

A missing `CLIENT_ID` script property is reported as `INTERNAL` "The server is not configured…", not as an expired sign-in (`clientId_()`, which also trims the property, so a space or line break pasted with it is harmless). Likewise a token whose unverified payload names another audience answers `INTERNAL` "This site and the server are set up with different Google sign-in IDs…" (`assertPlausibleToken_`): the site's `VITE_GOOGLE_CLIENT_ID` and `CLIENT_ID` differ, and `UNAUTHENTICATED` would make `api.ts` force a new sign-in that carries the same audience. The malformed- and unreadable-token checks stay `UNAUTHENTICATED`, so a corrupted token still gets a fresh sign-in.

On the client, a failed `fetch` on an online device adds a hint about the deployment's "Anyone" access, because that misconfiguration looks like a network error to the browser.

### Text-forcing and dates

Text written to the Sheet is apostrophe-prefixed (`toSheetRow_`, via `toCell_`). It is the only text-forcing mechanism. This keeps leading zeros and `+`, and stops formula injection. Don't remove it, and don't also format the Pledges/Payments data columns as **Plain text** in the Sheet UI: a Plain text cell stores the apostrophe literally instead of hiding it, which corrupts ids, phone numbers and dates.

Hand-typed dates are read in the spreadsheet's own time zone (`fromCell_` uses `getSpreadsheetTimeZone()`). Non-ISO text typed directly into a date column loads as blank in the app rather than as an unparseable string.

### Header guard

Row 1 of Pledges and Payments is checked on every read and write: `assertHeaders_` is called from `readRows_`, from `findRow_` (which runs before every append, update and delete), and from `onEdit` before it stamps anything. Rows are read and written by column position, so a column inserted, moved or deleted in the Sheet would misread every field after it and let the next edit overwrite the new column. Instead the request answers `INTERNAL`, naming the first column out of place and saying the organiser must put the columns back.

Help and `docs/SETUP.md` send the organiser to **Edit → Undo** or a fix by hand (a deleted column or tab copied back from an older version), never to **Restore this version**: the script saves as the owner, so volunteers' saves share the Sheet's versions with the organiser's own change, and restoring one from before it would lose them.

Headers compare loosely (lower-cased, letters and digits only), and extra columns after `updatedBy` are allowed. Adding a field to `HEADERS` therefore means adding its header to row 1 of the live Sheet in the same sitting as the deploy.

A missing tab's message says the organiser needs to rename it back, or copy a deleted one back, in plain words and naming no script function, since volunteers see it too. `docs/SETUP.md`'s troubleshooting row is where the organiser is told not to re-run `setup()`, which only adds tabs and would leave the records stranded in the renamed one.

### Rows with no id

Rows with no id are skipped, never given one automatically, but counted (`readRows_`/`looksLikeEntry_`). A row whose column A is blank is left out of `load`, which protects the totals and notes rows people add under their data; auto-filling ids would make those count. The one exception is a confirmed organiser action on rows that pass every check (below).

`load` returns `rowsWithoutId: {pledges, payments}`, counting only skipped rows that look like entries: a phone that isn't blank by `isBlankPhone_` (the same NFKC-then-`PHONE_IGNORED` test a Payments save uses), plus an amount on Payments. Summary shows a neutral note under Data health when either is above 0. It is not a health check, so the parity fixture is untouched. The field is optional in `LoadResult` and `State`, because a `Code.gs` deployed before it doesn't send it; the note just stays hidden until both are redeployed.

**Add selected rows to the tracker…** (`addSelectedRows`, in the Sheet's **Fundraiser tracker** menu next to Start a new drive) is the only code that gives a row with no id one. It exists for a one-off catch-up: a list of pledges and payments kept outside the tracker, pasted into the live tab with **Paste special → Values only** and column A left blank (the organiser's steps are in `docs/SETUP.md`, "Bringing in a list kept outside the tracker"). It gives ids only to the rows the organiser selected, only after they confirm, and only when every non-empty selected row passes; one failure anywhere writes nothing. Typing the rows into the app is slow for hundreds of rows (each create reads the whole tab under the one script lock, plus a 1–16 s round trip), and hand-typed ids skip every check, so this is the route for a long list.

- **Problems (refuse the whole selection):** a selection not on Pledges or Payments, in more than one block, or covering row 1; a selected row with anything in column A (a live row: rewriting it would skip its version check and history); any of the row's cells formatted Plain text (`@`), where `toCell_`'s apostrophe would be stored literally; anything in columns G and H, which the write replaces with `updatedAt` and `updatedBy` (a list pasted more than five columns wide); a cell that would read differently in the app from what the Sheet shows (`cellProblem_`: a phone the Sheet turned into a Date or an error, kept as a number of fewer than 10 digits, which may have lost a leading 0, or starting with an apostrophe kept as text, as typing `'0551234` into a Plain text cell of the list leaves it; a date or amount cell that isn't blank but `fromCell_` reads as blank, such as `24/09/2026`, a date kept as a serial number, or `$1,250`; a Date or error in a text column); a row with a blank phone or, on Payments, no amount (as `looksLikeEntry_`, so a totals or notes row can't slip in; a pledge needs a phone here, though the app allows a phoneless one); a phone of fewer than 7 digits (`MIN_PHONE_DIGITS`), a totals or notes label such as `Total` sitting where the phone goes; anything `validateRow_` refuses, with its own message (the one rule set, so `validate.ts`, `validateRow_` and `validationCases.ts` stay twins), after trimming phone, name and notes as the app's forms do (so ` ⚠ Eman` meets the leading-`⚠` rule); and, on Pledges, a phone whose `phoneKey_` equals that of a Pledges row with an id, or of another selected row, since a donor on two rows double-counts. `phoneKey_` is the app's match key without its `#` (NFKC, Arabic-Indic and Persian digits, `PHONE_IGNORED`, the US `+1`, lower-case; `test/contract.test.ts` holds the two equal), so it refuses exactly the second pledges the app would double-count, `+1 336…` against `336…` included, and never a genuine new donor. A payment method that differs from a Settings method only in capitals or surrounding spaces is corrected first, not refused. Blank rows (every cell empty or whitespace) are skipped. At most 10 lines are listed, then "…and N more".
- **Warnings (listed in the confirmation, never blocking):** the app's two warnings on a payment it won't count: its `phoneKey_` matches no Pledges row with an id (`⚠ phone not in Pledges`), or the first pledge it matches has no amount (`⚠ no amount on Pledges`); and a payment with the same `phoneKey_`, amount in cents and date as one with an id or an earlier selected row, since two real gifts can match. As in `duplicatePaymentKey`, a payment with no date is never called a duplicate.
- **Flow:** it plans without the lock, shows the problems (writing nothing) or one OK/Cancel question, and only then takes `withLock_`, plans again and writes. A dialog suspends the script, so holding the lock while one is open would turn every volunteer's save into `BUSY` for as long as the organiser reads. The second plan must have no problems and the same signature as the first (the selected rows' values, the rows to write and the warnings), or it writes nothing and says the rows or the tab changed meanwhile: a volunteer saving a pledge for one of the donors, a cell edited, or a row deleted above, which moves the selection. `BUSY` and a moved header throw, as in `startNewDrive`.
- **The write:** one `setValues`, in place, over the rows from the first entry to the last, with the blank rows between written back as read, so the tab never grows (the `getRange`-past-`getMaxRows` trap of an append doesn't arise). Each entry goes through `toSheetRow_`, the only text-forcing mechanism, with `id` from `Utilities.getUuid()`, `updatedAt` blank and `updatedBy` `imported yyyy-MM-dd HH:mm` in the spreadsheet's time zone. A script write never runs `onEdit`, and no history row is written, since nothing is replaced.
- **Why `updatedAt` is blank:** a blank cell loads as `''` (`fromCell_`). The client routes a row by whether `updatedAt` is `undefined`, so `''` is an existing row and its edits and deletes take the update path (`withRow` in `api.ts`, `savePledge`/`savePayment` in `store.ts`); `assertUnchanged_` compares `''` with `''`, `remove_` only needs a string, and the first save stamps a real version. `localIsoDate('')` is `''`, so `needsFollowUp` goes by the pledge's own dates: an old unpaid pledge shows under Needs follow-up at once, where a row saved in the app or given an id by hand (which `onEdit` stamps) would stay off it for 30 days.
- **Cost:** per pass, one `getValues` and one `getNumberFormats` of the selection's columns A to H, one `getDataRange` of each tab it checks against, and Settings for Payments; never a Sheet call per row, so a few thousand rows take seconds. `toRecord_` takes the time zone once per read, because a pasted list of real dates would otherwise cost a `getSpreadsheetTimeZone` call per Date cell, under the lock.
- **Undo** is the organiser deleting the rows the final message names, before anyone edits them (Help and SETUP say how). Tests run in the Node fake, which can't model a paste, the locale or real number formats (`getNumberFormats` answers `''` unless a test sets `@`), hence SETUP's trial on **File → Make a copy** first. `getActiveRangeList`, `getNumberFormats` and the Sheet's dialogs need no scope beyond `spreadsheets.currentonly`.

### History tabs

Every edit and delete keeps the row it replaces (`appendHistory_`). The script runs as the owner, so the Sheet's own version history can't say which volunteer changed a row, and its **Restore this version** rolls back every volunteer's entries since, so Help and SETUP tell the organiser never to use it to get a row back.

Instead, `upsert_`'s update branch and `remove_`, after the version check and just before `setValues`/`deleteRow`, append the old row (through `toSheetRow_`) plus `changedAt`, `changedBy` (the caller's email; `dispatch_` passes it to `remove_` too) and `action` (`edit`/`delete`) to a `Pledges history`/`Payments history` tab, which `setup()` creates and `historySheet_` also creates on first use. A failed history write fails the edit or delete, so nothing changes unrecorded. Creates, a create retry that finds its own row, refused changes and goal changes log nothing, and `load` never reads these tabs.

The organiser restores a row by pasting its first 8 cells back (over the live row, for an edit), so keep a history row's leading cells in `HEADERS` order. This reverses the design spec's original "no edit history" scope decision.

### Edits made in the Sheet (onEdit)

Edits typed or pasted into the Sheet get a new version (the `onEdit` simple trigger). Sheets never changes `updatedAt` itself, so without it a volunteer holding a copy from before an organiser's fix would pass the version check and save the old values back; with it they get the normal `CONFLICT`/Reload question.

For each Pledges/Payments row from row 2 down that the edit touches *and that already has an id*, it writes `updatedAt` (now) and `updatedBy` (the editor's email, or `edited in Sheet` when Google withholds it), apostrophe-forced via `toCell_`. It never creates or rewrites an id (that would turn a pasted totals or notes row into a counted entry), skips edits wholly right of `updatedBy`, checks row 1 first so a moved column is never overwritten, and takes no lock, so a save already past its version check can still win that narrow race.

Simple triggers need no setup or OAuth scope and never fire for the script's own writes, so it can't loop; they also don't fire for **File → Import**. No wire change.

### Starting a new drive

A new drive archives and clears; it never deletes rows (`startNewDrive`, run from the **Fundraiser tracker** menu that the `onOpen` simple trigger adds to the Sheet). It needs the Sheet's dialogs: `getUi()` throws in the Apps Script editor, so it can't be started from Run by mistake, and `alert`/`prompt`/menus need no extra OAuth scope.

It prompts for a label and refuses one that is blank or would reuse a tab name, then, under the script lock, checks row 1 of Pledges and Payments, copies them and both history tabs to `<tab> <label>` (which nothing reads), and only after every copy clears row 2 down with `clearContent()`. Don't switch to `deleteRows`: Sheets refuses to delete every row below a frozen header, which rows 2 to the last become once `appendRow` has grown a tab past its first 1,000.

Settings and the Allowlist are left for the organiser (SETUP's "When the drive ends"), and a tab left open shows the old drive until it reloads.

### Locking

Saves, deletes and goal changes run under the script lock (`withLock_`, which calls `tryLock(LOCK_WAIT_MS)`), and so do the writes of the organiser's Start a new drive and Add selected rows, never while their dialogs are open; `load` and `onEdit` take none. A `BUSY` answer means the server's `LOCK_WAIT_MS` lock wait ran out before anything was written, and the client retries it (see "Retries and timeouts"). If BUSY still shows up at event scale, raise `LOCK_WAIT_MS` from 10000 to about 25000, well under the client's 45 s timeout, rather than restructuring the locked section (an edit like any other, so it raises `API_VERSION` too).

### Logging

Server errors are logged for the owner, never with a token (`errorBody_`; where to read them is in `docs/SETUP.md`, "Reading the server's log"). `doPost` answers every error itself, so Apps Script's Executions page shows each run as Completed and the log is the only trace. The app's requests are anonymous to Apps Script (the id_token rides in the body), and Google may keep an anonymous run's log off the Executions page; SETUP explains linking the script to the step-2 Cloud project and reading Logs Explorer instead.

An unexpected error logs `Unhandled server error in <op>:` with its whole stack, message included, and `BUSY`/`FORBIDDEN` log a one-line warning (op, code, and for `FORBIDDEN` the refused email); other refusals aren't logged.

The two errors known to quote the token never reach the log: the body is parsed on its own (`readRequest_`; an unreadable body answers `BAD_REQUEST`, unlogged), and a failed tokeninfo fetch, whose message quotes the URL, is rethrown as a fixed `tokeninfo request failed` (`fetchTokenInfo_`). Every line also passes through `maskToken_`, which replaces the caller's token; route any new log line through it.

## Client data flow

### Optimistic saves and pending rows

Save and Delete close the dialog at once and finish in the background (`runForm` in `web/src/ui/form.ts`), because an Apps Script round-trip takes 1–16 s. The store's optimistic update shows the change immediately.

A row whose save is in flight, create *or* edit, is `isPending`: a per-id count in `store.ts`, incremented once and decremented exactly once in a `finally`, so overlapping saves of one row don't unmark it early and a throwing view can't leave it stuck. `renderTable`'s `pending` option fades it, labels it "Saving…" and refuses to open it, because an edit opened then would carry an `updatedAt` about to be replaced. Once a save has reached the server, a view that throws while redrawing is logged (`publishSettled`), never reported as a failed save.

New rows are appended (`withRow` in `store.ts`, `appendRow` in `Code.gs`). The store publishes optimistic rows synchronously, which several forms rely on (see "Save and log a payment", "Save and add another" and "The payment form's hints").

### Reloads and other volunteers' changes

Other volunteers' changes arrive only on a reload. The nav's **Refresh** button calls `store.load()`, and so does **Download .xlsx** (see "Download .xlsx refreshes first"). Returning to the tab reloads automatically when the last load (`store.lastLoadedAt()`) is over 2 minutes old, but never while any `<dialog open>` exists.

### Reloads overlapping changes

`load()` replays every in-flight save, delete and goal change over the fresh data (`mutations` in `store.ts`). A change that commits while a reload is already running keeps its overlay (now the server's saved row, or the removal) until each such reload has landed, because their snapshot predates the commit: without it a committed create would vanish (and get typed in twice) or a committed edit revert to an old `updatedAt`. A reload started after the commit gets no overlay, so it can show another volunteer's newer version. A failed save or delete falls back to the version the latest reload fetched, not the one it started from. Overlapping loads are ordered: one that lands after a later-started load has published is ignored (its overlay bookkeeping still runs).

### Retries and timeouts

`api.ts` retries transient failures automatically. `send()` retries a 404/502/503/504 (Google's echo redirect intermittently 404s after the script already ran) or a failed `fetch` with a short backoff (600 ms, then 1500 ms) before surfacing an error. The backoff stays short on purpose: a deployment not shared with "Anyone" fails exactly like a dropped connection, and an online device should see that hint quickly.

A `fetch` that fails while `navigator.onLine` is false instead waits for the `online` event, capped at `OFFLINE_WAIT_MS` (20 s, quoted in Help), removes the listener either way, and gives up if the device is still offline.

A `BUSY` answer (the server's `LOCK_WAIT_MS` lock wait ran out before anything was written) is retried twice after a random 1–3 s pause, through the injected `sleep`. A save retried through BUSY can show "Saving…" for about 35 s.

Each attempt has a 45 s `AbortController` timer (not `AbortSignal.timeout`, which iOS 15 lacks) that stays armed until `response.json()` finishes; an abort is checked before the "unexpected page" `INTERNAL` error, so a stalled answer isn't blamed on the deployment. A timeout becomes `NETWORK` without the "Anyone" hint and is retried at most once, so a stalled request gives up after about 90 s instead of leaving a row on "Saving…", Refresh on "Refreshing…" or the boot skeleton up for minutes. The boot skeleton (`renderLoading`) changes to a "Still loading…" note after 5 s, and `boot()` cancels that timer once loading ends.

On any *update*, a `CONFLICT` whose `current` record is the row being saved (its `id`, checked on its own because a draft carries none) and already matches the draft being sent (`pledgeMatchesDraft`/`paymentMatchesDraft`, applied in `saveExisting`) is treated as success, not resurfaced as an error. The check exists for a retry whose first request landed but whose response was lost. Nothing tracks whether a retry actually happened, though, so a first attempt that finds another volunteer already saved the same values also counts as saved. Both wrap `draftMatches`, which walks every key the draft carries (amounts compared to the cent), never a hand-kept field list: a field missed there would let a CONFLICT that differs only in that field count as saved, dropping the volunteer's change without a word.

Creates are safe to retry as-is (idempotent by the client-chosen UUID; see "Client-named rows"). A delete is safe because `store.ts`'s `remove` treats `NOT_FOUND` as success (the row is gone, as asked), so keep that. `setSetting` just rewrites the same value.

### Taken off the Allowlist

A `FORBIDDEN` on Refresh, the return-to-tab refresh or Download's refresh clears the page; nowhere else does (`takenOffAllowlist` in `web/src/ui/app.ts`, checked by `reload()`, which serves Refresh and the auto-refresh on return, and by `exportWorkbook`, whose Download .xlsx refreshes first). The Reload offered by a CONFLICT/NOT_FOUND question (`createErrorReporter(() => deps.store.load())` in `app.ts`) bypasses `reload()`, so a `FORBIDDEN` there is only an error toast; route it through `reload()` if that should clear the page too.

A failed `store.load()` keeps every row in memory, so a tab left open would otherwise go on showing every donor after its account was taken off the Allowlist, and **Download this list**, which saves what is on screen without refreshing, would go on saving them. `showRemoved` closes every open `<dialog>` and replaces the app with the "Not on the volunteer list" screen, whose **Try again** reloads the page (a mistaken Allowlist edit then recovers once the row is back), and moves focus to its heading, since the control that had focus is gone and no alert toast would tell a screen reader why. `removed` then stops `render()` and the return-to-tab refresh, so no store publish, route change or `#display` brings the lists back.

It is deliberately that narrow. A `FORBIDDEN` on a save, delete or goal change stays a toast with Reopen, and one that lands while the Friday display is showing (its tap-to-reconnect runs the same `reload()`) stays a toast too, so one mistaken Allowlist edit cannot throw away every volunteer's unsaved entry or put an error screen on the projector. Failed-save toasts stay, so Reopen still works once the row is back.

It clears a page only when that page's next load reaches the server with a valid token: a cancelled sign-in or a dropped connection clears nothing, and nothing can retract a file exported before removal, which is why Help and `docs/SETUP.md` tell the organiser to sign a lost phone out of the Google account too. The startup screen (`boot()` in `web/src/main.ts`) offers **Use a different account** instead, since no data has loaded there.

### Leaving mid-save

Once the page is gone, a failed save can never show its toast, Reopen or Reload question, and a request not yet sent never reaches the Sheet. So while `store.hasUnsettledWrites()` is true (any save, delete or goal change not yet settled, read straight from `mutations` (`!committed`) so it can never drift from `settle()`), the nav's **Sign out** first asks "A change is still saving. Signing out now could lose it. Sign out anyway?" (`confirmDialog`), and a `beforeunload` listener in `mountApp` calls `preventDefault()` and sets `returnValue = ''`, so the browser asks before the tab closes or reloads.

Both ask as well, Sign out with "A change could not be saved. Signing out now loses it. Sign out anyway?", while `hasActionToast()` (`toast.ts`) is true: a failed save's Reopen toast is showing, or waiting behind an open form to show. Its mutation has already settled, so `hasUnsettledWrites()` no longer counts it, yet the toast holds the only copy of what was typed. A confirmed Sign out sets `leaving`, so leaving for the signed-out page is not asked about twice.

There is deliberately no "wait, then sign out" option: a save that failed while waiting would lose its Reopen toast when the page goes. iOS ignores `beforeunload`, and a tab swiped away or discarded never asks, so this protects Sign out everywhere and closing a tab on a computer, not phones; Help tells phone users to wait until no row shows "Saving…". A mutation that never settled would make every close ask, which a store test guards against.

## Auth and sign-in

### The sign-in dialog

Sign-in is its own modal `<dialog>` (`web/src/auth.ts`). A form dialog makes the rest of the page inert, so a sign-in requested while one is open must open *after* it in the top layer. (Saves now finish in the background, so a mid-save sign-in usually opens with no form dialog at all.) Dismissing it rejects every waiting `getToken` with `UNAUTHENTICATED` "Sign-in was cancelled." (the API does not retry that), and `refreshIfStale()` renews a token within 5 minutes of expiry on any click in `main` and when the tab becomes visible.

A token the client cannot decode counts as expired: `isFresh` returns false rather than throwing, so `getToken` asks for a new sign-in, and `hasFreshToken()` and `refreshIfStale()` never throw. Google always issues a JWT, so this guards a credential garbled on the way; without it every later call failed with a bare "Malformed sign-in token." until a reload.

### Token persistence

The ID token survives a reload of the same tab (`web/src/auth.ts`). `createAuth` reads `icg-id-token` from `sessionStorage` once and keeps it only if `isFresh` passes and its `aud` is the site's client ID (a stale, unreadable or other-audience value is ignored), and the GIS callback writes each new credential there. A reload within the token's hour (the browser's reload button, a phone restoring a tab it discarded, the projector page) then loads at once instead of reopening the sign-in dialog and a FedCM round trip, which Google lets through silently only once per 10 minutes and only with one Google account signed in.

`sessionStorage`, never `localStorage`: it dies with the tab, so a new tab on a shared computer never opens already signed in. `signOut()` removes it before navigating, or **Use a different account** would come straight back as the rejected account. Nothing clears it on `UNAUTHENTICATED`: `api.ts` already re-prompts, and the new credential overwrites it.

The `aud` check matters because the server answers a token for another client ID with `INTERNAL` "different Google sign-in IDs… Reload the page", which never makes `api.ts` fetch a new one: without it, a tab reloaded after the organiser corrects `VITE_GOOGLE_CLIENT_ID` would resend the old token for the rest of its hour.

Accepted trade-off: the token (email and name, under an hour) is readable by script on this origin, which GitHub Pages shares with the owner's other project pages, though only a page this same tab navigates to can see this tab's `sessionStorage`; the backend accepts it only with this app's `aud`.

### Sign out

Sign out lands on a signed-out page, not the sign-in prompt (`signOut()` in `web/src/auth.ts`, `renderSignedOut` in `web/src/ui/screens.ts`). The app cannot end the volunteer's Google session, so prompting straight away would offer the next person on a shared computer "Continue as <volunteer>": one tap to every donor and Download .xlsx.

`signOut()` turns off auto sign-in and `location.replace`s to `?signedout` (replace, so Back does not step straight back into the page just left); `start()` checks that flag before the demo check and before `createAuth`, so Google sign-in is never set up there. The page says the Google session is still in the browser, links to `https://accounts.google.com/Logout` labelled for shared computers only (it signs the whole browser out of Gmail too), and has **Sign in again**, which drops the flag. That URL is not a documented API, so Help's advice (a Guest or private window on shared and projector computers, closed after Sign out) must protect on its own.

**Use a different account** (the `FORBIDDEN` screen) calls `signOut({ switchAccount: true })`, which reloads straight into Google's account chooser. `auto_select: true` stays: turning it off would add a click to every hourly renewal on volunteers' own phones and would not help a forgotten Sign out. Anything that keeps the token beyond the page must be cleared in `signOut()` before it navigates.

For Sign out while a change is still saving, see "Leaving mid-save".

### Try again on a failed load

Try again on "Could not load the tracker" reloads the page (`web/src/main.ts`). An earlier version re-ran `boot()` in place to reuse the sign-in in memory, but the fix for a wrong `VITE_SCRIPT_URL` or `VITE_GOOGLE_CLIENT_ID` is a new build of the site, which a page built with the old values never runs, and the reload now costs no sign-in because the tab keeps its token in `sessionStorage` (a token for another client ID is ignored, so a corrected ID signs in afresh).

`base.css` sets `overscroll-behavior-y: contain` on `html, body`, so a stray pull-down on a phone doesn't reload the page (a phone never asks before dropping a save in flight); the nav's **Refresh** reloads the data.

## Dialogs, forms and focus

### Focus across store re-renders

Every store publish rebuilds `<main>`, so `render()` puts focus back on whatever control in `main` had it (`focusedSpot` in `app.ts`, using `web/src/ui/focus.ts`). That is one of:

- a control with a `data-focus-key`: the searches and date boxes, the phone **Sort by** list, each sortable column heading as `sort:<column key>`, Add pledge, Log a payment, Edit goal, Download .xlsx, Download this list, each Data-health **Show** as `health:<id>`, the Pledges status chips, Today, This week and Clear dates, the **Showing** filter chip, Show more, the Summary's Friday display link, each Find donor match as `lookup-match:<pledge id>`, the Find donor card's name heading, Print, Log a payment and Edit pledge, and Find donor's Add a pledge;
- a row's open button, found again through its `tr[data-id]`;
- the view's `<h1>` or `.table-wrap`, where focus lands after **Show** or a delete.

Inputs also keep their text and caret. Any new control in a list, the Summary or Find donor needs a key too, or each save that lands while a volunteer is on it throws them back to the top of the page.

The lists' search redraw is debounced (`SEARCH_DEBOUNCE_MS`), and a timer still pending belongs to the copy a re-render replaces, so Pledges' and Payments' `render()` cancels it first: the new copy draws the current search at once, and the old timer would only redraw a detached table.

Help is built once and handed back unchanged, so `render()` leaves it in place rather than putting it back, which would drop the focus of a section heading or Contents link. A heading press redraws only the table, not through `render()`, so `renderTable` itself moves focus to the redrawn heading when the pressed one had it.

### Focus after a save or delete

Save and Delete publish before their dialog closes, so the control that opened it has already been replaced and the browser drops focus onto `<body>`, the top of the page. `openDialog` (`dialog.ts`) records how to find its opener again (its `data-focus-key`, or its row's id), but only for an opener inside `#main`. On close, if focus is on `<body>` and no other dialog is open, it focuses the opener, or its replacement when a redraw has replaced it, or the list's `.table-wrap` when the row was deleted (its `<h1>` when that was the last row, since an empty list has no table).

A form opened by the form closing under it (**Save and add another**, **Save and log a payment**) opens while focus is still in that closed form, so it takes over that form's opener; each form of the run closes with the next one open and leaves focus alone, and when the last one closes focus goes back to Add pledge or Log a payment. An opener outside `main` (a toast's Reopen, the form under a delete question, sign-in) is left to the browser, so a nested dialog never has focus pulled out of it. The second redraw, when the save settles, is covered by `render()`'s own restore.

A Data-health **Show** moves focus to the opened list's `<h1>`; the Sections tabs keep their own focus. A control that removes itself while focused hands focus on, or it would fall to `<body>`: the **Showing** chip that clears a drill-down hands it to the list's `<h1>` (`clearFilter` in `app.ts`), and **Clear dates**, which hides itself, to **This week** beside it (a button, so no phone keyboard or date picker opens).

jsdom's `showModal` shim never moves focus, so the jsdom tests move it into the dialog themselves, and `e2e/keyboard-focus.spec.ts` checks it in a real browser.

### Discarding typing

Cancel, Escape and Back ask before throwing typing away (`runForm` in `web/src/ui/form.ts`), because on a phone Cancel sits next to Save and a stray tap would silently lose a payment. `runForm` snapshots every field's text when the form opens (*before* a Reopen refills it, so a reopened form counts as typed in), and while any field differs, the Cancel button, the dialog's `cancel` event and a secondary action marked `discardsTyping` (the pledge form's Log a payment) first ask "Discard what you typed?" (**Keep editing** / **Discard**). A clean form, including an edit or a payment opened with the phone filled in, closes at once.

The `cancel` path is best-effort: Chrome makes a close request non-cancelable when there has been no user activation since the last one, and the handler then lets it close rather than ask about a form already gone. jsdom can't model that, so check Escape/Back by hand on Android Chrome after changing it; the Cancel button is the reliable path.

### Save and log a payment

A new pledge can be saved and paid in one step (`openPledgeForm`'s secondary action in `web/src/ui/pledgeForm.ts`), for a donor who pledges and pays at once or a walk-in who never pledged. **Save and log a payment** is hidden until the phone box has a phone (`matchKey` not blank; a payment needs one). It submits through the ordinary Save path (`form.requestSubmit()`), and only if that closed the dialog does the dialog's `close` handler call `onLogPayment(phone)`. A failed check keeps the form open and clears the request, so the payment form never stacks on it and never opens on a later Cancel.

Pledges' **Add pledge** and Find donor's **Add a pledge** both offer it (at the door, a donor nobody can find is usually pledging and paying at once), and each builds that form from `deps.store.state()`, not the render-time state: the store publishes the new pledge's optimistic row synchronously, so the donor preview finds it at once. If the pledge's save then fails while the payment form is open, the store takes the pledge back out and the form's donor line turns to `⚠ phone not in Pledges` before the payment is saved (see "The payment form's hints"); Help says to Cancel and use the pledge's **Reopen**, then Save and log a payment, rather than add the pledge again. A payment saved anyway shows `⚠ phone not in Pledges` until the pledge's **Reopen** is used.

The payment form's `⚠ phone not in Pledges` preview points walk-in donors to this button only on a *new* payment: on an existing one it would enter the same money a second time. A payment form opened with a phone (Pledges, Find donor, or this path) and not as a Reopen puts focus in Amount received; a Reopen keeps its own rule (focus on the field with the error).

### Save and add another

Save and add another carries only the date, and the method on payments, within one run (`FormSpec.addAnother` in `web/src/ui/form.ts`), for typing up a stack of pledge cards or envelopes. It is offered only on the new-row forms from Pledges' **Add pledge** and Payments' **Log a payment**, never on an edit or a donor-specific Log a payment (a pledge's, the Find donor card's, or Save and log a payment's), whose phone belongs to one donor.

It is a plain button that runs `requestSubmit()` with a flag only that submit sees, so Enter still means Save; only once that save has started and closed the dialog does it open the next form, with its own new id (a failed save's Reopen keeps that form's id). The next form keeps `PledgeCarry`/`PaymentCarry` (Date, and Method on payments), starts empty otherwise, and lands on Phone. `pledgesView`/`paymentsView` build it from `deps.store.state()`, not the render-time state: a run outlasts the render it began in, and the duplicate-phone hint must see pledges typed earlier in the run.

That next form holds nothing to save until something is typed in it (`FormSpec.nextEntry`, set when `carried` is): Save closes it and a further Save and add another is ignored, because a double tap's second press lands on the next form's own button, and a pledge with every box empty passes validation.

Nothing is remembered between runs, deliberately (no `localStorage` "last method"): an ordinary Add pledge or Log a payment starts on today with no method, because a remembered method that is wrong looks right, where a blank one shows under "No method recorded". The footer puts the "Save and …" actions first, so on a phone Cancel and Save wrap together as the last row.

### The payment form's hints

The payment form says when a payment is already logged, and what the donor still owes (`web/src/ui/paymentForm.ts`, from the required `computed` option: `state.computed`, taken from the same state as its `pledges`). Both are advisory: Save stays enabled.

**Following the store.** These hints, and the suggested donor below, follow the store while the form is open (the `store` option, which every opener passes). The form reads `store.state()` as it opens, because a Reopen's other options date from the form whose save failed, and re-checks on every publish, so a save that settles or fails, or a reload that lands, reaches the form before Save. Above all, a pledge from Save and log a payment whose save fails is taken back out, and the donor line turns to the ⚠. Only the notes are redrawn, each only when its text changes, and the suggested-donor buttons only when the suggestions do, so no box, cursor or focus moves under the volunteer. It stops following as its own save starts, since that save's optimistic row would read as already logged in the closing form, and when it closes.

**Already logged.** An amber `role=status` note under Amount received appears when another payment has the same `duplicatePaymentKey` (match key, cents, date; exported from `summary.ts`, the exact grouping of the Possible duplicate payments check, so the two can never disagree). It is rechecked on phone, date and amount input and rewrites its text only when it changes, since a status region may re-announce every rewrite. It never matches the payment being edited, and on an edit it says press Delete, not Cancel, because Cancel would keep both copies. It sees only this device's state: a payment still saving is there (the store publishes optimistic rows synchronously, so a repeat in a Save and add another run or from Find donor is caught), but a failed save the store rolled back (even one that reached the sheet) or another volunteer's entry is not, until a reload. That is why Help's "check the list first" stays. Two real same-day installments of one amount also trigger it, the same accepted false alarm as the health check.

**Balance.** The donor preview adds "owes $X of $Y", "has paid in full" or "has paid $X more than pledged" (`findByPhone`), only on a new payment: an edited payment is already inside the balance. A donor listed more than once shows "listed more than once" instead, since their payments are counted twice and the balance is wrong. A pledge of 0 (amount not known yet) shows nothing, since nothing can be owed or over. There is deliberately no separate "amount exceeds balance" warning: a second amber state would be noise.

**Suggested donor.** A payment phone on no pledge gets a suggested donor, never an automatic fix (`nearMatches` in `web/src/engine/lookup.ts`, shown by `paymentForm.ts`). It runs only while the preview reads `⚠ phone not in Pledges` (not `⚠ no amount on Pledges`, which comes from an exact match), on a new payment and an edit alike: the edit is how rows from the "Payments not matched" drill-down get repaired. It compares digits only (a match key keeps letters) and offers at most 3.

- First come numbers that are the same: the same last 10 digits when both have 10 or more (a country code against a trunk 0 or none; a US `+1` never gets here, since the match key already drops it), or identical digits, 7 or more.
- Then numbers of the same length, 7 or more digits, with one digit different or two neighbouring digits swapped. More than 3 of those means a crowded run of numbers, so none of them is offered, though a same-number match still is.
- A number on two pledges is offered once, as its first pledge (the one the join uses). `0551234` and `551234` never match.

Each suggestion is a question naming the donor ("Is this from Aisha Rahman (555-010-0101)?") with a **Use their number** button described by it, which copies that pledge's phone into the box exactly and dispatches `input`, so the preview, the already-logged note and the discard check all see it. It sits in its own element after the preview, outside the `role=status` paragraph, because a button in a status region is read out again on every keystroke. Nothing is applied automatically: numbers one digit apart are common within a local exchange, and a careless tap credits the wrong donor and clears the ⚠ that showed the problem. It never touches the match key, the join or the parity fixture. When the pledge is the side with the typo, the button would copy that typo onto the payment, so Help says to correct the pledge instead.

### Changing a pledge's phone

Changing a pledge's phone warns about the payments it leaves behind (`paymentsOnOldNumber` in `web/src/ui/pledgeForm.ts`). Payments keep the phone they were logged with and join by match key, so a corrected pledge phone strands them at once: the donor reads Pending with $0 received, Total received and goal progress (the Friday display too) drop, and Needs follow-up can list a donor who has paid.

The edit form counts the payments on the old key once, when it opens (both callers, Pledges and the Find donor card, pass `payments`), and shows the note only while the typed key differs and no other pledge keeps the old key (a duplicate's payments stay matched to it). The note says what to do next, or volunteers read it as "don't change the number". It deliberately moves nothing itself: that would start one background save per payment, each able to fail on its own and queue its own CONFLICT question.

### Tap to call

Tap-to-call is built from the phone's digits and `+` only (`dialNumber` in `web/src/ui/phoneLinks.ts`), because the phone field is free text. It reads Arabic-Indic, Persian and full-width digits as `0`–`9` first (`asciiDigits`, shared with `matchKey`), since Help says those count the same, and a phone typed with them would otherwise have no Call, Text or tap-to-call at all.

The edit-pledge dialog shows **Call** (`tel:`) and **Text** (`sms:`) under the phone field, following what is typed and hidden while it has no digits; the Find donor card's phone is a `tel:` link. Neither goes on the Pledges rows, which are buttons that open the dialog, nor on Add pledge: that donor is usually standing there, and the links would sit in the Tab path from Phone to Name.

## Toasts and failures

### Save failures

When a background save fails, the store has already rolled back.

`CONFLICT` (and `NOT_FOUND` on a save) go to `reportError(err, context)`, which prefixes the Reload question with the interrupted change ("Couldn't save Aisha. Someone else changed…"), asks one at a time (a failed question is logged and never stalls the queue), and waits in `whenSafeToAsk` (`dialog.ts`) until no `<dialog>` is open *and* the Friday display is not showing, so it never lands on the next entry's form, reloads under it, or puts a donor name on the projector. It re-checks one task later before opening, because a dialog's `open` attribute drops before its `close` event, whose handler may open the next form (Log a payment does).

Anything else becomes an error toast "Couldn't save <row>. <message>" with **Reopen**, which refills the form exactly as typed (field error inline, focus on it) under the same options, and therefore the same new-row id; an edit reopens on the row's *current* version (`latest`), and Reopen stays disabled while a newer save of that row is pending. A failed delete toasts "Couldn't delete <row>. <message>" with no Reopen.

### Toasts

Failures go to an assertive `role=alert` region, confirmations to the polite one. Both regions are built when the app starts (`mountToasts` in `mountApp`; `showToast` still builds them on demand) and stay in the page even when empty, because a live region that appears together with its message is often not announced. `.toasts` has `pointer-events: none` and only `.toast` takes taps, so the empty stack never blocks the page.

An error toast raised while a dialog is open is added only once none is (`whenNoDialogOpen`, which re-checks one task later, like `whenSafeToAsk`): the modal makes the stack inert, and a toast added to it then is never announced, not even after the dialog closes, and the volunteer is likely typing the next entry when a background save fails.

An action toast never expires: it stays until **Reopen** or **Dismiss** is pressed, because the store has already rolled the change back (a new row leaves the list), so its Reopen holds the only copy of what was typed, and it may go unseen behind a later form or the Friday display (which hides toasts). This reverses an earlier 30 s lifetime meant to stop toasts piling up; instead `.toasts` is capped at `max-height: 50vh` and scrolls. A plain error toast lasts 8 s from when it is added; if that runs out while a form opened over it is still open, it gets a fresh 8 s from when the last dialog closes.

A confirmation is neither delayed nor held, since it would be stale by then. While a dialog is open it is also added, as a line of its own, to that dialog's visually hidden `role=status` region, which `openDialog` builds empty with every dialog, because the inert toast region would not announce it. Without that, a screen-reader volunteer in a Save and add another run heard "Saved." only for the last entry.

The stack is the first child of `<body>` (`position: fixed`, so only the DOM order changes), so a keyboard reaches Reopen before the page's up to 100 row buttons. Dismissing returns focus to `#main` via a temporary `tabindex` removed on blur, or at once if `#main` does not take the focus, since no blur would follow; `#main:focus` draws no outline. The 500 ms readiness poll runs only for actions with a `ready` check.

## Lists, sorting, paging, filters, downloads

### Order: newest first

Pledges and Payments list the most recently added row first until a column is sorted (`drawTable` in `pledgesView.ts`/`paymentsView.ts`). New rows are appended (`withRow` in `store.ts`, `appendRow` in `Code.gs`) and only the first page is drawn, so in Sheet order a just-saved row and its "Saving…" state would land out of sight. It's the reverse of the Sheet's row order, not a date sort (a payment can be backdated), so rows inserted mid-Sheet by hand don't come first.

The reversal lives in the two views, not in the shared `sortRows`; "Needs follow-up" reverses before its stable balance sort, so ties come out most recently added first. A third tap on a sorted heading (`nextSort` returns `null`) goes back to the default order. The engine's "first Pledges row in Sheet order" join is untouched.

### Sorting

Phones sort from a Sort by list, not the column headings (`sortSelect` in `table.ts`). At 720px and below the table becomes cards and `thead` is `display: none`, not visually clipped, because its sort buttons would otherwise stay as tab stops no one can see; the cards' `data-label`s name every value. The `.sort-by` list replaces them at that width only. Its options each state their direction ("Amount: largest first") and map to one `SortState`, or `null` for "Default order", which keeps "Needs follow-up" biggest balance first. Never hide the headings without the list: it is also the phone screen-reader path.

`drawTable` calls its `show(sort)` on every redraw, so a heading sort made on a wide screen shows there too ("Sorted by a column heading" when the list doesn't offer it). On wider screens the sorted heading carries a ▲/▼ arrow (`components.css`) whose alt text is empty, since `aria-sort` already announces it. A table with no `onSort` (Find donor's history) gets plain heading text instead of buttons.

### Paging

Phones page the lists 25 rows at a time, wider screens 100 (`tablePageSize` in `table.ts`). At phone width every row is a stacked card, and laying out 100 of them on each redraw (a tab switch, Refresh, a search, both publishes of a save) took a throttled phone well over the 100 ms budget; building the rows is cheap, the layout is not.

`content-visibility: auto` on the cards was rejected: rebuilt rows lose their remembered height, so the list jumps after every save or Refresh, and iOS 18–26 jitter without scroll anchoring. Both views call `tablePageSize()` wherever they set or grow `visibleCount`; it isn't re-read on a resize, so rotating a phone doesn't re-page an open list. Its `PHONE_WIDTH_QUERY` must match the stacked-card breakpoint in `components.css`.

### Drill-downs

A Data-health **Show** starts the list clean (search, status chip, date range). The lists spot a new drill-down by the `ListFilter` object's identity, not its label, so tapping Show again on the same check still clears them. That means `app.ts` must pass the same object on every re-render until the next Show, or each store publish would wipe the search.

### Filtered Payments subtotals and date shortcuts

A filtered Payments list adds up its own money (`drawTable` in `paymentsView.ts`), so a volunteer can count one night's cash box against the app. `showingLine`'s `loggedCents` option adds the rows' cents ("Showing 4 of 27 · $300.30 logged"), and `methodsLine`, under it in the same `role=status` region, lists `computeMethods` over the same rows, non-zero methods only, each amount tied to its method by a non-breaking space so a wrapped line on a phone never strands an amount at the start of a line.

It sums every filtered payment, not-counted ones included (that money is still in the box), so it says "logged", never "received", which is Summary's matched-only figure. Both are built in `drawTable`, not `render()`, so they redraw with the debounced search; the per-method line, not a search for "cash" (which also matches notes), is the reliable cash figure. The totals band and the "of M" count still cover every payment, as the v1.1 plan intended, and Pledges has no subtotal.

**Today** sets From and To to `todayIso()`; a payment with a blank or mistyped date drops out of it, which the Help calls out as a sign to look for one. **This week** sets From to `weekStartIso(today)` (`dates.ts`: the Saturday on or before, `WEEK_STARTS_ON`, because each Jumu'ah closes a week) and To to today, not Friday, since a later date this week is a typo.

That line is the app's only period figure, deliberately: a separate weekly module would give figures matching neither Total received nor Payments logged whenever rows are unmatched or undated, so there is no weekly Summary card and no By-week export sheet (the Payments sheet's real dates can be pivoted). The Friday display gets no weekly line until the organiser asks for one, since showing a low week to the congregation is their call. Any weekly figure built later must count payments the way the headline beside it does (the display's is matched-only `receivedCents`).

### Stale lists

A stale list is named where it invites a duplicate pledge. Every donor check reads the volunteer's own last load, so a pledge another volunteer just added looks missing. Once that load is over 2 minutes old (`staleListAge` in `web/src/ui/staleList.ts`), Find donor's "No donor found." adds how long ago the list was loaded and asks for a Refresh before adding a pledge, and the payment form's `⚠ phone not in Pledges` preview (given `pledgesLoadedAt` by every opener) says to save the payment anyway and not add a second pledge, ahead of the walk-in advice to use Save and log a payment, so that warning is read first.

A server-side duplicate-phone check on create was deliberately deferred until the "Donors listed more than once" health check shows duplicates in real use: it would thread a warning through `store.save()`, `runForm`'s shared "Saved." toast and the retried-create path in `upsert_`.

### Flagged rows

Flagged rows say so in words, not only by tint. A duplicate pledge's Phone Number cell ends with "· Listed more than once" (`pledgesView.ts`), and a future-dated payment's Date Received with "(future)" (`paymentsView.ts`), deliberately not `⚠`, because that payment is still counted. The first cell's text is also the row's open-button name (`table.ts`), so screen readers hear "Open 555-0105 · Listed more than once" (the demo's duplicate); an e2e locator matching `Open <phone>` with `exact: true` would miss a duplicate row. The Help quotes both markers (`SAID` in `helpView.ts`).

### Download this list

Download this list saves the rows the screen drew, never a second filtering of them. While a filter is on and a row matches, Pledges and Payments show it beside "Showing N of M" (`showingLine` in `filter.ts`); it hands `downloadList` the exact array `drawTable` just rendered, filtered, sorted and every page of it, because a file that filtered for itself could quietly disagree with the screen (the Needs-follow-up balance order, the drill-down's chip and date-range resets). `pledgeSheetRows`/`paymentSheetRows` take row arrays, so both downloads share one column mapping and its formatting.

The rows sheet stays a plain table, headings on row 1 and nothing below the last row, so Excel's sort and filter see only data. An **About this list** sheet holds the filter in words (`describeFilter`), Made on, Figures as of, the row count, the totals (a Pledges list's Balance Outstanding and Overpaid / Credit kept apart, as on the Summary; a Payments list's Payments Logged, never "received", since it includes not-counted payments, as the screen's "$X logged" does) and a delete-or-shred reminder. It does not refresh first: it saves what is on screen, which is why Figures as of is there. The file name carries the filter as letters and digits only (`ICG-Pledges-Needs-follow-up-2026-09-24-1401.xlsx`).

On paper, print hides the controls that set the filter (the `.toolbar` and the Pledges `.chip-row`, whose pressed chip's fill paper drops), so a `.print-only` span names it after "Showing N of M", and a paged table prints "N more rows not shown." where its Show more button was; base.css hides `.print-only` everywhere but print.

### Find donor

Find donor tries the exact number first, then lists partial matches (`web/src/ui/lookupView.ts`). `findByPhone` stays exact because the parity fixture asserts it; on a miss the view filters pledges with the list searches' `matchesQuery` over the name and match key, so the last four digits work. The list is capped at 20 (`MATCH_LIMIT`, which the Help's figures test checks the guide against) with a "Showing 20 of N" line; the cap, not a debounce, keeps a one-letter search at event scale instant, so it needs no timer.

"No donor found." offers **Add a pledge**, prefilling the phone only when the search is nothing but a phone number (all digits once `matchKey` strips its formatting): a name with a digit in it would otherwise be saved as a phone that matches no payment. The search box is focused from `app.ts`'s `hashchange` handler on arrival, never from `render()`, which re-runs on every store publish. Choosing a name match moves focus to the donor card's name heading (`tabindex=-1`), because the card replaces the list, pressed match included.

The Find donor card pins itself to a pledge opened for editing from it (`chosenId` in `web/src/ui/lookupView.ts`). The card is re-derived from the search text on every store re-render, so without the pin, saving a new phone for the donor that was searched by phone would turn the card into "No donor found.". Its **Edit pledge** button reads "Saving…" and does nothing while that pledge's save is in flight, for the same reason `renderTable` refuses to open a pending row, and like that row it is `aria-disabled`, not `disabled`: the Save that started it redraws the card, and focus can only return to a button that can take it.

## Summary, export and print

### The .xlsx export

The .xlsx export is laid out for Excel as it opens (`web/src/ui/export.ts`): Summary first, columns sized to their contents plus 2 characters of padding, every column capped at 40 (a date counts as the length of its fixed-width format, 10 characters or 16 with a time, and money by its formatted length), money in the app's accounting style, and a header filter on Pledges and Payments.

Money cells are found by label, not by position: any list column or Summary row whose label ends in `($)`, plus the rows under "Collected by Payment Method" (method names are the organiser's own). So keep the `($)` on every money label, or that column reaches Excel as a bare `1650.3`.

Both lists end with **Last changed by** (`updatedBy`) and **Last changed at** (`updatedAt`, a real Excel date and time, `yyyy-mm-dd hh:mm`, found by its heading the same way). `updatedAt` is UTC text, so it is written as the downloading device's local wall-clock time, built at UTC because the sheets are written with SheetJS's `UTC` option. These name whoever saved the row last, not the volunteer who took the money, which the Help says.

It deliberately has no print titles, since a malformed `_xlnm.Print_Titles` name makes Excel offer to repair the file and nothing in CI opens one in Excel, and SheetJS CE cannot freeze panes.

SheetJS CE comes from SheetJS's own CDN (`https://cdn.sheetjs.com/xlsx-<version>/xlsx-<version>.tgz` in `package.json`), not the npm registry. Upgrade it by editing that URL, never with `npm install xlsx`, which fetches the old registry release.

### Download .xlsx refreshes first

Download .xlsx refreshes first (`exportWorkbook` in `app.ts`), because a tab kept on screen all evening never reloads on its own and would export a backup missing other volunteers' entries. It goes through the same shared load as the nav's **Refresh**, which reads "Refreshing…" meanwhile; a Download pressed mid-Refresh waits for that load instead of starting another, and a second press while an export runs is ignored.

It then builds from `store.state()`, never from the state the Summary was drawn with: the load's publish rebuilds the Summary, button included, so disabling the button would do nothing. Keyboard focus stays on the redrawn button through `render()`'s own focus restore (`data-focus-key="download"`), unless it has left `main` meanwhile.

A failed refresh makes no file, and the error toasts as "Couldn't download the file. …", except a `FORBIDDEN`, which clears the page as Refresh's does (see "Taken off the Allowlist"). Downloading therefore needs a connection, and may ask the volunteer to sign in.

### Timestamps and confidentiality

The export and the Summary are stamped with the last load, not the click (`store.lastLoadedAt()`, which `app.ts` passes into `downloadWorkbook`), because other volunteers' changes are only as fresh as that load. `formatDateTime` shows it in local time; the UTC-pinned `formatDate` would give a late-evening load the next day's date.

The Summary sheet's first row is **Figures as of**, and the file is named for the same minute (`ICG-Fundraiser-2026-09-24-1401.xlsx`, no colons, which Windows forbids). That row moved every Summary cell down one, so anything reading the sheet must find a row by its label, as `GOAL_PERCENT_LABEL` and the `($)` suffix do, never by cell address.

`book.Props` carries a title marking the file confidential (`ICG Fundraiser (confidential)`) and a created time, but deliberately no author: who pressed Download says nothing about the figures, and the lists' Last changed by columns already name who saved each row. The file holds every donor's name, phone number and amounts and outlives the volunteer's place on the Allowlist, so the Help and `docs/SETUP.md` tell volunteers to keep it to themselves and the organiser to keep copies on their own computer or in a private folder only they and the second editor can open, never a shared drive, email or group chat.

The Summary view reads "Updated Sep 24, 2026, 2:01 PM" on screen and on paper; its "— tap Refresh for others' changes" sits in a `.screen-only` span that base.css's print block hides. Before the first load there is no time: a blank cell and "Not yet loaded", never 1970.

### Goal figures

Goal figures are rounded down, never to nearest (`flooredGoalFraction`/`formatWholeDollars` in `web/src/format.ts`): the percentage to 0.1% on the Summary, the display and the export, and the display's money to whole dollars, so nothing claims the goal early. The Summary's and the display's progress bars announce that same floored percentage as `aria-valuenow` (`flooredGoalPercent`), never one worked from the raw `goalFraction`, where float error can drop a point (0.29 × 100 is 28.999…). Use these helpers for any new goal figure.

### The donor statement

The Find donor card prints as a statement for the donor (`donorCard` in `web/src/ui/lookupView.ts`; its **Print** button calls `window.print()`). `print-hidden` keeps everything written for volunteers off paper (the search, pledge and payment Notes, the duplicate warning, Amount received), and its rule in `base.css`'s print block is scoped under `.lookup-view`, so it never reaches another view. `print-only` (the class printed lists use for their filter, hidden everywhere but on paper) adds an "Islamic Center of Greensboro — pledge statement, printed <date>" heading and a **Total paid** line.

Total paid sums the listed payments' cents, never `receivedCents`, which is blank for a pledge with no amount. A negative balance shows as **Credit** on the card, on screen and paper, not in accounting brackets. It has no tax-acknowledgment wording on purpose: whether the app issues acknowledgments, and in what words, is for the organiser and treasurer to decide.

## Friday display

Friday display mode never prompts for sign-in on its own (`web/src/ui/displayView.ts`, `mountDisplay`). It only refreshes while `auth.hasFreshToken()` is true, and holds sign-in prompts back for as long as it's mounted (`auth.suppressPrompts()`), released on exit or on a manual reconnect. This exists because the mode's whole purpose is a projector announcement view: an unrequested Google sign-in dialog popping up over the figures mid-khutbah is the one failure it must never cause. A tap on the stale note is the one path that can still prompt: the volunteer is present and gains a fresh hour.

Its title is the Settings tab's `campaignName` (`readSettings_` trims it and sends `''` when the row is missing; `setup()` seeds `Fundraiser`), and reads `Fundraiser` when that is blank or absent: `Settings.campaignName` is optional because a `Code.gs` from before it sends none.

**Refresh is driven by data age, not a timer started at mount.** Saves don't move `lastLoadedAt`, so a laptop used for data entry all morning would otherwise put morning figures (and the "out of date" note) on the projector. `refreshIfDue` runs once on entry and then every 30 s, and loads when the later of `lastLoadedAt` and the last attempt is at least `DISPLAY_REFRESH_MS` (3 min) old; the last-attempt time keeps a failing load to one retry per 3 minutes, and the 30 s check picks up a sign-in finished just after entry. The entry call must stay *after* `suppressPrompts()`: a server that rejects the token makes `api.ts` ask for a new one, which would otherwise open sign-in on the projector.

**The figure stays Total received** (`receivedCents`, spec B6, and its percentage B14, both pinned by the parity fixture), not Payments logged, so the Summary, the display and the export agree. It is off only while Unmatched payments isn't $0.00, which is why the Help checklist says to check that first. Its money and percentage are rounded down (see "Goal figures").

While the display is showing, toasts are hidden, and CONFLICT questions wait (`whenSafeToAsk`) so no donor name reaches the projector. A `FORBIDDEN` from its tap-to-reconnect stays a toast (see "Taken off the Allowlist").

## Styling and accessibility

### Colour tokens and their copies

Styling comes only from `web/src/styles/tokens.css` (from `DESIGN.md`). No other file contains colour literals, with two unavoidable exceptions:

- `web/index.html`'s two `theme-color` metas, `THEME_COLOR` in `web/src/theme.ts` and `web/public/manifest.webmanifest`'s `background_color`/`theme_color` cannot reference CSS variables, so they hold copies of `--color-bg` (light `#fbf9f3`, dark `#15110a`). Change the metas, `THEME_COLOR` and the manifest together with `--color-bg`; `test/theme.test.ts` fails when the metas or `THEME_COLOR` drift from the token, but nothing checks the manifest.
- The icon artwork (`web/public/icons/icg-monogram.svg`, the favicon, and `icg-monogram-maskable.svg`) hard-codes `--color-bg` `#fbf9f3`, `--color-ink` `#1a2e1f` and the original gold `#a87c0a`, which now survives in `tokens.css` only as `--chart-2` (`--color-gold` was darkened to `#926c09` for text contrast). If you change the icon colours, re-rasterise the PNGs beside the SVGs (`icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon-180.png`). The repo has no script that does this.

The browser bar follows the app's theme, not only the device's. Each `theme-color` meta carries a `prefers-color-scheme` media query, which alone would leave the Android Chrome address bar, or an installed app's title bar, on the device's setting above a page in the other theme. So a chosen theme gives both metas its colour: `index.html`'s boot script does it for a choice saved on an earlier visit, reading the colour from the matching meta so it keeps no copy of its own, and `toggleTheme` does it from `THEME_COLOR` for a choice made now. With no choice saved, the metas are left alone and their media queries follow the device, as the page does.

The manifest stays light only: there is no widely supported way for `background_color`/`theme_color` to vary by colour scheme. So an installed app's splash screen is cream for a dark-mode volunteer; once the page loads, its metas decide the title bar.

### Forced colours and the method ring

The `@media (forced-colors: active)` block at the end of `components.css` names system colours (`Highlight`, `Canvas`) instead: they follow the viewer's Windows high-contrast theme, which replaces every token colour and drops fill-only cues (the progress fill, the pressed status chip, the payment-method ring and its key) unless given one.

That ring is plain CSS, with no chart library: a `conic-gradient` built in `summaryView.ts` from `var(--chart-N)` stops, so it follows the theme with no redraw. `chartSlots.ts` gives each listed method the colour of its place in Settings, and "No method recorded" and "Other / unlisted" their own neutrals (`--chart-7`, `--chart-8`).

### Contrast

`test/styles/contrast.test.ts` reads the hex tokens from `tokens.css` and checks the text/background pairs volunteers rely on (hints, errors, the Delete label, red rows, input borders, the Friday bar's ring, the gold Summary totals) still reach WCAG AA in both themes. Keep each token a `--name: #rrggbb;` literal, or the test reads it as missing.

### Focus not obscured

Keyboard focus is kept clear of the sticky nav and of a dialog's pinned Save/Cancel row by fixed `scroll-padding` in `components.css` (on `html` and `.modal`), sized a little above their measured heights, and of the toast stack by a bottom `scroll-padding` that follows its height: `toast.ts` sets `--toasts-height` from a `ResizeObserver` (0 while no toast is on screen, and jsdom has none), and `body` gains the same bottom padding so the last rows can scroll clear.

The desktop nav's padding assumes one row, which is why the signed-in email is cut short at 721–900px. If either bar grows, raise its padding (`e2e/focus-not-obscured.spec.ts` catches a shortfall), and never give a jump target a `scroll-margin`, which stacks on top.

### Screen-reader announcements

Search results are announced to screen readers (WCAG 4.1.3). The wrapper around each list's "Showing N of M" line (on Payments, with the per-method money line under it) is a `role=status` that stays put while `drawTable` swaps its contents. **Download this list** sits beside it in `.list-status` but outside the region (`showingLine` returns the two apart), since a button inside a status region is read out again with every new count.

Find donor has a `visually-hidden` `role=status` line beside its results ("3 donors match", "Found Aisha Rahman", "No donor found."); the results themselves are not live, or the whole donor card would be read out on every keystroke. Both it and the payment form's donor preview rewrite their text only when it changes, since one keystroke after another usually gives the same answer (every partial phone number gets the same "not in Pledges" warning).

`.visually-hidden` (`base.css`) is the one class for text meant only for screen readers.

## Installable, no service worker

The app is installable but has no service worker (`web/index.html`, `web/public/manifest.webmanifest` and `icons/`). A service worker would let an already-open tab keep serving cached JS/HTML after `Code.gs` is redeployed with a wire-contract change (see "Client-named rows"), which is exactly the site/`Code.gs` version-skew failure this repo already guards against by requiring both redeployed together (and flags with the `API_VERSION` banner when they aren't). Manifest + icons alone make the app installable (Add to Home Screen, standalone display) while every load still fetches the current site.

## Demo mode

A dev-only demo mode exists for visual checks without Google sign-in or a deployed backend: `npm run dev`, then open `http://localhost:5173/?demo` (`web/src/demo.ts`, dynamically imported so it is excluded from production builds). `?demo&big` swaps the hand-written seed for a deterministic event-scale one (1,500 pledges, 3,000 payments), which the paging and list-download e2e specs and `npm run perf` use.

## Help and its drift test

The volunteer guide is built into the app (the **Help** tab, `web/src/ui/helpView.ts`), not a separate document. Its prose is literal, so `test/ui/help.test.ts` fails when a message it quotes, or a figure it gives (the follow-up days, the rows per page, Find donor's match limit, the auto-refresh and display-stale minutes, and the offline save-wait seconds), no longer matches the code. Change the guide in the same commit as the code.

The test also pins the `General donations` effects the How-to describes, requires a row in the matching `terms(...)` list for each form field, and `SAID` in `helpView.ts` quotes the flagged-row markers. The Help tab shows `__BUILD_SHA__` and `API_VERSION` for support.

## Testing

`npm run check` (typecheck, the Vitest suite, build) is the gate. The Playwright e2e suite is separate and does not gate the deploy.

### Unit tests

Unit tests close a `<dialog>` the way a browser does. jsdom has no `showModal`/`close`, so `test/support/setup.ts` shims them, and its `close()` drops `open` at once but fires the `close` event a task later, as browsers do. `whenSafeToAsk`'s extra task, `auth.ts`'s `closing` bookkeeping and Log a payment's handoff all depend on that gap, so assert a close handler's effects with `vi.waitFor`, not straight after the click; under `vi.useFakeTimers` the event fires only once the timers are advanced. A root `afterEach` there lets a still-queued close event land and then clears `document.body`, so it can never open a dialog in the next test.

The unit tests run in America/New_York (`TZ` in `vite.config.ts`'s `test.env`); see "Time zones in tests" below.

### Code.gs and the contract test

`Code.gs` runs in Node under `test/support/appsScript.ts`. `test/server/code.test.ts` holds `CODE_GS_HASHES` (see "API_VERSION handshake") and the shared validation-case loop; `test/contract.test.ts` checks the client and server agree (see "Testing and deploying Code.gs").

### The parity fixture

`test/fixtures/parity-input.json` and `parity-expected.json` are a frozen expected-values fixture: 22 pledges, 27 payments and 10 Find-donor lookups covering every awkward case the engine must handle (float dust, one phone number spelled four ways, a leading zero next to the same digits without one, a pledge and a payment whose phones are only punctuation (both blank, so they don't join), a donor with a phone but no Amount Pledged, a donor with no name, an overpayment, a duplicated donor), paired with the values each one should produce. `test/engine/parity.test.ts` asserts `web/src/engine` reproduces them exactly (cents for money, ISO dates for dates, exact status/warning strings).

It's ordinary committed test data now: there's no generator script or external file in this repo it's checked against, and no reason it should ever need to change unless you're deliberately changing the engine's rules. `possibleDuplicatePayments` (the app-only, v1.1 health check) has no cells in this fixture and is excluded from the assertions.

### End-to-end (Playwright)

A Playwright e2e suite (`e2e/*.spec.ts`) drives demo mode in real Chromium. It covers:

- adding a pledge, and logging a payment, including from an open pledge, with and without discarding an edit to it;
- a save's in-flight "Saving…" state, and Sign out asking first during it, under a paused `page.clock`;
- focus returning to a row saved from the keyboard;
- Escape and Cancel on a half-typed form;
- a pledge and its first payment saved in one step, and Save and add another;
- filtering Pledges/Payments, sorting by heading and by the phone's Sort by list, and the phone's shorter list pages;
- downloading a filtered list, and printing its filter under `page.emulateMedia({ media: 'print' })`;
- the Friday display, and Sign out landing on the signed-out page;
- layout at 360px and at WCAG's 320px reflow width: no sideways scroll, all five tabs inside their strip (it hides its scrollbar, so a cut-off tab is otherwise invisible), each Summary total inside its card;
- keyboard focus kept clear of the sticky nav, a dialog's pinned footer and a failed save's toast;
- an axe scan of every tab in both themes at 360px, and in the light theme at 320px, where the nav's tighter wrap changes what axe's target-size rule measures.

The axe scan (`e2e/accessibility.spec.ts`) runs only axe's WCAG A/AA rules, after the web fonts load and transitions settle, and `@axe-core/playwright` is pinned to an exact version in `package.json`: a new axe-core release can add rules and turn it red with no app change, so bump it on purpose and fix what it finds.

Run the suite with `npx playwright install chromium` once, then `npm run test:e2e`. It starts and tears down its own dev server and production preview on fixed ports (`E2E_PORT`, default 5199, and 100 above it), so it's safe alongside `npm run dev`. Playwright starts both servers whichever project you pick.

It's a separate CI job (`.github/workflows/pages.yml`'s `e2e` job) that never gates the Pages deploy, because deploy needs only `build`. A failure there still turns the run red and sends GitHub's failed-run email, so don't add `continue-on-error` to hide it.

### The production-bundle spec

One spec skips demo mode: `e2e/production-bundle.spec.ts`, its own `production` project, loads the production bundle, which Playwright builds for the Pages base `/icg-fundraiser-tracker/` into a temp folder (never `dist/`) and serves with `vite preview`. The `VITE_*` values go through the webServer's `env` option, because a Git Bash shell prefix rewrites a `/…/` value into a Windows path.

`page.route` stands in for Google's sign-in script (its `prompt()` answers with a `tokenFor` token for the account each test signs in as) and hands each Apps Script call to `Code.gs` run by `test/support/appsScript.ts`. It covers only what demo mode can't: boot with no console errors, the "Not on the volunteer list" screen, and a CONFLICT's Reload question waiting behind the Log a payment form that replaces an open pledge, which depends on the real browser's close-event order that `whenSafeToAsk` waits out. The sign-in stub can drift from real Google sign-in and FedCM, so a pass says nothing about Google's side.

`PRODUCTION_BASE` in `e2e/support/production.ts` is a fixed copy of today's Pages path (see "Base path").

### Time zones in tests

Both the unit tests (`TZ` in `vite.config.ts`'s `test.env`) and the e2e browser (`timezoneId` in `playwright.config.ts`) run in America/New_York: CI runs in UTC, where local time and UTC agree, so a slip from the volunteer's own clock back to UTC (Today, Last changed at, a file name's time) would pass there unnoticed. Give an e2e fixed clock an explicit offset (`'2026-06-20T20:00:00-04:00'`), since the test runner's own zone may differ from the browser's.

### Performance probe

`e2e/perf-probe.ts` is a separate, non-CI script, deliberately not matching Playwright's `*.spec.ts` test discovery, that measures render time at event scale (~1,500 rows) in both viewports. Run it manually with `npm run perf`.

## CI and deploy

### Pages workflow

`.github/workflows/pages.yml` runs `npm run check`, checks the repository variables and publishes the site to GitHub Pages; its `e2e` job runs alongside and never gates the deploy (see "End-to-end (Playwright)"). CI never deploys `Code.gs` (see "API_VERSION handshake" for why there is no clasp deploy from CI).

### Repository variable check

The deploy refuses broken repository variables. A build with `VITE_SCRIPT_URL` or `VITE_GOOGLE_CLIENT_ID` missing or mistyped still succeeds, and deploying it would swap the working site for "Not set up yet" or one that can't reach the server. So `pages.yml`'s build job runs a *Check the repository variables* bash step before the Pages upload, skipped on pull requests (they don't deploy, and a fork's never get the variables).

It fails with an `::error::` naming the `docs/SETUP.md` step when either is empty, when `VITE_SCRIPT_URL` isn't an `/exec` URL (`/macros/s/…`, or a Workspace account's `/a/macros/<domain>/s/…`; keep accepting both), or when `VITE_GOOGLE_CLIENT_ID` has whitespace or doesn't end in `.apps.googleusercontent.com`. It lives in the workflow, not `vite.config.ts`, so local builds and demo mode are unaffected.

`test/pagesWorkflow.test.ts` runs the step's own script under bash, and skips that where `bash` can't see the test's environment (WSL's, reached from PowerShell); run it from Git Bash on Windows.

### Base path

The site's base path comes from `VITE_BASE` (`vite.config.ts`, default `/`). `pages.yml` sets it to `/<repository name>/` for GitHub project Pages, so local builds and `vite preview` serve at `/`. Renaming the repository moves the live site to the new path. `PRODUCTION_BASE` in `e2e/support/production.ts` is a fixed copy of today's path: the spec still passes after a rename because any base other than `/` exercises base handling, but update the copy so it keeps matching the live path.

Serving from a `<user>.github.io` repository or a custom domain needs `VITE_BASE: /` in `pages.yml`, because the workflow derives the value from the repository name and it is not a repository variable. A custom domain also needs its own Authorized JavaScript origin (`docs/SETUP.md`, Google sign-in client step 3).

### Deploy order and rollback

Deploy `Code.gs` (new version of the existing deployment, commit short SHA in the Description) before the site; see "API_VERSION handshake" for what each order looks like during the gap. Roll back the site and `Code.gs` together ("Undoing a bad update" in `docs/SETUP.md`).

## Adding a field: background

The checklist itself is in `CLAUDE.md`. No new field is planned (the design spec fixes the schema). The compiler catches a miss in the typed places and the tests catch one in `Code.gs`; the rest only leave a visible gap, so check them by hand. The reasons behind the steps:

- **Types.** Changing the record and its `PledgeDraft`/`PaymentDraft` in `web/src/types.ts` makes the compiler flag the form's `read()`, the typed drafts in `test/support/validationCases.ts`, `test/support/factories.ts` and `test/contract.test.ts`, and the four seed builders in `web/src/demo.ts`, which return `Pledge[]`/`Payment[]`.
- **Column order.** In `HEADERS`, put the field between `id` and `updatedAt` (for example after `notes`), and give `PLEDGE_COLUMNS`/`PAYMENT_COLUMNS` the same order. `id` must stay first, because rows are counted by whether column 1 holds an id. `updatedAt, updatedBy` must stay the last two columns, next to each other: `onEdit` stamps the two cells starting at `updatedAt`, and Help, SETUP and the `assertHeaders_` message all tell the organiser that their own columns go to the right of `updatedBy`.
- **Server tests.** The shared validation-case loop in `test/server/code.test.ts` fails if either list misses a draft field (the saved row checks `ENTRY_FIELDS`, the row read back checks `HEADERS`); that file's `PLEDGE_COLUMNS`/`PAYMENT_COLUMNS` need the field too. The untyped `pledgeDraft`/`paymentDraft` at the top of that file need the field too, or `validateRow_` rejects them and most server tests fail. So do the hard-coded `8`s in its history-restore tests. The untyped `aisha`/`bilal` pledge drafts in `e2e/production-bundle.spec.ts` also go to the real `Code.gs`. Neither the compiler nor `npm run check` sees them. Only the e2e job does, and it doesn't gate the deploy.
- **The live Sheet.** Rows are read and written by column position, so insert the new column at its `HEADERS` position, with its header in row 1, in the tab *and* in its `… history` tab; until row 1 matches, `assertHeaders_` refuses every load, and every save or delete on that tab. A history row's cells to copy back grow by one, so update "first 8 cells" in `helpView.ts`, `docs/SETUP.md`, the design spec, "History tabs" above and CLAUDE.md's history-tab rule (Hard rules). Add the column to the design spec's §3 table too, since the spec fixes the schema.
- **Rollout.** Don't deploy the site first: the old `validateRow_` copies only its own `ENTRY_FIELDS`, so the new field would be dropped with no error. Still, the new `Code.gs` requires every `ENTRY_FIELDS` key. A page running the old site sends no key for the new field, so every save from it fails with "Couldn't save <row>. Expected text." (or "Amount must be a number."). Reopen repeats the same failure, because the old form has no such field to mark. This lasts until that tab loads the new site, and the "Reload this page" banner appears only after the tab's next data load. Either roll out when nobody is entering data and have every volunteer reload, or, for one release, have `validateRow_` accept an absent new field: blank on a create, and on an edit keep the stored value. Blanking it on an edit would wipe a value that a volunteer on the new site had already entered.
- **`api.ts` needs nothing:** `draftMatches` already compares every key of the draft.
