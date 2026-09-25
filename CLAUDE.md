# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It is the short rulebook. The mechanisms, numbers and reasons behind each rule are in `docs/ARCHITECTURE.md`; follow a rule's pointer before changing anything it covers.

## What this repository is

A web app for masjid fundraiser volunteers to record pledges and payments from any device and see the same totals. `web/` (Vite + TypeScript) is the client, on GitHub Pages; `apps-script/Code.gs` is the backend, running as a Google Apps Script web app backed by a private Google Sheet that only allowlisted Google accounts can reach.

- **Setup:** `docs/SETUP.md`. **Architecture and rationale:** `docs/ARCHITECTURE.md`.
- **Design spec:** `docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md`. Visual system: `DESIGN.md`.
- **Volunteer guide:** built into the app (the **Help** tab, `web/src/ui/helpView.ts`), not a separate document.

The engine's business rules were originally modelled on a volunteer-maintained Excel spreadsheet; that spreadsheet is a separate project and not part of this repo. The rules below are this app's own, checked by this repo's tests rather than against any external file (see "Testing the engine against the frozen fixture").

## Commands

- `npm run check`: the gate (typecheck, the Vitest suite, build). It does not run the Playwright e2e suite.
- `npm run dev`, then `http://localhost:5173/?demo`: dev-only demo mode, no Google sign-in or backend (`web/src/demo.ts`, dynamically imported, so excluded from production builds). `?demo&big` is a deterministic event-scale seed (1,500 pledges, 3,000 payments). (details: docs/ARCHITECTURE.md → Demo mode)
- `npx playwright install chromium` once, then `npm run test:e2e`: drives demo mode in Chromium, plus one production-bundle spec. It runs its own dev server and production preview on `E2E_PORT` (default 5199) and 100 above it, so it's safe alongside `npm run dev`. In CI it is its own `e2e` job that never gates the Pages deploy; never add `continue-on-error` to hide a failure. (details: docs/ARCHITECTURE.md → End-to-end (Playwright))
- `npm run perf`: `e2e/perf-probe.ts`, manual render timings at event scale (~1,500 rows) in both viewports. Not CI, deliberately not a `*.spec.ts`. (details: docs/ARCHITECTURE.md → Performance probe)
- **Deploy order:** after any `Code.gs` edit, raise `API_VERSION` and its hash (below), paste `Code.gs` into the Apps Script editor and deploy a **new version** of the existing deployment (so the URL doesn't change) with the commit's short SHA in its Description; only then push the site to `main`, which runs `.github/workflows/pages.yml`. Roll back the site and `Code.gs` together ("Undoing a bad update" in `docs/SETUP.md`). clasp from a maintainer's computer may replace pasting; CI never deploys `Code.gs`. (details: docs/ARCHITECTURE.md → Testing and deploying Code.gs)

## Engine rules

`web/src/engine/` is a pure module (no DOM, no network, date-injected). Money is handled internally in integer cents. "Blank" means the field is empty; it is not zero, and the two are tracked separately throughout. Three logical tables, Pledges (donor dimension), Payments (transaction fact) and Summary (derived, read-only totals), join on a **normalized match key**, not the raw phone number.

### The match key

`web/src/matchKey.ts` applies NFKC, reads Arabic-Indic and Persian/Urdu digits as `0`–`9`, strips `-`, `(`, `)`, `.`, `+`, any whitespace, Unicode dashes and invisible direction and zero-width marks, drops a US `+1`, lower-cases, and prefixes `#`.

- **The `#` prefix is required**, or `0551234` could be coerced to a number and collide with `551234`. Keep any new key logic text-prefixed.
- **A blank phone gets a blank key, and every join must guard on that**, not just match `""` to `""`, or a phoneless pledge matches every phoneless payment. A phone with nothing left after stripping (`--`, `()`, `" "`) is blank too, never a bare `#`.
- **"Has a phone" means `matchKey(phone) !== ''`**, never a test on the raw text (the missing-phone check, both blank-phone validators including `isBlankPhone_` in `Code.gs`, the Log a payment buttons).
- **`+1` is dropped only when what's left is `/^1[2-9]\d{9}$/`**; every other digit counts, so `0551234` and `551234` stay different. `matchesQuery` puts the `1` back for partial searches (`keyWithUsCountryCode`).
- **Invisible marks are explicit ranges, not `\p{Cf}`**, so the class copies unchanged into `PHONE_IGNORED` in `Code.gs`. The Arabic-digit mapping is client-only. The saved phone keeps what was typed.

(details: docs/ARCHITECTURE.md → The match key)

### Statuses

Four literal values, set only when Amount Pledged is filled in (blank has no status): nothing received (0 cents) → `Pending`; otherwise, comparing summed per-amount cents (`toCents`, `Math.round(amount * 100)`), received > pledged → `Overpaid`, equal → `Paid`, else `Partial` (`statusFor` in `derive.ts`). Never compare floats: 0.1 + 0.2 against a 0.30 pledge must read `Paid`. Summary's status counts are `count`s over the four literal strings, so renaming a status breaks the counts. (details: docs/ARCHITECTURE.md → Statuses)

### The two ⚠ warnings

- Every "this payment is not counted" signal keys off a leading `⚠` (`WARNING_MARK` in `web/src/engine/constants.ts`). Any new warning must start with it, and a donor name never may (`validate.ts` and `Code.gs` reject such names).
- `⚠ phone not in Pledges`: no match-key match (a blank phone included). `⚠ no amount on Pledges`: the matched donor, the first Pledges row in Sheet order with that key, has a blank Amount Pledged, so the payment doesn't count toward that donor.
- One exception: a donor listed twice whose first row has no amount but a later row does. The payment reads `⚠ no amount on Pledges` yet counts toward the later row.
- A matched-but-nameless donor shows a blank, never `0`.

(details: docs/ARCHITECTURE.md → The ⚠ warnings)

### Totals and donors

- **Outstanding excludes credits.** It sums only positive per-donor balances, never `pledged - received` overall, so one donor's credit can't mask another's debt; the credit is a separate figure.
- **Duplicate donors double-count, by design.** A donor on two Pledges rows has their payments counted once per row (inflated totals, usually a phantom `Overpaid` credit, an Unmatched figure usually below zero). Inherent to the one-row-per-donor model, not a bug; the "Donors listed more than once" check flags it.
- **The phone is the donor's ID.** Made-up numbers (`000-0001`…) rely on the phone being checked for length only, so never add a phone format check that would reject them. The `General donations` pledge (`000-000-0000`, blank Date Pledged) must keep Amount Pledged `0`.

(details: docs/ARCHITECTURE.md → Outstanding, credits and duplicate donors; When a phone number isn't one donor)

### Health checks

`computeHealth` in `web/src/engine/summary.ts` returns seven checks. Their labels (`HEALTH_LABELS`) are the names below, verbatim. The first six are original and covered by the parity fixture; the seventh is app-only (v1.1) and excluded from it.

1. Payments not matched to a pledge
2. Donors listed more than once
3. Pledges missing a phone number: only pledges with an Amount Pledged above 0; "no phone" means `matchKey(phone) === ''`.
4. Payments missing a date or amount: only payments that have a phone.
5. Payments dated in the future: exact.
6. Donors whose payments predate their pledge: compares only each donor's *latest* payment date, a deliberate limitation (per-payment coverage costs too much).
7. *(app-only)* Possible duplicate payments: same phone, amount and date, grouped by `duplicatePaymentKey`, which the payment form's already-logged note shares.

(details: docs/ARCHITECTURE.md → Health checks)

### Needs follow-up

`needsFollowUp` in `web/src/engine/followUp.ts` (`FOLLOW_UP_AFTER_DAYS = 30`): a Pending or Partial pledge whose latest of last payment date, pledge date and local date of `updatedAt` is more than 30 days before "today" (`dates.ts` `todayIso()`). Any saved edit restarts the clock, deliberately. (details: docs/ARCHITECTURE.md → Needs follow-up)

## Hard rules

### Server, wire contract and deploy

- **Validation lives in two places.** `web/src/validate.ts` and `validateRow_` in `Code.gs`, both run by `test/support/validationCases.ts`; change them together. Both check every field's length before the Payments-only blank-phone check, so a blank and overlong phone reports as overlong on both. A payment needs an amount (0 allowed); a pledge's may stay blank. (details: docs/ARCHITECTURE.md → Validation)
- **Every `Code.gs` edit, comments included, raises `API_VERSION`** and appends the hash the failing test prints to `CODE_GS_HASHES` in `test/server/code.test.ts`; deploy `Code.gs` before the site. The version check only shows a banner and never rejects a save; keep it that way, and keep `const API_VERSION = N;` on a line of its own (`vite.config.ts` reads it). No `doGet`/CI version check and no clasp deploy from CI (clasp would need the owner's OAuth token as a secret in a public repo). (details: docs/ARCHITECTURE.md → API_VERSION handshake)
- **Copied constants stay identical.** `test/contract.test.ts` fails when an op name, payload key or `MAX_TEXT`/`MAX_AMOUNT`/`WARNING_MARK`/`PHONE_IGNORED` changes on one side only. (details: docs/ARCHITECTURE.md → Testing and deploying Code.gs)
- **`appsscript.json` lists `oauthScopes` explicitly.** A `Code.gs` change that needs a new Google scope adds it in the same commit; the Node fake doesn't check scopes, and the organiser must paste the manifest and run `setup` once before deploying. (details: docs/ARCHITECTURE.md → Testing and deploying Code.gs)
- **The client names new rows.** A create is an upsert with a `crypto.randomUUID()` id and no `updatedAt`, idempotent on retry; each opened form keeps one id across retries and Reopen; views never make ids; `store.savePledge`/`savePayment` require the row (`{ id }` for a new one). Updates carry `updatedAt` and are version-checked. (details: docs/ARCHITECTURE.md → Client-named rows)
- **Text written to the Sheet is apostrophe-prefixed** (`toSheetRow_`, via `toCell_`), the only text-forcing mechanism (leading zeros, `+`, formula injection). Never remove it, and never format the Pledges/Payments data columns as **Plain text** in the Sheet. (details: docs/ARCHITECTURE.md → Text-forcing and dates)
- **Row 1 is checked on every read and write** (`assertHeaders_`, from `readRows_`, `findRow_` and `onEdit`), because columns are positional. Never send the organiser to the Sheet's **Restore this version**, for this or anything else: it rolls back every volunteer's saves. (details: docs/ARCHITECTURE.md → Header guard)
- **A row with a blank column A is skipped, never given an id**, and counted in `rowsWithoutId` only when it looks like an entry; it is not a health check. The one exception is the organiser's **Fundraiser tracker → Add selected rows to the tracker…** (`addSelectedRows`): ids only for the selected rows, only after an OK, only if every one passes `validateRow_` and the paste checks (else nothing is written), re-checked under the lock, which is never held while a dialog is open. It writes a blank `updatedAt` on purpose. (details: docs/ARCHITECTURE.md → Rows with no id)
- **Every edit and delete appends the old row to a `… history` tab** after the version check, just before the write (`appendHistory_`); a failed history write fails the change. Keep a history row's leading cells in `HEADERS` order (a restore pastes the first 8 cells back). (details: docs/ARCHITECTURE.md → History tabs)
- **`onEdit` stamps `updatedAt`/`updatedBy` on hand edits of rows that already have an id**; it never creates or rewrites an id and takes no lock. (details: docs/ARCHITECTURE.md → Edits made in the Sheet (onEdit))
- **A new drive archives, then clears with `clearContent()`**; never switch to `deleteRows`. (details: docs/ARCHITECTURE.md → Starting a new drive)
- **Tokens:** `assertPlausibleToken_` rejects cheaply before `tokeninfo`, which stays the authority. A missing `CLIENT_ID` or another audience answers `INTERNAL`, not `UNAUTHENTICATED`. Route every server log line through `maskToken_`; never log a token. (details: docs/ARCHITECTURE.md → Authentication; Logging)
- **Hand-typed dates are read in the spreadsheet's time zone** (`fromCell_`); non-ISO text loads as blank. (details: docs/ARCHITECTURE.md → Text-forcing and dates)
- **BUSY at event scale:** raise `LOCK_WAIT_MS` toward 25000 (under the 45 s client timeout) rather than restructure the locked section. (details: docs/ARCHITECTURE.md → Locking)

### Client data flow and auth

- **Save and Delete close the dialog at once and finish in the background** (`runForm`). A saving row is `isPending` (a per-id count decremented exactly once in a `finally`) and can't be opened. (details: docs/ARCHITECTURE.md → Optimistic saves and pending rows)
- **`load()` replays every in-flight save, delete and goal change** over fresh data (`mutations` in `store.ts`), and a stale overlapping load is ignored. (details: docs/ARCHITECTURE.md → Reloads overlapping changes)
- **`api.ts` retries transient failures.** An update's `CONFLICT` matching the draft counts as saved via `draftMatches`, which walks every draft key, never a hand-kept list; a delete's `NOT_FOUND` counts as success in `store.ts`'s `remove` (keep that); timeouts use `AbortController`, not `AbortSignal.timeout`. (details: docs/ARCHITECTURE.md → Retries and timeouts)
- **Other volunteers' changes arrive only on a load**: Refresh, Download .xlsx, or tab return once the last load is over 2 minutes old and no `<dialog open>` exists. (details: docs/ARCHITECTURE.md → Reloads and other volunteers' changes)
- **A `FORBIDDEN` clears the page only from `reload()` or Download's refresh**; on a save, delete, goal change or the Friday display it stays a toast. (details: docs/ARCHITECTURE.md → Taken off the Allowlist)
- **Sign out and `beforeunload` ask first** while `store.hasUnsettledWrites()` or `hasActionToast()` is true. (details: docs/ARCHITECTURE.md → Leaving mid-save)
- **Sign-in is its own modal `<dialog>`**, opened after any open form dialog in the top layer. (details: docs/ARCHITECTURE.md → The sign-in dialog)
- **The ID token lives in `sessionStorage`, never `localStorage`**, kept only when fresh and for this site's `aud`. Anything that keeps the token beyond the page must be cleared in `signOut()` before it navigates. Sign out lands on `?signedout`, never a sign-in prompt. (details: docs/ARCHITECTURE.md → Token persistence; Sign out)

### Screens

- **Every focusable control in a list, the Summary or Find donor needs a `data-focus-key`**, or each store re-render throws focus to the top of the page. A control that removes itself while focused must hand focus on. (details: docs/ARCHITECTURE.md → Focus across store re-renders; Focus after a save or delete)
- **`app.ts` passes the same `ListFilter` object on every re-render** until the next Show; a drill-down is spotted by identity. (details: docs/ARCHITECTURE.md → Drill-downs)
- **Save failures wait for a safe moment.** CONFLICT questions wait in `whenSafeToAsk` (no open dialog, no Friday display); error toasts raised under a dialog wait in `whenNoDialogOpen`; a Reopen toast never expires. (details: docs/ARCHITECTURE.md → Save failures; Toasts)
- **Friday display mode never prompts for sign-in on its own.** It refreshes only while `auth.hasFreshToken()`, holds prompts with `auth.suppressPrompts()`, and its entry refresh must stay after that call. Its figure stays Total received. (details: docs/ARCHITECTURE.md → Friday display)
- **Goal figures round down**, via `flooredGoalFraction`/`formatWholeDollars`, for any new goal figure too. (details: docs/ARCHITECTURE.md → Goal figures)
- **Forms opened from a closing form build from `deps.store.state()`**, not render-time state (Save and log a payment, Save and add another). Nothing is remembered between runs. (details: docs/ARCHITECTURE.md → Save and log a payment; Save and add another)
- **Payment phone hints only suggest.** `nearMatches` never applies a number or touches the match key or join. (details: docs/ARCHITECTURE.md → The payment form's hints)
- **Newest first lives in the two views**, not the shared `sortRows`; the engine's first-row join is untouched. (details: docs/ARCHITECTURE.md → Order: newest first)
- **Never hide the column headings without the phone Sort by list**, and keep `PHONE_WIDTH_QUERY` equal to the stacked-card breakpoint in `components.css`. (details: docs/ARCHITECTURE.md → Sorting; Paging)
- **Download this list saves exactly the rows `drawTable` drew**; never filter a second time. (details: docs/ARCHITECTURE.md → Download this list)
- **Export:** keep `($)` on every money label; find Summary rows by label, never cell address; Download .xlsx refreshes first and builds from `store.state()`; upgrade SheetJS CE by editing its CDN URL in `package.json`, never `npm install xlsx`. (details: docs/ARCHITECTURE.md → The .xlsx export; Download .xlsx refreshes first; Timestamps and confidentiality)
- **Status regions:** never put a button inside a `role=status` region, and rewrite status text only when it changes. `.visually-hidden` is the one screen-reader-only class. (details: docs/ARCHITECTURE.md → Screen-reader announcements)

### Styling, install and tests

- **Colour literals live only in `web/src/styles/tokens.css`** (from `DESIGN.md`). Exceptions: `web/index.html`'s two `theme-color` metas and `web/public/manifest.webmanifest`'s `background_color`/`theme_color` copy `--color-bg` (light `#fbf9f3`, dark `#15110a`), so change them together with the token; the icon SVGs hard-code colours, and changing them means re-rasterising the PNGs by hand. Keep each token a `--name: #rrggbb;` literal for the contrast test. (details: docs/ARCHITECTURE.md → Colour tokens and their copies; Contrast)
- **Focus clearance:** raise the `scroll-padding` if the nav or a dialog footer grows; never give a jump target a `scroll-margin`. (details: docs/ARCHITECTURE.md → Focus not obscured)
- **No service worker.** It would keep serving stale JS after a `Code.gs` wire change; the manifest and icons alone make the app installable. (details: docs/ARCHITECTURE.md → Installable, no service worker)
- **Help drift test.** `test/ui/help.test.ts` fails when a message the Help quotes or a figure it gives no longer matches the code; change the guide in the same commit as the code. (details: docs/ARCHITECTURE.md → Help and its drift test)
- **jsdom dialogs fire `close` a task later**, as browsers do; assert a close handler's effects with `vi.waitFor`. (details: docs/ARCHITECTURE.md → Unit tests)
- **Tests run in America/New_York**; give an e2e fixed clock an explicit offset. (details: docs/ARCHITECTURE.md → Time zones in tests)
- **`@axe-core/playwright` is pinned exactly**; bump it on purpose and fix what it finds. (details: docs/ARCHITECTURE.md → End-to-end (Playwright))
- **Base path:** `VITE_BASE` comes from the repository name in `pages.yml`; `PRODUCTION_BASE` in `e2e/support/production.ts` copies it, so update it on a rename. (details: docs/ARCHITECTURE.md → Base path)
- **The Pages build refuses broken repository variables**; keep accepting both `/macros/s/…` and `/a/macros/<domain>/s/…` URLs. Run `test/pagesWorkflow.test.ts` from Git Bash on Windows. (details: docs/ARCHITECTURE.md → Repository variable check)

## Adding a field

No new field is planned (the design spec fixes the schema), but a Pledges or Payments field touches all of these. The compiler and tests catch only some; check the rest by hand. (background: docs/ARCHITECTURE.md → Adding a field: background)

1. `web/src/types.ts`: the record and its `PledgeDraft`/`PaymentDraft`, then whatever the compiler flags (the form's `read()`, typed test drafts, `web/src/demo.ts` seed builders).
2. Validation: `web/src/validate.ts` and `validateRow_` in `Code.gs`, plus a case in `test/support/validationCases.ts`.
3. `Code.gs`: `HEADERS` and `ENTRY_FIELDS`, plus `AMOUNT_FIELDS` or `DATE_FIELDS` for an amount or a date. Put the field between `id` (always first) and `updatedAt, updatedBy` (always the last two, adjacent), and use the same order in `PLEDGE_COLUMNS`/`PAYMENT_COLUMNS`. In `test/server/code.test.ts`, add it to that file's column lists and untyped `pledgeDraft`/`paymentDraft`, and raise the hard-coded `8`s in the history-restore tests. Add it to the `aisha`/`bilal` drafts in `e2e/production-bundle.spec.ts`, which only the e2e job sees.
4. The live Sheet, by hand, in the same sitting as the deploy: insert the column at its `HEADERS` position, header in row 1, in the tab *and* its `… history` tab. Update "first 8 cells" in `helpView.ts`, `docs/SETUP.md`, the design spec, `docs/ARCHITECTURE.md` (History tabs) and this file's history-tab rule (Hard rules), and add the column to the design spec's §3 table.
5. The screens: the form (`pledgeForm.ts`/`paymentForm.ts`), the list's `COLUMNS` (`pledgesView.ts`/`paymentsView.ts`), `lookupView.ts`, `web/src/ui/export.ts`, and the field help (`web/src/ui/help.ts` for the form, plus a row in the matching `terms(...)` list in `helpView.ts`'s "Record a new pledge"/"Log a payment" topics, which `test/ui/help.test.ts` requires).
6. Raise `API_VERSION` and append the new hash to `CODE_GS_HASHES`. Deploy `Code.gs` and insert the Sheet column in the same sitting, then the site straight after; never the site first. Tabs still on the old site fail every save until they reload, so roll out when nobody is entering data, or for one release have `validateRow_` accept an absent field (blank on a create, stored value kept on an edit).

`api.ts` needs nothing: `draftMatches` already compares every key of the draft.

## Testing the engine against the frozen fixture

`test/fixtures/parity-input.json` and `parity-expected.json` are a frozen expected-values fixture: 22 pledges, 27 payments and 10 Find-donor lookups covering every awkward case the engine must handle (float dust, one phone number spelled four ways, a leading zero next to the same digits without one, a pledge and a payment whose phones are only punctuation (both blank, so they don't join), a donor with a phone but no Amount Pledged, a donor with no name, an overpayment, a duplicated donor). `test/engine/parity.test.ts` asserts `web/src/engine` reproduces them exactly (cents for money, ISO dates for dates, exact status/warning strings). It's ordinary committed test data, with no generator script or external file behind it; change it only when deliberately changing the engine's rules. `possibleDuplicatePayments` (app-only) is excluded from it. The match key's Unicode, invisible-mark, Arabic-digit and `+1` handling and Possible duplicate payments are pinned only by unit tests (`test/foundation.test.ts`, `test/engine/summary.test.ts`). (details: docs/ARCHITECTURE.md → The parity fixture)

## Version control

`.gitignore` blanket-ignores `*.xlsx`, `*.docx` and Office lock files (`~$*`), so an app export or a stray copy of the spreadsheet this project's rules were originally modelled on can never be committed by accident.

## Conventions

- Keep volunteer-facing wording plain — most users have no spreadsheet experience.
- Requires Node 22.22.2+ on the 22 line, 24.15+, or 26+ (the `jsdom` dev dependency's engine requirement).
