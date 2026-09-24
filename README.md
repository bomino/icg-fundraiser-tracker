# ICG Fundraiser Tracker

A web version of `Masjid_Fundraiser_Tracker_v3.xlsx`. Volunteers sign in with Google and record pledges and payments. The totals, statuses and data-health checks work exactly as they do in the workbook.

- **Setup:** see [docs/SETUP.md](docs/SETUP.md).
- **Design:** [docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md](docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md), plus [DESIGN.md](DESIGN.md) for the visual system.

```bash
npm install
npm run dev      # local app (needs .env.local)
npm run check    # typecheck + tests + build
```

## Demo mode

To look at every screen without a Google account or a deployed Apps Script backend, run `npm run dev` and open <http://localhost:5173/?demo>. It loads an in-memory API seeded with made-up donors and skips Google sign-in entirely. Demo mode is dev-only: the code behind it is excluded from production builds.

## Previewing a production build

```bash
npm run build
npx vite preview --port 4173
```

The project's Vite root is `web/`, so don't pass `--outDir` to `vite preview` — it already knows where `npm run build` wrote the output.
