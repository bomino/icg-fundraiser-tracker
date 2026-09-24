# ICG Fundraiser Tracker

A web version of `Masjid_Fundraiser_Tracker_v3.xlsx`. Volunteers sign in with Google and record pledges and payments. The totals, statuses and data-health checks work exactly as they do in the workbook.

- **Setup:** see [docs/SETUP.md](docs/SETUP.md).
- **Volunteer guide:** built into the app. The **Help** tab explains every screen, status, warning and error message in plain language.
- **Design:** [docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md](docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md), plus [DESIGN.md](DESIGN.md) for the visual system.

## Features

- **Pledges, Payments and Summary**, matching the workbook's totals, statuses and data-health checks cell for cell (`test/engine/parity.test.ts`).
- **Donor lookup** by phone number (any formatting) or name, with a card showing a donor's pledge, payments and status — and a **Log a payment** button that carries the phone number straight into the payment form.
- **Status chips and Needs follow-up** on Pledges: filter to Pending/Partial/Paid/Overpaid, or to Pending/Partial donors with no activity in 30+ days, biggest balance first. A **date range** filter on Payments.
- **A possible-duplicate-payments check** (app-only, on top of the workbook's six data-health checks) flags payments that share a phone number, amount and date.
- **Friday display**: a full-screen, name-free projector view of progress toward the goal that never interrupts an announcement with a sign-in prompt.
- **Installable**: Add to Home Screen for the ICG icon, on iPhone and Android.
- **Resilient saves**: a save is retried automatically if Google's servers hiccup, and a retry that actually landed is recognised rather than resurfaced as an error.
- **Paging at scale**: long lists show 100 rows with a "Show more" button; search, sort and filters still cover every row.

```bash
npm install
npm run dev      # local app (needs .env.local)
npm run check    # typecheck + tests + build
```

Requires Node >= 22.22 (the `jsdom` dev dependency's engine requirement; `npm install`/`npm test` warn under older Node 22.x patch releases).

## Demo mode

To look at every screen without a Google account or a deployed Apps Script backend, run `npm run dev` and open <http://localhost:5173/?demo>. It loads an in-memory API seeded with made-up donors and skips Google sign-in entirely. Demo mode is dev-only: the code behind it is excluded from production builds.

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
