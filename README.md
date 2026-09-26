# ICG Fundraiser Tracker

A web app for masjid fundraiser volunteers. Volunteers sign in with Google and record pledges and payments, and see the same totals, statuses and data-health checks from any device. Other volunteers' changes show up when someone presses **Refresh**, or on their own when a volunteer comes back to the tab more than 2 minutes after the last load. The Friday display refreshes itself every 3 minutes.

- **Setup:** see [docs/SETUP.md](docs/SETUP.md).
- **Volunteer guide:** built into the app. The **Help** tab explains every screen, status, warning and error message in plain language.
- **Design:** [docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md](docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md), plus [DESIGN.md](DESIGN.md) for the visual system.
- **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the maintainer's reference for how each part works and why.

## Features

- **Pledges, Payments and Summary**, with totals, statuses and data-health checks verified against a frozen test fixture (`test/engine/parity.test.ts`).
- **Donor lookup** by phone number (any formatting, whole or just the last few digits) or name, with a card showing a donor's pledge, payments and status. From the card, **Log a payment** carries the phone number straight into the payment form, **Edit pledge** opens the donor's pledge, and tapping a payment opens it for editing. When nobody matches, **Add a pledge** opens the pledge form with the searched number filled in; on a list not refreshed for a couple of minutes, it first suggests pressing Refresh, in case another volunteer has just added that donor. **Print** turns the card into a statement of what the donor has paid so far, without the notes and warnings written for volunteers.
- **Status chips and Needs follow-up** on Pledges: filter to Pending/Partial/Paid/Overpaid, or to Pending/Partial donors with no payment or saved pledge change in 30+ days, biggest balance first. A **date range** filter on Payments, with **Today** and **This week** (Saturday to today) buttons; while any filter is on, Payments adds up the money in the rows shown and splits it by method, for counting the cash box at the end of a night or announcing what came in this week.
- **Tap to call**: **Call** and **Text** buttons under the phone number when editing a pledge, and a tappable number on the Find donor card. A note saved after a call ("Called 24 Sep – paying Friday") takes the donor off Needs follow-up for 30 days.
- **A possible-duplicate-payments check** (app-only, on top of the six core data-health checks) flags payments that share a phone number, amount and date. The payment form warns about the same match while the payment is being typed in, and shows what the donor still owes.
- **Friday display**: a full-screen, name-free projector view of progress toward the goal, titled with the drive's name from the Sheet's Settings tab, that never interrupts an announcement with a sign-in prompt.
- **Sign out for shared computers**: Sign out lands on a signed-out page rather than a fresh sign-in prompt, and tells a volunteer on a shared computer to close their Guest or private window or sign out of Google too, since the app can't end their Google session itself.
- **Installable**: Add to Home Screen for the ICG icon, on iPhone and Android.
- **Resilient saves**: a save is retried automatically if Google's servers hiccup, the sheet is busy with other saves, or the connection drops for a moment; a stalled request times out instead of hanging; a retry that actually landed is recognised rather than resurfaced as an error; and Sign out, or closing the tab on a computer, asks first while a change is still saving.
- **No lost typing**: Cancel, Escape or Back on a form with anything typed in it asks "Discard what you typed?" before closing it.
- **Phone corrections that don't strand payments**: changing the phone number on a pledge says how many payments were logged under the old number, and how to move them to the new one, before anything is saved.
- **Near-miss phone numbers**: when a payment's number is on no pledge but is one digit off a donor's, has two neighbouring digits swapped, or is the same 10-digit number with a country code (other than the US +1, which already matches) or a leading 0 in front of only one of them, the payment form asks "Is this from …?" and fills in that donor's number on a tap, never by itself.
- **Pledge and pay at once**: a new pledge's **Save and log a payment** saves it and opens the payment form already matched to that donor, with the cursor in the amount, so the phone number is typed only once. Any payment form opened for a known donor starts in the amount too.
- **Save and add another** on a new pledge or payment: saves it and opens an empty form for the next one, keeping the date (and the payment method), for typing up a stack of cards or envelopes.
- **Change history**: every edit or delete first copies the old row, with who changed it and when, to a history tab in the Sheet, so the organiser can bring back a row deleted by mistake without rolling back anyone else's work.
- **Starting the next drive**: the Sheet's **Fundraiser tracker** menu keeps a finished drive's records in tabs named for it and empties the live tabs for the next one, keeping their column names.
- **Bringing in an earlier list**: the same menu's **Add selected rows to the tracker…** brings in pledges and payments pasted into the Pledges or Payments tab with column A (`id`) left empty. It checks every selected row the way a save is checked, plus the mistakes a paste makes without warning (a date or amount the Sheet can't read, a phone number that lost its leading 0). If any row has a problem it changes nothing and lists the problems; otherwise, after one confirmation, it gives every selected row an `id` so the app counts it (see [docs/SETUP.md](docs/SETUP.md#bringing-in-a-list-kept-outside-the-tracker)).
- **Safe corrections in the Sheet**: a fix the organiser types straight into a pledge or payment marks the row as changed, so a volunteer holding an older copy is asked to reload instead of saving over it.
- **Deploy check**: after every load the app compares its version with the deployed Apps Script, and while the two are out of step shows a strip asking the organiser to redeploy `Code.gs`, or the volunteer to reload the page. The GitHub deploy also stops, leaving the live site as it was, when either repository variable is missing or isn't the right kind of value, and a site and `Code.gs` set up with different Google sign-in IDs say so instead of asking volunteers to sign in again.
- **Paging at scale**: lists start with the most recently added entry, so a row you have just added is at the top; long lists show 100 rows (25 on a phone) with a "Show more" button; search, sort and filters still cover every row.
- **Sorting on any screen**: tap a column heading (an arrow shows the direction), or on a phone pick from the **Sort by** list above the table.
- **Downloads**: **Download .xlsx** on **Summary** refreshes first, then saves the Summary, Pledges and Payments as a formatted Excel workbook for the treasurer. It is a readable record, not a backup (see [docs/SETUP.md](docs/SETUP.md)). While a filter is on, **Download this list** on Pledges or Payments saves every matching row in the order shown, including rows still behind Show more, plus a sheet saying what the list was filtered to and what it adds up to. It saves what is on screen without refreshing first. A printed list names its filter too.

```bash
npm install
npm run dev      # local app: open /?demo (see Demo mode below)
npm run check    # typecheck + tests + build
```

Requires Node 22.22.2+ on the 22 line, 24.15+, or 26+ (the `jsdom` dev dependency's engine requirement; `npm install` warns with `EBADENGINE` outside that range, while CI installs with `--engine-strict` and fails there instead).

## Releasing

Pushing to `main` runs **Test and deploy** (`.github/workflows/pages.yml`), which runs `npm run check`, checks the two repository variables and publishes the site to GitHub Pages. CI never deploys `apps-script/Code.gs`. After any edit to it, even a comment, set `const API_VERSION` one higher and add the hash that the failing test in `test/server/code.test.ts` prints to the end of `CODE_GS_HASHES`. Then paste the file into the Apps Script editor and deploy it with **Deploy → Manage deployments → ✎ → Version: New version**, putting the commit's short id in the Description (or push it from your own computer with clasp, as [docs/SETUP.md](docs/SETUP.md) describes). Do this before you push the site change to `main`. See [docs/SETUP.md](docs/SETUP.md) step 3 and "Undoing a bad update".

## Demo mode

To look at every screen without a Google account or a deployed Apps Script backend, run `npm run dev` and open <http://localhost:5173/?demo>. It loads an in-memory API seeded with made-up donors and skips Google sign-in entirely. Demo mode is dev-only: the code behind it is excluded from production builds. Add `&big` (`/?demo&big`) for an event-scale seed of 1,500 pledges and 3,000 payments, the same every run, for checking paging and speed (see `npm run perf` below). Running the local app against the real Sheet is covered under Local development in [docs/SETUP.md](docs/SETUP.md#local-development).

## Browser smoke tests

`e2e/*.spec.ts` are [Playwright](https://playwright.dev) specs that drive demo mode in a real Chromium browser (add a pledge, log a payment, including from an open pledge, a save's in-flight "Saving…" state and Sign out asking first during it, Save and log a payment, Save and add another, focus returning after a keyboard Save, Escape and Cancel on a half-typed form, filter and sort Pledges/Payments, a long list drawn 25 cards at a time on a phone and 100 rows on a wide screen, Download this list and printing, the Friday display, the signed-out page, layout on 360px and 320px phones, keyboard focus kept clear of the sticky header, a dialog's pinned buttons and a failed save's toast, and an [axe](https://github.com/dequelabs/axe-core) accessibility scan of every tab in both themes at 360px and in the light theme at 320px). One spec, `e2e/production-bundle.spec.ts`, loads the production build instead, at the same `/icg-fundraiser-tracker/` path GitHub Pages serves it from, with Google sign-in and the Apps Script backend stubbed (the backend stub is `apps-script/Code.gs` itself, run in Node). It checks that the app starts with no console errors, that an account missing from the volunteer list is told so, and that a "someone else changed this row" question waits until the volunteer's next form is closed. They are separate from the unit tests: `npm run check` never runs them, and they don't run under `npm test`. In CI they are their own `e2e` job, which the Pages deploy doesn't wait for: a failure turns the run red and sends GitHub's failed-run email, but the site still deploys.

```bash
npx playwright install chromium   # once, downloads a browser
npm run test:e2e
```

`test:e2e` starts its own Vite dev server on a fixed port (5199), builds the production bundle into a temp folder and serves it with `vite preview` on 5299, and tears both down afterwards, so it's safe to run alongside `npm run dev` on 5173 and never touches your own `dist/`. Set `E2E_PORT` to move both ports (the preview always uses the port 100 above it). On failure, run `npx playwright show-report` to open the report and each failed test's trace. A trace won't open from `index.html` opened directly as a file. In CI, each failing test is retried once (a pass on retry shows as flaky), and a failed `e2e` job uploads the report as a `playwright-report` artifact on the run's summary page, kept for 7 days. Download and unzip it, then run `npx playwright show-report <unzipped folder>`.

`npm run perf` (`e2e/perf-probe.ts`) is a separate script that neither `test:e2e` nor CI runs. It starts its own dev server on port 5301 and prints timings at event scale, compute at 1,500 pledges / 3,000 payments, first page rendered (demo mode's `?demo&big` seed, plus `&instant` so no figure includes the demo's simulated 300 ms server delay), with and without CPU throttling, on a wide screen and on a phone. Each browser loads the page once, untimed, before anything is timed. It needs `npx playwright install chromium` and has no pass/fail check.

## Previewing a production build

```bash
npm run build
npx vite preview --port 4173
```

The project's Vite root is `web/`, so don't pass `--outDir` to `vite preview` — it already knows where `npm run build` wrote the output.

The build takes `VITE_SCRIPT_URL` and `VITE_GOOGLE_CLIENT_ID` from your environment or from `.env.local` in the repo root. Without them, the preview shows only the *Not set up yet* screen, and `?demo` does nothing because demo mode exists only in a dev build. With them, the preview signs in to the live Sheet and its real donor data. That works only while `http://localhost:5173` and `http://localhost` are temporarily authorised, as described under Local development in [docs/SETUP.md](docs/SETUP.md#local-development). So stop `npm run dev` first, preview with `npx vite preview --port 5173 --strictPort` rather than 4173, and remove the origins again when you're done. To check that the production bundle starts without real credentials, run `npx playwright test --project production`, which runs `e2e/production-bundle.spec.ts` against a freshly built bundle with sign-in and the backend stubbed, served under the Pages base path.

`npm run build` uses base `/` unless `VITE_BASE` is set. CI builds with `/<repository name>/`, the path GitHub Pages serves the site from.
