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
- **Friday display**: a full-screen, name-free projector view of progress toward the goal that never interrupts an announcement with a sign-in prompt.
- **Installable**: Add to Home Screen for the ICG icon, on iPhone and Android.
- **Resilient saves**: a save is retried automatically if Google's servers hiccup, and a retry that actually landed is recognised rather than resurfaced as an error.
- **No lost typing**: Cancel, Escape or Back on a form with anything typed in it asks "Discard what you typed?" before closing it.
- **Phone corrections that don't strand payments**: changing the phone number on a pledge says how many payments were logged under the old number, and how to move them to the new one, before anything is saved.
- **Near-miss phone numbers**: when a payment's number is on no pledge but is one digit off a donor's, has two digits swapped, or differs only by a country code or a leading 0, the payment form asks "Is this from …?" and fills in that donor's number on a tap, never by itself.
- **Pledge and pay at once**: a new pledge's **Save and log a payment** saves it and opens the payment form already matched to that donor, with the cursor in the amount, so the phone number is typed only once. Any payment form opened for a known donor starts in the amount too.
- **Save and add another** on a new pledge or payment: saves it and opens an empty form for the next one, keeping the date (and the payment method), for typing up a stack of cards or envelopes.
- **Paging at scale**: long lists show 100 rows with a "Show more" button; search, sort and filters still cover every row.

```bash
npm install
npm run dev      # local app (needs .env.local)
npm run check    # typecheck + tests + build
```

Requires Node 22.22.2+ on the 22 line, 24.15+, or 26+ (the `jsdom` dev dependency's engine requirement; `npm install`/`npm test` warn outside that range).

## Demo mode

To look at every screen without a Google account or a deployed Apps Script backend, run `npm run dev` and open <http://localhost:5173/?demo>. It loads an in-memory API seeded with made-up donors and skips Google sign-in entirely. Demo mode is dev-only: the code behind it is excluded from production builds.

## Browser smoke tests

`e2e/*.spec.ts` are [Playwright](https://playwright.dev) specs that drive demo mode in a real Chromium browser (add a pledge, log a payment, Escape and Cancel on a half-typed form, filter Pledges/Payments, the Friday display, layout at 360px). They are separate from the unit tests: `npm run check` never runs them, and they don't run under `npm test`.

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
