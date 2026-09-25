# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A web app for masjid fundraiser volunteers to record pledges and payments from any device and see the same live totals. `web/` (Vite + TypeScript) is the client; `apps-script/Code.gs` is the backend, running as a Google Apps Script web app backed by a private Google Sheet that only allowlisted Google accounts can reach. `npm run check` (typecheck, all tests, build) is the gate.

- **Setup:** `docs/SETUP.md`.
- **Design spec:** `docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md`. Visual system: `DESIGN.md`.
- **Volunteer guide:** built into the app (the **Help** tab, `web/src/ui/helpView.ts`), not a separate document.

The engine's business rules were originally modelled on a volunteer-maintained Excel spreadsheet; that spreadsheet is a separate project and not part of this repo. The rules below are this app's own, and are checked against a frozen test fixture (`test/fixtures/`), not against any external file.

## Engine rules

`web/src/engine/` is a pure module (no DOM, no network). Money is handled internally in integer cents. "Blank" means the field is empty; it is not zero, and the two are tracked separately throughout.

Three logical tables: Pledges (donor dimension), Payments (transaction fact), Summary (derived, read-only totals). They join on a **normalized match key**, not the raw phone number.

### The match key

`web/src/matchKey.ts` strips `-`, `(`, `)`, `.`, `+`, any whitespace (tabs and non-breaking spaces included) and Unicode dashes (`‐`–`―`, `−`), lower-cases, and prefixes the result with `#`. Three details are deliberate:

- **The `#` prefix is required.** Without it, a key like `0551234` could be coerced to a number and collide with `551234`. Keep any new key logic text-prefixed.
- **A blank phone gets a blank key, and every join must guard on that**, not just match on `""` — otherwise a pledge with no phone would match every payment that also lacks one.
- **A phone with nothing left after stripping (`--`, `()`, `" "`) is blank too**, never a bare `#`, or every such placeholder would join every other one. Anything deciding "has a phone" must test `matchKey(phone) === ''`, not the raw text: the missing-phone health check, the Payments blank-phone validation (and its copy, `PHONE_IGNORED` in `Code.gs`), and the "Log a payment" buttons all do.

### Statuses

Four literal values, set only when Amount Pledged is filled in (a blank amount has no status): nothing received → `Pending`, whatever was pledged; otherwise `round(received - pledged, 2) > 0` → `Overpaid`; `= 0` → `Paid`; else `Partial`. So a `0` pledge reads `Pending` until money arrives, then `Overpaid`. The rounding is deliberate — exact float equality would leave cent-level residues stuck on `Partial` (e.g. 0.1 + 0.2 against a 0.30 pledge should read `Paid`). Summary's status counts are `count`s over those four literal strings, so renaming a status breaks the counts.

### The two ⚠ warnings

Every "this payment is not counted" signal keys off a leading `⚠` (`WARNING_MARK` in `web/src/engine/constants.ts`) — any new warning must start with it, and a donor name never may (`validate.ts` and `Code.gs` reject such names). The two warnings:

- `⚠ phone not in Pledges` — no match-key match, including a blank phone (only possible for a row typed straight into the Sheet, since both validators refuse it), so such a payment shows red, counts under "Payments not matched to a pledge" and exports as not counted instead of vanishing from every check.
- `⚠ no amount on Pledges` — matched donor has a blank Amount Pledged, so the payment doesn't count toward that donor's Amount Received.

A blank (never `0`) is shown for a matched-but-nameless donor.

### Outstanding excludes credits

The outstanding total sums only positive per-donor balances, not `pledged - received` overall, so one donor's overpayment credit can never mask another donor's real debt; the credit is reported as a separate figure.

### Duplicate donors double-count, by design

A donor entered on two Pledges rows has their payments counted once per row — both rows show the full received amount, inflating totals and usually producing a phantom `Overpaid` credit. This is inherent to the one-row-per-donor model, not a bug; it's flagged by the "Donors listed more than once" health check, which also drives the unmatched-payments figure negative and can produce a spurious credit.

### Health checks

`computeHealth` in `web/src/engine/summary.ts` returns seven checks. Six are original and covered by the parity fixture; the seventh is app-only (v1.1) and excluded from it (see "Testing the engine" below):

