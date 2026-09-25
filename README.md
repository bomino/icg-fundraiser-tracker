# ICG Fundraiser Tracker

A web app for masjid fundraiser volunteers. Volunteers sign in with Google and record pledges and payments, and see the same live totals, statuses and data-health checks from any device.

- **Setup:** see [docs/SETUP.md](docs/SETUP.md).
- **Volunteer guide:** built into the app. The **Help** tab explains every screen, status, warning and error message in plain language.
- **Design:** [docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md](docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md), plus [DESIGN.md](DESIGN.md) for the visual system.

## Features

- **Pledges, Payments and Summary**, with totals, statuses and data-health checks verified against a frozen test fixture (`test/engine/parity.test.ts`).
- **Donor lookup** by phone number (any formatting) or name, with a card showing a donor's pledge, payments and status — and a **Log a payment** button that carries the phone number straight into the payment form.
- **Status chips and Needs follow-up** on Pledges: filter to Pending/Partial/Paid/Overpaid, or to Pending/Partial donors with no activity in 30+ days, biggest balance first. A **date range** filter on Payments.
- **A possible-duplicate-payments check** (app-only, on top of the six core data-health checks) flags payments that share a phone number, amount and date.
- **Friday display**: a full-screen, name-free projector view of progress toward the goal, titled with the drive's name from the Sheet's Settings tab, that never interrupts an announcement with a sign-in prompt.
- **Installable**: Add to Home Screen for the ICG icon, on iPhone and Android.
- **Resilient saves**: a save is retried automatically if Google's servers hiccup, and a retry that actually landed is recognised rather than resurfaced as an error.
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

`e2e/*.spec.ts` are [Playwright](https://playwright.dev) specs that drive demo mode in a real Chromium browser (add a pledge, log a payment, filter Pledges/Payments, the Friday display, layout at 360px). They are separate from the unit tests: `npm run check` never runs them, and they don't run under `npm test`.

```bash
npx playwright install chromium   # once, downloads a browser
npm run test:e2e
```

`test:e2e` starts its own Vite dev server on a fixed port (5199) and tears it down afterwards, so it's safe to run alongside `npm run dev` on 5173. On failure, open `playwright-report/index.html` for traces and screenshots.

## Previewing a production build

```bash
npm run build
npx vite preview --port 4173
```

The project's Vite root is `web/`, so don't pass `--outDir` to `vite preview` — it already knows where `npm run build` wrote the output.
