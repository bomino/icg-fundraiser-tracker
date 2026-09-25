# ICG Fundraiser Tracker

A web app for masjid fundraiser volunteers. Volunteers sign in with Google and record pledges and payments, and see the same live totals, statuses and data-health checks from any device.

- **Setup:** see [docs/SETUP.md](docs/SETUP.md).
- **Volunteer guide:** built into the app. The **Help** tab explains every screen, status, warning and error message in plain language.
- **Design:** [docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md](docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md), plus [DESIGN.md](DESIGN.md) for the visual system.

## Features

- **Pledges, Payments and Summary**, with totals, statuses and data-health checks verified against a frozen test fixture (`test/engine/parity.test.ts`).
- **Donor lookup** by phone number (any formatting) or name, with a card showing a donor's pledge, payments and status. From the card, **Log a payment** carries the phone number straight into the payment form, **Edit pledge** opens the donor's pledge, and tapping a payment opens it for editing.
- **Status chips and Needs follow-up** on Pledges: filter to Pending/Partial/Paid/Overpaid, or to Pending/Partial donors with no activity in 30+ days, biggest balance first. A **date range** filter on Payments.
- **A possible-duplicate-payments check** (app-only, on top of the six core data-health checks) flags payments that share a phone number, amount and date. The payment form warns about the same match while the payment is being typed in, and shows what the donor still owes.
- **Friday display**: a full-screen, name-free projector view of progress toward the goal, titled with the drive's name from the Sheet's Settings tab, that never interrupts an announcement with a sign-in prompt.
- **Sign out for shared computers**: Sign out lands on a signed-out page rather than a fresh sign-in prompt, and tells a volunteer on a shared computer to close their Guest or private window or sign out of Google too, since the app can't end their Google session itself.
- **Installable**: Add to Home Screen for the ICG icon, on iPhone and Android.
- **Resilient saves**: a save is retried automatically if Google's servers hiccup, the sheet is busy with other saves, or the connection drops for a moment; a stalled request times out instead of hanging; a retry that actually landed is recognised rather than resurfaced as an error; and Sign out, or closing the tab on a computer, asks first while a change is still saving.
- **No lost typing**: Cancel, Escape or Back on a form with anything typed in it asks "Discard what you typed?" before closing it.
- **Phone corrections that don't strand payments**: changing the phone number on a pledge says how many payments were logged under the old number, and how to move them to the new one, before anything is saved.
- **Near-miss phone numbers**: when a payment's number is on no pledge but is one digit off a donor's, has two digits swapped, or is the same 10-digit number with a country code or a leading 0 in front of only one of them, the payment form asks "Is this from …?" and fills in that donor's number on a tap, never by itself.
- **Pledge and pay at once**: a new pledge's **Save and log a payment** saves it and opens the payment form already matched to that donor, with the cursor in the amount, so the phone number is typed only once. Any payment form opened for a known donor starts in the amount too.
- **Save and add another** on a new pledge or payment: saves it and opens an empty form for the next one, keeping the date (and the payment method), for typing up a stack of cards or envelopes.
- **Change history**: every edit or delete first copies the old row, with who changed it and when, to a history tab in the Sheet, so the organiser can bring back a row deleted by mistake without rolling back anyone else's work.
- **Starting the next drive**: a menu in the Sheet keeps a finished drive's records in tabs named for it and empties the live tabs for the next one, keeping their column names.
- **Safe corrections in the Sheet**: a fix the organiser types straight into a pledge or payment marks the row as changed, so a volunteer holding an older copy is asked to reload instead of saving over it.
- **Deploy check**: after every load the app compares its version with the deployed Apps Script, and while the two are out of step shows a strip asking the organiser to redeploy `Code.gs`, or the volunteer to reload the page. The GitHub deploy also stops, leaving the live site as it was, when either repository variable is missing or isn't the right kind of value, and a site and `Code.gs` set up with different Google sign-in IDs say so instead of asking volunteers to sign in again.
- **Paging at scale**: long lists show 100 rows with a "Show more" button; search, sort and filters still cover every row.

```bash
npm install
npm run dev      # local app: open /?demo (see Demo mode below)
npm run check    # typecheck + tests + build
```

Requires Node 22.22.2+ on the 22 line, 24.15+, or 26+ (the `jsdom` dev dependency's engine requirement; `npm install`/`npm test` warn outside that range).

## Demo mode

To look at every screen without a Google account or a deployed Apps Script backend, run `npm run dev` and open <http://localhost:5173/?demo>. It loads an in-memory API seeded with made-up donors and skips Google sign-in entirely. Demo mode is dev-only: the code behind it is excluded from production builds. Running the local app against the real Sheet is covered under Local development in [docs/SETUP.md](docs/SETUP.md#local-development).

## Browser smoke tests

`e2e/*.spec.ts` are [Playwright](https://playwright.dev) specs that drive demo mode in a real Chromium browser (add a pledge, log a payment, including from an open pledge, Escape and Cancel on a half-typed form, filter Pledges/Payments, the Friday display, layout on 360px and 320px phones, keyboard focus kept clear of the sticky header and a dialog's pinned buttons, and an [axe](https://github.com/dequelabs/axe-core) accessibility scan of every tab in both themes). One spec, `e2e/production-bundle.spec.ts`, loads the production build instead, at the same `/icg-fundraiser-tracker/` path GitHub Pages serves it from, with Google sign-in and the Apps Script backend stubbed (the backend stub is `apps-script/Code.gs` itself, run in Node). It checks that the app starts with no console errors, that an account missing from the volunteer list is told so, and that a "someone else changed this row" question waits until the volunteer's next form is closed. They are separate from the unit tests: `npm run check` never runs them, and they don't run under `npm test`. In CI they are their own `e2e` job, which the Pages deploy doesn't wait for: a failure turns the run red and sends GitHub's failed-run email, but the site still deploys.

```bash
npx playwright install chromium   # once, downloads a browser
npm run test:e2e
```

`test:e2e` starts its own Vite dev server on a fixed port (5199), builds the production bundle into a temp folder and serves it with `vite preview` on 5299, and tears both down afterwards, so it's safe to run alongside `npm run dev` on 5173 and never touches your own `dist/`. Set `E2E_PORT` to move both ports (the preview always uses the port 100 above it). On failure, open `playwright-report/index.html` for traces and screenshots.

## Previewing a production build

```bash
npm run build
npx vite preview --port 4173
```

The project's Vite root is `web/`, so don't pass `--outDir` to `vite preview` — it already knows where `npm run build` wrote the output.