1. Payments not matched to a pledge
2. Donors listed more than once
3. Pledges missing a phone number
4. Payments missing a date or amount
5. Payments dated in the future
6. Donors whose payments predate their pledge — compares only each donor's *latest* payment date, so one mis-dated payment among several isn't caught. Exact per-payment coverage would need a lookup per row, which costs too much at this data's scale. The future-date check (#5) is exact.
7. *(app-only)* Possible duplicate payments — flags payments that share a phone number, amount and date.

## The web app

- **Validation lives in two places.** It's in `web/src/validate.ts` and in `validateRow_` in `Code.gs`, and `test/support/validationCases.ts` runs against both. Change them together. Both sides check every field's length before the Payments-only blank-phone check runs, so a phone that is both blank and overlong reports as overlong on both.
- **Code.gs is tested in Node** (`test/support/appsScript.ts` fakes the Apps Script services). After editing it, paste it into the Apps Script editor and deploy a **new version** of the existing deployment, so the URL doesn't change.
- **The client names new rows.** A create is an upsert with a `crypto.randomUUID()` id and *no* `updatedAt`; `upsert_` requires a UUID there and, if that id already exists with the same entry values, returns the row unchanged, so a Save retried after a lost response cannot add a duplicate; differing values answer `CONFLICT` with the saved row as `current`. Each opened form keeps one id across retries, and a form reopened from a failed-save toast is the same open (it reuses that id). An update carries `updatedAt` and is version-checked as before. This changed the wire contract: an older `Code.gs` deployment treats the id as an update and answers `NOT_FOUND`, so deploy the new version together with the site (see Troubleshooting in `docs/SETUP.md`).
- **Text written to the Sheet is apostrophe-prefixed** (`toSheetRow_`) — the only text-forcing mechanism. This keeps leading zeros and `+`, and stops formula injection. Don't remove it, and don't also format the Pledges/Payments data columns as **Plain text** in the Sheet UI: a Plain text cell stores the apostrophe literally instead of hiding it, which corrupts ids, phone numbers and dates.
- **Hand-typed dates are read in the spreadsheet's own time zone** (`fromCell_` uses `getSpreadsheetTimeZone()`). Non-ISO text typed directly into a date column loads as blank in the app rather than as an unparseable string.
- **A missing `CLIENT_ID` script property is reported as `INTERNAL` "The server is not configured…"**, not as an expired sign-in (`clientId_()` in `Code.gs`). A failed `fetch` on an online device adds a hint about the deployment's "Anyone" access, because that misconfiguration looks like a network error to the browser.
- **The server rejects a token cheaply before calling Google.** `assertPlausibleToken_` checks the token is a well-formed 3-part JWT with the right `aud` before `verifyToken_` spends a network call on `tokeninfo`; `tokeninfo` remains the actual authority.
- **Sign-in is its own modal `<dialog>`** (`web/src/auth.ts`). A form dialog makes the rest of the page inert, so a sign-in requested while one is open must open *after* it in the top layer. (Saves now finish in the background, so a mid-save sign-in usually opens with no form dialog at all.) Dismissing it rejects every waiting `getToken` with `UNAUTHENTICATED` "Sign-in was cancelled." (the API does not retry that), and `refreshIfStale()` renews a token within 5 minutes of expiry on any click in `main` and when the tab becomes visible.
- **Other volunteers' changes arrive only on a reload.** The nav's **Refresh** button calls `store.load()`; returning to the tab reloads automatically when the last load (`store.lastLoadedAt()`) is over 2 minutes old, but never while any `<dialog open>` exists. Any focused control inside `main` with a `data-focus-key` (list searches, the Payments date inputs, the phone **Sort by** list) keeps focus across store re-renders (`focusedKey`/`restoreFocus` in `app.ts`); inputs keep their text and caret too. A Data-health **Show** instead starts the list clean (search, status chip, date range). The lists spot a new drill-down by the `ListFilter` object's identity, not its label, so tapping Show again on the same check still clears them. That means `app.ts` must pass the same object on every re-render until the next Show, or each store publish would wipe the search.
- **A dev-only demo mode** exists for visual checks without Google sign-in or a deployed backend: `npm run dev`, then open `http://localhost:5173/?demo` (`web/src/demo.ts`, dynamically imported so it is excluded from production builds).
- **Styling** comes only from `web/src/styles/tokens.css` (from `DESIGN.md`). No other file contains colour literals, with one unavoidable exception: `web/index.html`'s two `theme-color` metas and `web/public/manifest.webmanifest`'s `background_color`/`theme_color` cannot reference CSS variables, so they hold copies of `--color-bg` (light `#fbf9f3`, dark `#15110a`). Change them together with the token.
- **Friday display mode never prompts for sign-in on its own** (`web/src/ui/displayView.ts`, `mountDisplay`). It only refreshes while `auth.hasFreshToken()` is true, and holds sign-in prompts back for as long as it's mounted (`auth.suppressPrompts()`), released on exit or on a manual reconnect. This exists because the mode's whole purpose is a projector announcement view: an unrequested Google sign-in dialog popping up over the figures mid-khutbah is the one failure it must never cause. A tap on the stale note is the one path that can still prompt — the volunteer is present and gains a fresh hour.
- **The Needs-follow-up rule lives in `web/src/engine/followUp.ts`** (`needsFollowUp`, `FOLLOW_UP_AFTER_DAYS = 30`): a Pending or Partial pledge qualifies once the later of its last payment date and its pledge date is more than 30 days before "today". It is pure and date-injected, like the rest of the engine — see `dates.ts` `todayIso()`.
- **A Playwright e2e suite** (`e2e/*.spec.ts`) drives demo mode in real Chromium (add a pledge, log a payment, a save's in-flight "Saving…" state under a paused `page.clock`, filter Pledges/Payments, sort by heading and by the phone's Sort by list, the Friday display, layout at 360px). Run it with `npx playwright install chromium` once, then `npm run test:e2e`; it starts and tears down its own dev server on a fixed port, so it's safe alongside `npm run dev`. It's a separate CI job (`.github/workflows/pages.yml`'s `e2e` job) that never gates the Pages deploy. `e2e/perf-probe.ts` is a separate, non-CI script — deliberately not matching Playwright's `*.spec.ts` test discovery — that measures render time at event scale (~1,500 rows) in both viewports; run it manually with `npm run perf`.
- **The app is installable but has no service worker** (`web/index.html`, `web/public/manifest.webmanifest` and `icons/`). A service worker would let an already-open tab keep serving cached JS/HTML after `Code.gs` is redeployed with a wire-contract change (see the id/`updatedAt` note above) — exactly the site/`Code.gs` version-skew failure this repo already guards against by requiring both redeployed together. Manifest + icons alone make the app installable (Add to Home Screen, standalone display) while every load still fetches the current site.
- **Pledges and Payments list the most recently added row first until a column is sorted** (`drawTable` in `pledgesView.ts`/`paymentsView.ts`). New rows are appended (`withRow` in `store.ts`, `appendRow` in `Code.gs`) and only the first 100 rows are drawn, so in Sheet order a just-saved row and its "Saving…" state would land out of sight. It's the reverse of the Sheet's row order, not a date sort (a payment can be backdated), so rows inserted mid-Sheet by hand don't come first. The reversal lives in the two views, not in the shared `sortRows`; "Needs follow-up" reverses before its stable balance sort, so ties come out most recently added first. A third tap on a sorted heading (`nextSort` returns `null`) goes back to the default order. The engine's "first Pledges row in Sheet order" join is untouched.
- **Phones sort from a Sort by list, not the column headings** (`sortSelect` in `table.ts`). At 720px and below the table becomes cards and `thead` is `display: none`, not visually clipped, because its sort buttons would otherwise stay as tab stops no one can see; the cards' `data-label`s name every value. The `.sort-by` list replaces them at that width only. Its options each state their direction ("Amount: largest first") and map to one `SortState`, or `null` for "Default order", which keeps "Needs follow-up" biggest balance first. Never hide the headings without the list: it is also the phone screen-reader path. `drawTable` calls its `show(sort)` on every redraw, so a heading sort made on a wide screen shows there too ("Sorted by a column heading" when the list doesn't offer it). On wider screens the sorted heading carries a ▲/▼ arrow (`components.css`) whose alt text is empty, since `aria-sort` already announces it. A table with no `onSort` (Find donor's history) gets plain heading text instead of buttons.
- **Save and Delete close the dialog at once and finish in the background** (`runForm` in `web/src/ui/form.ts`), because an Apps Script round-trip takes 1–16 s. The store's optimistic update shows the change immediately.
  - **In flight.** A row whose save is in flight — create *or* edit — is `isPending` (a per-id count in `store.ts`, incremented once and decremented exactly once in a `finally`, so overlapping saves of one row don't unmark it early and a throwing view can't leave it stuck). `renderTable`'s `pending` option fades it, labels it "Saving…" and refuses to open it, because an edit opened then would carry an `updatedAt` about to be replaced. Once a save has reached the server, a view that throws while redrawing is logged (`publishSettled`), never reported as a failed save.
  - **Failures.** The store has already rolled back. `CONFLICT`/`NOT_FOUND` go to `reportError(err, context)`, which prefixes the Reload question with the interrupted change ("Couldn't save Aisha. Someone else changed…"), asks one at a time (a failed question is logged and never stalls the queue), and waits in `whenSafeToAsk` (`dialog.ts`) until no `<dialog>` is open *and* the Friday display is not showing — so it never lands on the next entry's form, reloads under it, or puts a donor name on the projector. It re-checks one task later before opening, because a dialog's `open` attribute drops before its `close` event, whose handler may open the next form (Log a payment does). Anything else becomes an error toast "Couldn't save <row>. <message>" with **Reopen**, which refills the form exactly as typed (field error inline, focus on it) under the same options, and therefore the same new-row id; an edit reopens on the row's *current* version (`latest`), and Reopen stays disabled while a newer save of that row is pending. A failed delete toasts "Couldn't delete <row>." with no Reopen.
  - **Toasts.** Failures go to an assertive `role=alert` region, confirmations to the polite one. An action toast lasts until dismissed or 30 s; if it expires while a dialog is open (the page behind a modal is inert, and the volunteer is likely typing the next entry), it gets a fresh 30 s from when the last dialog closes. A plain error toast is held the same way (a fresh 8 s); a confirmation is not, since it would be stale by then. Dismissing (or expiry while focused) returns focus to `#main` via a temporary `tabindex` removed on blur; `#main:focus` draws no outline. The 500 ms readiness poll runs only for actions with a `ready` check.
  - **Reloads overlapping changes.** `load()` replays every in-flight save, delete and goal change over the fresh data (`mutations` in `store.ts`). A change that commits while a reload is already running keeps its overlay — now the server's saved row, or the removal — until each such reload has landed, because their snapshot predates the commit: without it a committed create would vanish (and get typed in twice) or a committed edit revert to an old `updatedAt`. A reload started after the commit gets no overlay, so it can show another volunteer's newer version. A failed save or delete falls back to the version the latest reload fetched, not the one it started from. Overlapping loads are ordered: one that lands after a later-started load has published is ignored (its overlay bookkeeping still runs).
- **`api.ts` retries transient failures automatically.** `send()` retries a 404/502/503/504 (Google's echo redirect intermittently 404s after the script already ran) with backoff before surfacing an error. On a retried *update*, a `CONFLICT` whose `current` record already matches the draft being sent (`pledgeMatchesDraft`/`paymentMatchesDraft`) is treated as success, not resurfaced as an error — the first attempt's request landed, only its response was lost. Creates are already safe to retry as-is: they're idempotent by the client-chosen UUID (see the id/`updatedAt` note above).

## Testing the engine against the frozen fixture

`test/fixtures/parity-input.json` and `parity-expected.json` are a frozen expected-values fixture: about 40 pledges and 80 payments covering every awkward case the engine must handle (float dust, one phone number spelled four ways, a leading zero next to the same digits without one, a pledge and a payment whose phones are only punctuation (both blank, so they don't join), a donor with a phone but no Amount Pledged, a donor with no name, an overpayment, a duplicated donor), paired with the values each one should produce. `test/engine/parity.test.ts` asserts `web/src/engine` reproduces them exactly (cents for money, ISO dates for dates, exact status/warning strings). It's ordinary committed test data now — there's no generator script or external file in this repo it's checked against, and no reason it should ever need to change unless you're deliberately changing the engine's rules. `possibleDuplicatePayments` (the app-only, v1.1 health check) has no cells in this fixture and is excluded from the assertions.

## Version control

`.gitignore` blanket-ignores `*.xlsx`, `*.docx` and Office lock files (`~$*`), so an app export or a stray copy of the spreadsheet this project's rules were originally modelled on can never be committed by accident.

## Conventions

- Keep volunteer-facing wording plain — most users have no spreadsheet experience.
- Requires Node 22.22.2+ on the 22 line, 24.15+, or 26+ (the `jsdom` dev dependency's engine requirement).
