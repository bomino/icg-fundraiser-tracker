# Fundraiser Tracker Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GitHub Pages web app that reproduces `Masjid_Fundraiser_Tracker_v3.xlsx` (pledges, payments, summary, data health, donor lookup). Its data lives in a private Google Sheet, behind an Apps Script API that only allowlisted Google accounts can use.

**Architecture:**
- The browser app is Vite + TypeScript with no UI framework. It signs in with Google Identity Services and sends every call to one Apps Script `doPost` endpoint as a `text/plain` POST.
- The Sheet stores only the raw entries. A pure TypeScript engine recalculates every derived value client-side.
- The engine is tested against values that Excel itself computed from the real workbook.

**Tech Stack:**
- Node 22, Vite 8, TypeScript 7, Vitest 5 + jsdom 30
- Chart.js 4.5, SheetJS 0.20.3 (from the SheetJS CDN tarball)
- `@fontsource-variable/inter`, `@fontsource/cormorant-garamond`, `@types/google.accounts`
- Google Apps Script (V8)
- GitHub Actions: checkout v7, setup-node v7, upload-pages-artifact v5, deploy-pages v5

**Spec:** `docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md`. Design system: `DESIGN.md`. Workbook rules: `CLAUDE.md`.

## Global Constraints

- The workbook is the behavioural source of truth. Engine rules must match `CLAUDE.md` and spec §5 exactly: the `#` match-key prefix, `ROUND(…,2)`, the four literal statuses `Pending`/`Partial`/`Paid`/`Overpaid`, the warning strings `⚠ phone not in Pledges` and `⚠ no amount on Pledges`, the first-matching-pledge rule, and the six health checks.
- Money is integer **cents** inside the engine. Blank (`null` / `''`) is never the same as `0`.
- Dates are ISO `YYYY-MM-DD` strings everywhere. "Today" is the **local** date (`todayIso()`), never UTC.
- Never render user data with `innerHTML`. Build every node with `h()` / `textContent`.
- No `as any`, no `@ts-ignore`, no `@ts-expect-error`, no empty `catch {}` blocks.
- CSS uses only the variables in `web/src/styles/tokens.css`. No hex colours outside that file. No Tailwind, no glass/blur effects, and no gradients except the wordmark.
- Never call `window.confirm` / `alert` / `prompt`. Use `confirmDialog`.
- The xlsx, the docx, `.env*` files and any donor data never go into git. Fixtures use `555-01xx` numbers and made-up names.
- Comments explain *why*, never *what*. Match the naming used in this plan exactly.
- Commits: the user's global rule is "never commit unless explicitly requested". The commit steps below run only if the user approved per-task commits at handoff. Otherwise stage the files and move on.
- Run every command from the repo root: `C:\Users\MLawali\Documents\Projects\Personal\ICG`.

## Review Focus

1. **Rows hand-edited in the Google Sheet.** Examples: a date typed so Sheets stores a real date, an amount typed as text, a blank row left behind. `load` must still return clean records: ISO dates, `null` for a non-numeric amount, and rows with no `id` skipped. The test lives in Task 7.
2. **Phones that start with `+`, `0`, `=` or `-`.** They must be written with a leading apostrophe so Sheets keeps them as literal text and never evaluates them as a formula. The round trip must be byte-identical. The test lives in Task 7.
3. **Names and notes containing HTML or script.** They must render as literal text in tables, lookup cards, dialogs and toasts. The tests live in Tasks 11 and 13.
4. **An ID token expiring mid-session.** Tokens last about an hour, and volunteers leave the tab open. The first call after expiry must refresh the token once, silently, instead of showing an error. The test lives in Task 8.
5. **The local "today" near midnight or in a non-UTC timezone.** The future-date flag and the date defaults must use the local calendar date. The test lives in Task 2.

---

## File map

```
.gitignore  package.json  tsconfig.json  vite.config.ts  README.md
web/index.html
web/src/main.ts                 bootstrap: config check, auth, api, store, mount
web/src/vite-env.d.ts           env typing
web/src/types.ts                Pledge, Payment, Settings, drafts
web/src/money.ts                toCents
web/src/matchKey.ts             phone normalization
web/src/dates.ts                todayIso, isIsoDate
web/src/engine/constants.ts     STATUS, warnings, health labels
web/src/engine/derive.ts        derivePledges, derivePayments, createDonorResolver
web/src/engine/summary.ts       computeTotals, computeHealth, computeMethods
web/src/engine/lookup.ts        findByPhone, findByName, paymentsForKey
web/src/engine/index.ts         compute() + re-exports
web/src/validate.ts             client validation (mirrors Code.gs)
web/src/api.ts                  Apps Script client, ApiError
web/src/auth.ts                 Google Identity Services wrapper
web/src/store.ts                state, optimistic writes, rollback
web/src/format.ts               currency/date/percent formatting, parseAmount
web/src/theme.ts                light/dark toggle
web/src/styles/tokens.css       DESIGN.md tokens
web/src/styles/base.css         reset, typography, layout, print
web/src/styles/components.css   buttons, inputs, cards, tables, badges, modal…
web/src/ui/dom.ts               h(), append()
web/src/ui/table.ts             sortable table, mobile cards
web/src/ui/dialog.ts            openDialog, confirmDialog
web/src/ui/toast.ts             showToast
web/src/ui/field.ts             labelled form field
web/src/ui/form.ts              runForm (validate, busy, errors, delete)
web/src/ui/badges.ts            statusBadge, methodBadge
web/src/ui/search.ts            matchesQuery
web/src/ui/filter.ts            ListFilter, filterChip
web/src/ui/errors.ts            createErrorReporter, messageOf
web/src/ui/help.ts              field help text
web/src/ui/pledgeForm.ts        add/edit pledge dialog
web/src/ui/paymentForm.ts       add/edit payment dialog (live donor preview)
web/src/ui/pledgesView.ts       Pledges screen
web/src/ui/paymentsView.ts      Payments screen
web/src/ui/chartSlots.ts        stable colour slot per method row
web/src/ui/methodChart.ts       Chart.js doughnut
web/src/ui/goalForm.ts          edit-goal dialog
web/src/ui/summaryView.ts       Summary screen
web/src/ui/lookupView.ts        Find donor screen
web/src/ui/export.ts            .xlsx download
web/src/ui/screens.ts           loading / message screens
web/src/ui/app.ts               shell, tabs, routing
apps-script/Code.gs             the whole server
apps-script/appsscript.json     manifest
tools/excel-oracle.ps1          regenerates parity-expected.json via Excel COM
test/support/setup.ts           dialog polyfill for jsdom
test/support/factories.ts       pledge()/payment() builders
test/support/appsScript.ts      vm loader + fakes for Code.gs
test/support/validationCases.ts shared client/server validation table
test/fixtures/parity-input.json
test/fixtures/parity-expected.json   (generated, committed)
test/**/*.test.ts
.github/workflows/pages.yml
docs/SETUP.md
```

---

### Task 1: Repository scaffold

**Files:**
- Create: `.gitignore`, `package.json`, `tsconfig.json`, `vite.config.ts`, `web/index.html`, `web/src/main.ts`, `web/src/vite-env.d.ts`, `test/support/setup.ts`

**Interfaces:**
- Produces: `npm run typecheck | test | build | dev`, and the Vite root `web/` with output in `dist/`.

- [ ] **Step 1: Initialise git and ignore private files**

```bash
git init -b main
```

`.gitignore`:
```gitignore
node_modules/
dist/
coverage/
.env
.env.*
*.xlsx
*.docx
~$*
.claude/settings.local.json
```

- [ ] **Step 2: Create `package.json` and install**

```json
{
  "name": "icg-fundraiser-tracker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check": "npm run typecheck && npm run test && npm run build"
  }
}
```

```bash
npm i -D vite@8 vitest@5 typescript@7 jsdom@30 @types/node@22 @types/google.accounts
npm i chart.js@4 @fontsource-variable/inter@5 @fontsource/cormorant-garamond@5 https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

If `tsc` from `typescript@7` rejects any option in Step 3, install `typescript@6` instead. Keep the config as written.

- [ ] **Step 3: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "google.accounts", "node"],
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["web/src", "test", "vite.config.ts"]
}
```

- [ ] **Step 4: `vite.config.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: 'web',
  envDir: repoRoot,
  base: process.env.VITE_BASE ?? '/',
  build: { outDir: '../dist', emptyOutDir: true },
  test: {
    root: repoRoot,
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/support/setup.ts'],
  },
});
```

- [ ] **Step 5: Entry files**

`web/src/vite-env.d.ts`:
```ts
interface ImportMetaEnv {
  readonly VITE_SCRIPT_URL?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

`web/index.html`. The inline script sets the theme before first paint so dark-mode users never see a light flash:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <link rel="icon" href="data:," />
    <title>ICG Fundraiser Tracker</title>
    <script>
      (function () {
        var theme = null;
        try { theme = localStorage.getItem('icg-theme'); } catch (e) { theme = null; }
        if (theme !== 'light' && theme !== 'dark') {
          theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.dataset.theme = theme;
      })();
    </script>
    <script src="https://accounts.google.com/gsi/client" async></script>
    <script type="module" src="/src/main.ts"></script>
  </head>
  <body>
    <div id="auth" hidden></div>
    <div id="app"></div>
  </body>
</html>
```

`web/src/main.ts` (placeholder until Task 14):
```ts
const root = document.getElementById('app');
if (root) root.textContent = 'ICG Fundraiser Tracker';
```

The Google Identity Services script deliberately has no `integrity=` attribute. Google serves it unversioned and updates it in place, so a Subresource Integrity hash would break sign-in on its next release, and Google's docs load it this way. If a security hook flags it, record this reason and don't add a hash.

`test/support/setup.ts`. jsdom's `<dialog>` support varies, and the UI tests only need open/close semantics:
```ts
if (typeof HTMLDialogElement !== 'undefined') {
  const proto = HTMLDialogElement.prototype;
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (typeof proto.close !== 'function') {
    proto.close = function close(this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
}
```

- [ ] **Step 6: Verify the scaffold**

Run: `npm run typecheck && npx vitest run --passWithNoTests && npm run build`
Expected: all three exit 0, and `dist/index.html` exists.

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.json vite.config.ts web test CLAUDE.md DESIGN.md docs
git commit -m "chore: scaffold Vite + TypeScript app"
```

---

### Task 2: Domain types, money, match key, dates

**Files:**
- Create: `web/src/types.ts`, `web/src/money.ts`, `web/src/matchKey.ts`, `web/src/dates.ts`, `test/support/factories.ts`
- Test: `test/foundation.test.ts`

**Interfaces:**
- Produces:
  - `Pledge`, `Payment`, `Settings`, `PledgeDraft`, `PaymentDraft`
  - `toCents(amount: number | null): number | null`
  - `matchKey(phone: string): string`
  - `todayIso(now?: Date): string`
  - `isIsoDate(value: string): boolean`
  - Test builders `pledge()`, `payment()`, `SETTINGS`, `TODAY`

- [ ] **Step 1: Write the failing tests** (`test/foundation.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { isIsoDate, todayIso } from '../web/src/dates';
import { matchKey } from '../web/src/matchKey';
import { toCents } from '../web/src/money';

describe('matchKey', () => {
  it('is empty for an empty phone', () => {
    expect(matchKey('')).toBe('');
  });
  it('treats four spellings of one number as the same donor', () => {
    const keys = ['555-010-0110', '(555) 010 0110', '5550100110', '+555.010.0110'].map(matchKey);
    expect(new Set(keys)).toEqual(new Set(['#5550100110']));
  });
  it('keeps a leading zero distinct', () => {
    expect(matchKey('0551234')).not.toBe(matchKey('551234'));
  });
  it('gives punctuation-only and space-only phones the bare "#" key, like the workbook', () => {
    expect(matchKey('--')).toBe('#');
    expect(matchKey(' ')).toBe('#');
  });
  it('ignores letter case, as Excel lookups do', () => {
    expect(matchKey('555-010-0122X')).toBe(matchKey('555 010 0122x'));
  });
});

describe('toCents', () => {
  it('keeps blank distinct from zero', () => {
    expect(toCents(null)).toBeNull();
    expect(toCents(0)).toBe(0);
  });
  it('removes float dust', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(20.25)).toBe(2025);
  });
});

describe('dates', () => {
  it('uses the local calendar date, not UTC', () => {
    expect(todayIso(new Date(2026, 8, 23, 23, 30))).toBe('2026-09-23');
    expect(todayIso(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });
  it('accepts only real ISO dates', () => {
    expect(isIsoDate('2025-02-28')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2025-02-30')).toBe(false);
    expect(isIsoDate('01/10/2025')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate('0099-01-01')).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/foundation.test.ts`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Implement**

`web/src/types.ts`:
```ts
export interface Pledge {
  id: string;
  phone: string;
  name: string;
  datePledged: string;
  amountPledged: number | null;
  notes: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Payment {
  id: string;
  phone: string;
  dateReceived: string;
  amountReceived: number | null;
  method: string;
  notes: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Settings {
  goal: number | null;
  paymentMethods: string[];
}

export type PledgeDraft = Pick<Pledge, 'phone' | 'name' | 'datePledged' | 'amountPledged' | 'notes'>;
export type PaymentDraft = Pick<Payment, 'phone' | 'dateReceived' | 'amountReceived' | 'method' | 'notes'>;
```

`web/src/money.ts`:
```ts
export function toCents(amount: number | null): number | null {
  return amount === null ? null : Math.round(amount * 100);
}
```

`web/src/matchKey.ts`:
```ts
const IGNORED_CHARACTERS = /[-().+ ]/g;

// Mirrors the workbook's hidden Match Key column. The '#' prefix stops Excel coercing
// '0551234' to a number; lower-casing mirrors Excel's case-insensitive COUNTIF/MATCH.
export function matchKey(phone: string): string {
  if (phone === '') return '';
  return `#${phone.replace(IGNORED_CHARACTERS, '')}`.toLowerCase();
}
```

`web/src/dates.ts`:
```ts
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
```

`test/support/factories.ts`:
```ts
import type { Payment, Pledge, Settings } from '../../web/src/types';

let sequence = 0;
const nextId = (prefix: string) => `${prefix}${++sequence}`;

export function pledge(fields: Partial<Pledge> = {}): Pledge {
  return {
    id: nextId('pledge-'),
    phone: '',
    name: '',
    datePledged: '',
    amountPledged: null,
    notes: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'owner@example.com',
    ...fields,
  };
}

export function payment(fields: Partial<Payment> = {}): Payment {
  return {
    id: nextId('payment-'),
    phone: '',
    dateReceived: '',
    amountReceived: null,
    method: '',
    notes: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'owner@example.com',
    ...fields,
  };
}

export const METHODS = ['Cash', 'Bank Transfer', 'Card', 'Check', 'Online', 'Other'];
export const SETTINGS: Settings = { goal: 10000, paymentMethods: METHODS };
export const TODAY = '2026-09-23';
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/foundation.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/types.ts web/src/money.ts web/src/matchKey.ts web/src/dates.ts test/support/factories.ts test/foundation.test.ts
git commit -m "feat: domain types, match key, cents and local dates"
```

---

### Task 3: Engine — derived pledge and payment fields

**Files:**
- Create: `web/src/engine/constants.ts`, `web/src/engine/derive.ts`
- Test: `test/engine/derive.test.ts`

**Interfaces:**
- Consumes: `matchKey`, `toCents`, `Pledge`, `Payment`
- Produces:
  - `STATUS`, `Status`, `STATUSES`, `WARN_NOT_IN_PLEDGES`, `WARN_NO_AMOUNT`, `WARNING_MARK`
  - `DerivedPledge`, `DerivedPayment`
  - `derivePledges(pledges, payments): DerivedPledge[]`
  - `derivePayments(payments, pledges, today): DerivedPayment[]`
  - `createDonorResolver(pledges): (phone: string) => string`

- [ ] **Step 1: Write the failing tests** (`test/engine/derive.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { createDonorResolver, derivePayments, derivePledges } from '../../web/src/engine/derive';
import { WARN_NO_AMOUNT, WARN_NOT_IN_PLEDGES } from '../../web/src/engine/constants';
import { TODAY, payment, pledge } from '../support/factories';

describe('derivePledges', () => {
  it('sums, counts and dates the matching payments', () => {
    const [d] = derivePledges(
      [pledge({ phone: '555-010-0101', amountPledged: 500 })],
      [
        payment({ phone: '5550100101', amountReceived: 200, dateReceived: '2025-01-05' }),
        payment({ phone: '(555) 010-0101', amountReceived: 300, dateReceived: '2025-02-05' }),
      ],
    );
    expect(d).toMatchObject({ receivedCents: 50000, paymentCount: 2, lastPaymentDate: '2025-02-05', balanceCents: 0, status: 'Paid', duplicate: false });
  });

  it('reads Paid for 0.1 + 0.2 against a 0.30 pledge', () => {
    const [d] = derivePledges(
      [pledge({ phone: '1', amountPledged: 0.3 })],
      [payment({ phone: '1', amountReceived: 0.1 }), payment({ phone: '1', amountReceived: 0.2 })],
    );
    expect(d).toMatchObject({ receivedCents: 30, balanceCents: 0, status: 'Paid' });
  });

  it('marks an overpayment with a negative balance', () => {
    const [d] = derivePledges([pledge({ phone: '1', amountPledged: 100 })], [payment({ phone: '1', amountReceived: 150 })]);
    expect(d).toMatchObject({ balanceCents: -5000, status: 'Overpaid' });
  });

  it('is Partial when some money has come in', () => {
    const [d] = derivePledges([pledge({ phone: '1', amountPledged: 100 })], [payment({ phone: '1', amountReceived: 40 })]);
    expect(d).toMatchObject({ balanceCents: 6000, status: 'Partial' });
  });

  it('is Pending when nothing is received, including a zero pledge', () => {
    const rows = derivePledges([pledge({ phone: '1', amountPledged: 100 }), pledge({ phone: '2', amountPledged: 0 })], []);
    expect(rows.map((d) => [d.status, d.receivedCents, d.paymentCount, d.balanceCents])).toEqual([
      ['Pending', 0, 0, 10000],
      ['Pending', 0, 0, 0],
    ]);
  });

  it('leaves every derived field blank when Amount Pledged is blank', () => {
    const [d] = derivePledges([pledge({ phone: '1' })], [payment({ phone: '1', amountReceived: 40, dateReceived: '2025-01-01' })]);
    expect(d).toMatchObject({ receivedCents: null, paymentCount: null, lastPaymentDate: '', balanceCents: null, status: null });
  });

  it('never matches a pledge without a phone to payments without a phone', () => {
    const [d] = derivePledges([pledge({ amountPledged: 250 })], [payment({ amountReceived: 30 })]);
    expect(d).toMatchObject({ receivedCents: null, paymentCount: null, balanceCents: 25000, status: 'Pending' });
  });

  it('counts an undated payment but leaves Last Payment Date blank', () => {
    const [d] = derivePledges([pledge({ phone: '1', amountPledged: 100 })], [payment({ phone: '1', amountReceived: 100 })]);
    expect(d).toMatchObject({ receivedCents: 10000, paymentCount: 1, lastPaymentDate: '', status: 'Paid' });
  });

  it('counts a payment with no amount in # Payments but adds nothing', () => {
    const [d] = derivePledges([pledge({ phone: '1', amountPledged: 80 })], [payment({ phone: '1', dateReceived: '2025-03-03' })]);
    expect(d).toMatchObject({ receivedCents: 0, paymentCount: 1, lastPaymentDate: '2025-03-03', status: 'Pending' });
  });

  it('flags every row of a duplicated phone and double-counts, like the workbook', () => {
    const rows = derivePledges(
      [pledge({ phone: '555-010-0107', amountPledged: 200 }), pledge({ phone: '5550100107', amountPledged: 200 }), pledge({ phone: '9', amountPledged: 1 })],
      [payment({ phone: '555 010 0107', amountReceived: 200 })],
    );
    expect(rows.map((d) => [d.duplicate, d.receivedCents])).toEqual([
      [true, 20000],
      [true, 20000],
      [false, 0],
    ]);
  });

  it('keeps 0551234 and 551234 apart', () => {
    const rows = derivePledges(
      [pledge({ phone: '0551234', amountPledged: 50 }), pledge({ phone: '551234', amountPledged: 75 })],
      [payment({ phone: '0551234', amountReceived: 50 }), payment({ phone: '551234', amountReceived: 25 })],
    );
    expect(rows.map((d) => d.status)).toEqual(['Paid', 'Partial']);
  });
});

describe('derivePayments', () => {
  it('names the donor from the first matching pledge', () => {
    const [d] = derivePayments(
      [payment({ phone: '1' })],
      [pledge({ phone: '1', name: 'First', amountPledged: 1 }), pledge({ phone: '1', name: 'Second', amountPledged: 1 })],
      TODAY,
    );
    expect(d.donorName).toBe('First');
  });

  it('warns when the phone is not on Pledges', () => {
    const [d] = derivePayments([payment({ phone: '555-999-0000' })], [], TODAY);
    expect(d).toMatchObject({ donorName: WARN_NOT_IN_PLEDGES, notCounted: true });
  });

  it('warns when the donor has no Amount Pledged', () => {
    const [d] = derivePayments([payment({ phone: '1' })], [pledge({ phone: '1', name: 'Jamal' })], TODAY);
    expect(d).toMatchObject({ donorName: WARN_NO_AMOUNT, notCounted: true });
  });

  it('shows a blank name for a nameless donor, never 0', () => {
    const [d] = derivePayments([payment({ phone: '1' })], [pledge({ phone: '1', amountPledged: 120 })], TODAY);
    expect(d).toMatchObject({ donorName: '', notCounted: false });
  });

  it('is blank and unflagged when the payment has no phone', () => {
    const [d] = derivePayments([payment({ amountReceived: 30 })], [pledge({ amountPledged: 30 })], TODAY);
    expect(d).toMatchObject({ key: '', donorName: '', notCounted: false });
  });

  it('flags only dates after today', () => {
    const rows = derivePayments([payment({ dateReceived: '2026-09-24' }), payment({ dateReceived: TODAY }), payment()], [], TODAY);
    expect(rows.map((d) => d.futureDate)).toEqual([true, false, false]);
  });
});

describe('createDonorResolver', () => {
  it('previews the same name the Payments tab would show', () => {
    const resolve = createDonorResolver([pledge({ phone: '(555) 010-0101', name: 'Aisha', amountPledged: 5 })]);
    expect(resolve('5550100101')).toBe('Aisha');
    expect(resolve('')).toBe('');
    expect(resolve('123')).toBe(WARN_NOT_IN_PLEDGES);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/engine/derive.test.ts`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Implement**

`web/src/engine/constants.ts`:
```ts
export const STATUS = {
  pending: 'Pending',
  partial: 'Partial',
  paid: 'Paid',
  overpaid: 'Overpaid',
} as const;

export type Status = (typeof STATUS)[keyof typeof STATUS];

export const STATUSES: readonly Status[] = [STATUS.paid, STATUS.partial, STATUS.pending, STATUS.overpaid];

// Every "not counted" signal keys off this leading mark, so a warning must start with it
// and a donor name never may (validate.ts and Code.gs reject such names).
export const WARNING_MARK = '⚠';
export const WARN_NOT_IN_PLEDGES = '⚠ phone not in Pledges';
export const WARN_NO_AMOUNT = '⚠ no amount on Pledges';
```

`web/src/engine/derive.ts`:
```ts
import { matchKey } from '../matchKey';
import { toCents } from '../money';
import type { Payment, Pledge } from '../types';
import { STATUS, WARNING_MARK, WARN_NOT_IN_PLEDGES, WARN_NO_AMOUNT, type Status } from './constants';

export interface DerivedPledge {
  pledge: Pledge;
  key: string;
  receivedCents: number | null;
  paymentCount: number | null;
  lastPaymentDate: string;
  balanceCents: number | null;
  status: Status | null;
  duplicate: boolean;
}

export interface DerivedPayment {
  payment: Payment;
  key: string;
  donorName: string;
  notCounted: boolean;
  futureDate: boolean;
}

interface PaymentAggregate {
  cents: number;
  count: number;
  lastDate: string;
}

const NO_PAYMENTS: PaymentAggregate = { cents: 0, count: 0, lastDate: '' };

function aggregatePayments(payments: readonly Payment[]): Map<string, PaymentAggregate> {
  const byKey = new Map<string, PaymentAggregate>();
  for (const payment of payments) {
    const key = matchKey(payment.phone);
    if (key === '') continue;
    const aggregate = byKey.get(key) ?? { ...NO_PAYMENTS };
    aggregate.cents += toCents(payment.amountReceived) ?? 0;
    aggregate.count += 1;
    if (payment.dateReceived > aggregate.lastDate) aggregate.lastDate = payment.dateReceived;
    byKey.set(key, aggregate);
  }
  return byKey;
}

function countKeys(pledges: readonly Pledge[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pledge of pledges) {
    const key = matchKey(pledge.phone);
    if (key !== '') counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function statusFor(pledgedCents: number, receivedCents: number | null): Status {
  if (!receivedCents) return STATUS.pending;
  const difference = receivedCents - pledgedCents;
  if (difference > 0) return STATUS.overpaid;
  if (difference === 0) return STATUS.paid;
  return STATUS.partial;
}

export function derivePledges(pledges: readonly Pledge[], payments: readonly Payment[]): DerivedPledge[] {
  const aggregates = aggregatePayments(payments);
  const keyCounts = countKeys(pledges);
  return pledges.map((pledge) => {
    const key = matchKey(pledge.phone);
    const duplicate = key !== '' && (keyCounts.get(key) ?? 0) > 1;
    const pledgedCents = toCents(pledge.amountPledged);
    if (pledgedCents === null) {
      return { pledge, key, receivedCents: null, paymentCount: null, lastPaymentDate: '', balanceCents: null, status: null, duplicate };
    }
    // A phoneless pledge has an empty key; matching it would sweep up every phoneless payment.
    const aggregate = key === '' ? null : (aggregates.get(key) ?? NO_PAYMENTS);
    const receivedCents = aggregate ? aggregate.cents : null;
    return {
      pledge,
      key,
      receivedCents,
      paymentCount: aggregate ? aggregate.count : null,
      lastPaymentDate: aggregate ? aggregate.lastDate : '',
      balanceCents: pledgedCents - (receivedCents ?? 0),
      status: statusFor(pledgedCents, receivedCents),
      duplicate,
    };
  });
}

export function createDonorResolver(pledges: readonly Pledge[]): (phone: string) => string {
  const firstByKey = new Map<string, Pledge>();
  for (const pledge of pledges) {
    const key = matchKey(pledge.phone);
    if (key !== '' && !firstByKey.has(key)) firstByKey.set(key, pledge);
  }
  return (phone) => {
    const key = matchKey(phone);
    if (key === '') return '';
    const pledge = firstByKey.get(key);
    if (!pledge) return WARN_NOT_IN_PLEDGES;
    if (pledge.amountPledged === null) return WARN_NO_AMOUNT;
    return pledge.name;
  };
}

export function derivePayments(payments: readonly Payment[], pledges: readonly Pledge[], today: string): DerivedPayment[] {
  const resolveDonor = createDonorResolver(pledges);
  return payments.map((payment) => {
    const donorName = resolveDonor(payment.phone);
    return {
      payment,
      key: matchKey(payment.phone),
      donorName,
      notCounted: donorName.startsWith(WARNING_MARK),
      futureDate: payment.dateReceived !== '' && payment.dateReceived > today,
    };
  });
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/engine/derive.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/engine test/engine/derive.test.ts
git commit -m "feat(engine): derived pledge and payment fields"
```

---

### Task 4: Engine — totals, data health, methods, lookup, compute()

**Files:**
- Create: `web/src/engine/summary.ts`, `web/src/engine/lookup.ts`, `web/src/engine/index.ts`
- Modify: `web/src/engine/constants.ts` (append the health labels)
- Test: `test/engine/summary.test.ts`

**Interfaces:**
- Consumes: Task 3's exports
- Produces (all re-exported from `web/src/engine/index.ts`):
  - `Totals`, `HealthId`, `HealthCheck { id; label; target: 'pledges' | 'payments'; ids: string[] }`
  - `MethodRow { label; cents; kind: 'method' | 'none' | 'unlisted' }`
  - `Computed { pledges; payments; totals; health; methods; methodTotalCents }`
  - `compute(pledges, payments, settings, today): Computed`
  - `findByPhone(c, input): DerivedPledge | null`
  - `findByName(c, query): DerivedPledge[]`
  - `paymentsForKey(c, key): DerivedPayment[]`

- [ ] **Step 1: Write the failing tests** (`test/engine/summary.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { compute, findByName, findByPhone, paymentsForKey } from '../../web/src/engine';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

describe('totals', () => {
  const computed = compute(
    [
      pledge({ phone: 'a', amountPledged: 500 }),
      pledge({ phone: 'b', amountPledged: 100 }),
      pledge({ phone: 'c', amountPledged: 0 }),
      pledge({ phone: 'd' }),
    ],
    [
      payment({ phone: 'a', amountReceived: 200 }),
      payment({ phone: 'b', amountReceived: 150 }),
      payment({ phone: 'd', amountReceived: 40 }),
    ],
    SETTINGS,
    TODAY,
  );

  it('keeps an overpaid credit out of Outstanding', () => {
    expect(computed.totals).toMatchObject({
      goalCents: 1000000,
      pledgedCents: 60000,
      receivedCents: 35000,
      outstandingCents: 30000,
      creditCents: 5000,
      donorCount: 2,
      statusCounts: { Paid: 0, Partial: 1, Pending: 1, Overpaid: 1 },
      loggedCents: 39000,
      unmatchedCents: 4000,
      pledgePaymentCount: 2,
      paymentsWithAmount: 3,
    });
    expect(computed.totals.goalFraction).toBeCloseTo(0.035, 12);
  });

  it('reports 0% when the goal is 0 or blank', () => {
    expect(compute([], [], { ...SETTINGS, goal: 0 }, TODAY).totals.goalFraction).toBe(0);
    expect(compute([], [], { ...SETTINGS, goal: null }, TODAY).totals.goalFraction).toBe(0);
  });

  it('reports a zero credit as +0, never -0', () => {
    expect(Object.is(compute([], [], SETTINGS, TODAY).totals.creditCents, 0)).toBe(true);
  });
});

describe('data health', () => {
  it('finds exactly the offending rows for each of the six checks', () => {
    const predates = pledge({ id: 'predates', phone: '1', amountPledged: 100, datePledged: '2025-06-01' });
    const dupeA = pledge({ id: 'dupeA', phone: '2', amountPledged: 100 });
    const dupeB = pledge({ id: 'dupeB', phone: '2', amountPledged: 100 });
    const noPhone = pledge({ id: 'noPhone', amountPledged: 50 });
    const computed = compute(
      [predates, dupeA, dupeB, noPhone, pledge({ phone: '', amountPledged: 0 })],
      [
        payment({ phone: '1', amountReceived: 50, dateReceived: '2025-05-01' }),
        payment({ id: 'unmatched', phone: '9', amountReceived: 10, dateReceived: '2025-01-01' }),
        payment({ id: 'incomplete', phone: '1', dateReceived: '2025-01-02' }),
        payment({ id: 'future', phone: '2', amountReceived: 5, dateReceived: '2099-01-01' }),
        payment({ amountReceived: 7 }),
      ],
      SETTINGS,
      TODAY,
    );
    expect(Object.fromEntries(computed.health.map((check) => [check.id, check.ids]))).toEqual({
      notMatched: ['unmatched'],
      duplicates: ['dupeA', 'dupeB'],
      pledgeNoPhone: ['noPhone'],
      paymentIncomplete: ['incomplete'],
      futureDated: ['future'],
      predatesPledge: ['predates'],
    });
    expect(computed.health.map((check) => check.label)).toEqual([
      'Payments not matched to a pledge',
      'Donors listed more than once',
      'Pledges missing a phone number',
      'Payments missing a date or amount',
      'Payments dated in the future',
      'Donors whose payments predate their pledge',
    ]);
  });
});

describe('payment methods', () => {
  it('lists configured methods in order, then no-method, and totals them', () => {
    const computed = compute(
      [],
      [
        payment({ method: 'Cash', amountReceived: 10 }),
        payment({ method: 'Card', amountReceived: 2.5 }),
        payment({ method: '', amountReceived: 1 }),
        payment({ method: 'Cash', amountReceived: null }),
      ],
      SETTINGS,
      TODAY,
    );
    expect(computed.methods.map((row) => [row.label, row.cents])).toEqual([
      ['Cash', 1000],
      ['Bank Transfer', 0],
      ['Card', 250],
      ['Check', 0],
      ['Online', 0],
      ['Other', 0],
      ['No method recorded', 100],
    ]);
    expect(computed.methodTotalCents).toBe(1350);
  });

  it('adds an Other / unlisted row only when such money exists', () => {
    const computed = compute([], [payment({ method: 'Venmo', amountReceived: 3 })], SETTINGS, TODAY);
    expect(computed.methods.at(-1)).toEqual({ label: 'Other / unlisted', cents: 300, kind: 'unlisted' });
    expect(computed.methodTotalCents).toBe(300);
  });
});

describe('lookup', () => {
  const first = pledge({ id: 'first', phone: '(555) 010-0107', name: 'Grace Lee', amountPledged: 200 });
  const computed = compute(
    [first, pledge({ id: 'second', phone: '5550100107', name: 'Grace L.', amountPledged: 200 }), pledge({ id: 'other', phone: '1', name: 'Aisha Rahman' })],
    [payment({ id: 'pay', phone: '555 010 0107', amountReceived: 20 })],
    SETTINGS,
    TODAY,
  );

  it('finds the first pledge whatever the phone format', () => {
    expect(findByPhone(computed, '555-010-0107')?.pledge.id).toBe('first');
  });
  it('returns null for blank or unknown phones', () => {
    expect(findByPhone(computed, '')).toBeNull();
    expect(findByPhone(computed, '000')).toBeNull();
  });
  it('matches names case-insensitively by substring', () => {
    expect(findByName(computed, '  grace ').map((d) => d.pledge.id)).toEqual(['first', 'second']);
    expect(findByName(computed, '   ')).toEqual([]);
  });
  it('lists a donor’s payments by key', () => {
    expect(paymentsForKey(computed, '#5550100107').map((d) => d.payment.id)).toEqual(['pay']);
    expect(paymentsForKey(computed, '')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/engine/summary.test.ts`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Implement**

Append to `web/src/engine/constants.ts`:
```ts
export type HealthId = 'notMatched' | 'duplicates' | 'pledgeNoPhone' | 'paymentIncomplete' | 'futureDated' | 'predatesPledge';

// Labels are the workbook's Summary A21:A26 text, verbatim.
export const HEALTH_LABELS: Record<HealthId, string> = {
  notMatched: 'Payments not matched to a pledge',
  duplicates: 'Donors listed more than once',
  pledgeNoPhone: 'Pledges missing a phone number',
  paymentIncomplete: 'Payments missing a date or amount',
  futureDated: 'Payments dated in the future',
  predatesPledge: 'Donors whose payments predate their pledge',
};

export const NO_METHOD_LABEL = 'No method recorded';
export const UNLISTED_METHOD_LABEL = 'Other / unlisted';
```

`web/src/engine/summary.ts`:
```ts
import { toCents } from '../money';
import type { Settings } from '../types';
import { HEALTH_LABELS, NO_METHOD_LABEL, STATUS, UNLISTED_METHOD_LABEL, type HealthId, type Status } from './constants';
import type { DerivedPayment, DerivedPledge } from './derive';

export interface Totals {
  goalCents: number | null;
  pledgedCents: number;
  receivedCents: number;
  outstandingCents: number;
  creditCents: number;
  donorCount: number;
  statusCounts: Record<Status, number>;
  goalFraction: number;
  loggedCents: number;
  unmatchedCents: number;
  pledgePaymentCount: number;
  paymentsWithAmount: number;
}

export interface HealthCheck {
  id: HealthId;
  label: string;
  target: 'pledges' | 'payments';
  ids: string[];
}

export interface MethodRow {
  label: string;
  cents: number;
  kind: 'method' | 'none' | 'unlisted';
}

export function computeTotals(pledges: readonly DerivedPledge[], payments: readonly DerivedPayment[], settings: Settings): Totals {
  const statusCounts: Record<Status, number> = { [STATUS.paid]: 0, [STATUS.partial]: 0, [STATUS.pending]: 0, [STATUS.overpaid]: 0 };
  let pledgedCents = 0;
  let receivedCents = 0;
  let outstandingCents = 0;
  let negativeBalanceCents = 0;
  let donorCount = 0;
  let pledgePaymentCount = 0;
  for (const derived of pledges) {
    const pledged = toCents(derived.pledge.amountPledged);
    if (pledged !== null) {
      pledgedCents += pledged;
      if (pledged > 0) donorCount += 1;
    }
    receivedCents += derived.receivedCents ?? 0;
    // Outstanding sums only positive balances so one donor's credit cannot mask another's debt.
    if (derived.balanceCents !== null && derived.balanceCents > 0) outstandingCents += derived.balanceCents;
    if (derived.balanceCents !== null && derived.balanceCents < 0) negativeBalanceCents += derived.balanceCents;
    pledgePaymentCount += derived.paymentCount ?? 0;
    if (derived.status) statusCounts[derived.status] += 1;
  }
  let loggedCents = 0;
  let paymentsWithAmount = 0;
  for (const derived of payments) {
    const cents = toCents(derived.payment.amountReceived);
    if (cents === null) continue;
    loggedCents += cents;
    if (cents > 0) paymentsWithAmount += 1;
  }
  const goalCents = toCents(settings.goal);
  return {
    goalCents,
    pledgedCents,
    receivedCents,
    outstandingCents,
    creditCents: Math.abs(negativeBalanceCents),
    donorCount,
    statusCounts,
    goalFraction: goalCents ? receivedCents / goalCents : 0,
    loggedCents,
    unmatchedCents: loggedCents - receivedCents,
    pledgePaymentCount,
    paymentsWithAmount,
  };
}

export function computeHealth(pledges: readonly DerivedPledge[], payments: readonly DerivedPayment[]): HealthCheck[] {
  const pledgeIds = (test: (d: DerivedPledge) => boolean) => pledges.filter(test).map((d) => d.pledge.id);
  const paymentIds = (test: (d: DerivedPayment) => boolean) => payments.filter(test).map((d) => d.payment.id);
  const check = (id: HealthId, target: HealthCheck['target'], ids: string[]): HealthCheck => ({ id, label: HEALTH_LABELS[id], target, ids });
  return [
    check('notMatched', 'payments', paymentIds((d) => d.notCounted)),
    check('duplicates', 'pledges', pledgeIds((d) => d.duplicate)),
    check('pledgeNoPhone', 'pledges', pledgeIds((d) => (d.pledge.amountPledged ?? 0) > 0 && d.pledge.phone === '')),
    check('paymentIncomplete', 'payments', paymentIds((d) => d.payment.phone !== '' && (d.payment.dateReceived === '' || d.payment.amountReceived === null))),
    check('futureDated', 'payments', paymentIds((d) => d.futureDate)),
    // Compares only the latest payment date, as the workbook does (see CLAUDE.md).
    check('predatesPledge', 'pledges', pledgeIds((d) => d.lastPaymentDate !== '' && d.pledge.datePledged !== '' && d.lastPaymentDate < d.pledge.datePledged)),
  ];
}

export function computeMethods(payments: readonly DerivedPayment[], methods: readonly string[]): MethodRow[] {
  const centsByMethod = new Map<string, number>();
  for (const derived of payments) {
    const method = derived.payment.method;
    centsByMethod.set(method, (centsByMethod.get(method) ?? 0) + (toCents(derived.payment.amountReceived) ?? 0));
  }
  const rows: MethodRow[] = methods.map((label) => ({ label, cents: centsByMethod.get(label) ?? 0, kind: 'method' }));
  rows.push({ label: NO_METHOD_LABEL, cents: centsByMethod.get('') ?? 0, kind: 'none' });
  const listed = new Set(methods);
  let unlistedCents = 0;
  for (const [method, cents] of centsByMethod) {
    if (method !== '' && !listed.has(method)) unlistedCents += cents;
  }
  if (unlistedCents !== 0) rows.push({ label: UNLISTED_METHOD_LABEL, cents: unlistedCents, kind: 'unlisted' });
  return rows;
}
```

`web/src/engine/lookup.ts`:
```ts
import { matchKey } from '../matchKey';
import type { DerivedPayment, DerivedPledge } from './derive';

interface Derived {
  pledges: readonly DerivedPledge[];
  payments: readonly DerivedPayment[];
}

export function findByPhone(computed: Derived, input: string): DerivedPledge | null {
  const key = matchKey(input);
  if (key === '') return null;
  return computed.pledges.find((d) => d.key === key) ?? null;
}

export function findByName(computed: Derived, query: string): DerivedPledge[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  return computed.pledges.filter((d) => d.pledge.name.toLowerCase().includes(needle));
}

export function paymentsForKey(computed: Derived, key: string): DerivedPayment[] {
  if (key === '') return [];
  return computed.payments.filter((d) => d.key === key);
}
```

`web/src/engine/index.ts`:
```ts
import type { Payment, Pledge, Settings } from '../types';
import { derivePayments, derivePledges, type DerivedPayment, type DerivedPledge } from './derive';
import { computeHealth, computeMethods, computeTotals, type HealthCheck, type MethodRow, type Totals } from './summary';

export * from './constants';
export * from './derive';
export * from './lookup';
export * from './summary';

export interface Computed {
  pledges: DerivedPledge[];
  payments: DerivedPayment[];
  totals: Totals;
  health: HealthCheck[];
  methods: MethodRow[];
  methodTotalCents: number;
}

export function compute(pledges: readonly Pledge[], payments: readonly Payment[], settings: Settings, today: string): Computed {
  const derivedPledges = derivePledges(pledges, payments);
  const derivedPayments = derivePayments(payments, pledges, today);
  const methods = computeMethods(derivedPayments, settings.paymentMethods);
  return {
    pledges: derivedPledges,
    payments: derivedPayments,
    totals: computeTotals(derivedPledges, derivedPayments, settings),
    health: computeHealth(derivedPledges, derivedPayments),
    methods,
    methodTotalCents: methods.reduce((sum, row) => sum + row.cents, 0),
  };
}
```

- [ ] **Step 4: Run the whole engine suite**

Run: `npx vitest run test/engine && npm run typecheck`
Expected: PASS, and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/engine test/engine/summary.test.ts
git commit -m "feat(engine): totals, data health, method breakdown, lookup"
```

---

### Task 5: Excel parity oracle

**Files:**
- Create: `test/fixtures/parity-input.json`, `tools/excel-oracle.ps1`, `test/fixtures/parity-expected.json` (generated)
- Test: `test/engine/parity.test.ts`

**Interfaces:**
- Consumes: `compute`, `findByPhone`, `toCents`
- Produces: a committed expected file. CI never needs Excel.

- [ ] **Step 1: Write the fixture** (`test/fixtures/parity-input.json`)

Each row exercises one awkward case from `CLAUDE.md`. Future dates use 2099 and every other date is ≤ 2025, so the result doesn't depend on the day the oracle runs.

```json
{
  "settings": { "goal": 5000, "paymentMethods": ["Cash", "Bank Transfer", "Card", "Check", "Online", "Other"] },
  "pledges": [
    { "id": "P01", "phone": "555-010-0101", "name": "Aisha Rahman", "datePledged": "2025-01-10", "amountPledged": 500, "notes": "" },
    { "id": "P02", "phone": "555-010-0102", "name": "Bilal Hassan", "datePledged": "2025-01-12", "amountPledged": 1000, "notes": "" },
    { "id": "P03", "phone": "555-010-0103", "name": "Chen Wei", "datePledged": "2025-01-15", "amountPledged": 300, "notes": "" },
    { "id": "P04", "phone": "555-010-0104", "name": "Dana Okafor", "datePledged": "2025-01-20", "amountPledged": 0.3, "notes": "float dust" },
    { "id": "P05", "phone": "555-010-0105", "name": "Elif Kaya", "datePledged": "2025-02-01", "amountPledged": 100, "notes": "" },
    { "id": "P06", "phone": "(555) 010 0106", "name": "Farid Musa", "datePledged": "2025-02-03", "amountPledged": 400, "notes": "four phone spellings" },
    { "id": "P07", "phone": "555-010-0107", "name": "Grace Lee", "datePledged": "2025-02-05", "amountPledged": 200, "notes": "" },
    { "id": "P08", "phone": "5550100107", "name": "Grace Lee", "datePledged": "2025-02-06", "amountPledged": 200, "notes": "Entered twice by mistake" },
    { "id": "P09", "phone": "0551234", "name": "Hamza Ali", "datePledged": "2025-02-10", "amountPledged": 50, "notes": "" },
    { "id": "P10", "phone": "551234", "name": "Ibrahim Noor", "datePledged": "2025-02-10", "amountPledged": 75, "notes": "" },
    { "id": "P11", "phone": "555-010-0111", "name": "Jamal Idris", "datePledged": "2025-02-12", "amountPledged": null, "notes": "amount not known yet" },
    { "id": "P12", "phone": "555-010-0112", "name": "", "datePledged": "2025-02-14", "amountPledged": 120, "notes": "" },
    { "id": "P13", "phone": "", "name": "Khadija Umar", "datePledged": "2025-02-15", "amountPledged": 250, "notes": "no phone" },
    { "id": "P14", "phone": "555-010-0114", "name": "Layla Aziz", "datePledged": "2025-06-01", "amountPledged": 300, "notes": "" },
    { "id": "P15", "phone": "555-010-0115", "name": "Musa Bello", "datePledged": "2025-03-01", "amountPledged": 100, "notes": "" },
    { "id": "P16", "phone": "555-010-0116", "name": "Nadia Hussein", "datePledged": "2025-03-02", "amountPledged": 80, "notes": "" },
    { "id": "P17", "phone": "555-010-0117", "name": "Omar Farouk", "datePledged": "2025-03-05", "amountPledged": 60, "notes": "" },
    { "id": "P18", "phone": "--", "name": "Punctuation Only", "datePledged": "2025-03-06", "amountPledged": 10, "notes": "" },
    { "id": "P19", "phone": "555-010-0119", "name": "Qasim Raza", "datePledged": "2025-03-07", "amountPledged": 0, "notes": "" },
    { "id": "P20", "phone": "555-010-0120", "name": "Rukayya Bala", "datePledged": "", "amountPledged": 90, "notes": "" },
    { "id": "P21", "phone": "555-010-0121", "name": "Sami Yusuf", "datePledged": "2025-03-08", "amountPledged": 45.5, "notes": "" },
    { "id": "P22", "phone": "555-010-0122x", "name": "Tariq Obi", "datePledged": "2025-03-09", "amountPledged": 70, "notes": "" }
  ],
  "payments": [
    { "id": "Y01", "phone": "555-010-0101", "dateReceived": "2025-01-15", "amountReceived": 200, "method": "Cash", "notes": "" },
    { "id": "Y02", "phone": "555-010-0101", "dateReceived": "2025-02-15", "amountReceived": 300, "method": "Bank Transfer", "notes": "" },
    { "id": "Y03", "phone": "555-010-0102", "dateReceived": "2025-01-20", "amountReceived": 250, "method": "Card", "notes": "" },
    { "id": "Y04", "phone": "555-010-0104", "dateReceived": "2025-01-21", "amountReceived": 0.1, "method": "Online", "notes": "" },
    { "id": "Y05", "phone": "555-010-0104", "dateReceived": "2025-01-22", "amountReceived": 0.2, "method": "Online", "notes": "" },
    { "id": "Y06", "phone": "555-010-0105", "dateReceived": "2025-02-02", "amountReceived": 150, "method": "Check", "notes": "" },
    { "id": "Y07", "phone": "555-010-0106", "dateReceived": "2025-02-04", "amountReceived": 100, "method": "Cash", "notes": "" },
    { "id": "Y08", "phone": "5550100106", "dateReceived": "2025-02-05", "amountReceived": 100, "method": "Cash", "notes": "" },
    { "id": "Y09", "phone": "555.010.0106", "dateReceived": "2025-02-06", "amountReceived": 100, "method": "Other", "notes": "" },
    { "id": "Y10", "phone": "+5550100106", "dateReceived": "2025-02-07", "amountReceived": 100, "method": "", "notes": "" },
    { "id": "Y11", "phone": "555 010 0107", "dateReceived": "2025-02-08", "amountReceived": 200, "method": "Bank Transfer", "notes": "" },
    { "id": "Y12", "phone": "0551234", "dateReceived": "2025-02-11", "amountReceived": 50, "method": "Cash", "notes": "" },
    { "id": "Y13", "phone": "551234", "dateReceived": "2025-02-12", "amountReceived": 25, "method": "Cash", "notes": "" },
    { "id": "Y14", "phone": "555-010-0111", "dateReceived": "2025-02-13", "amountReceived": 40, "method": "Card", "notes": "" },
    { "id": "Y15", "phone": "555-010-0112", "dateReceived": "2025-02-15", "amountReceived": 120, "method": "Cash", "notes": "" },
    { "id": "Y16", "phone": "", "dateReceived": "2025-02-20", "amountReceived": 30, "method": "Cash", "notes": "no phone" },
    { "id": "Y17", "phone": "555-010-0114", "dateReceived": "2025-05-01", "amountReceived": 100, "method": "Online", "notes": "" },
    { "id": "Y18", "phone": "555-010-0115", "dateReceived": "", "amountReceived": 100, "method": "Cash", "notes": "undated" },
    { "id": "Y19", "phone": "555-010-0116", "dateReceived": "2025-03-03", "amountReceived": null, "method": "Cash", "notes": "amount missing" },
    { "id": "Y20", "phone": "555-010-0117", "dateReceived": "2099-06-01", "amountReceived": 60, "method": "Card", "notes": "future" },
    { "id": "Y21", "phone": "()", "dateReceived": "2025-03-07", "amountReceived": 10, "method": "Other", "notes": "" },
    { "id": "Y22", "phone": "555-010-0120", "dateReceived": "2025-04-01", "amountReceived": 30, "method": "Check", "notes": "" },
    { "id": "Y23", "phone": "555-010-0121", "dateReceived": "2025-03-10", "amountReceived": 20.25, "method": "Bank Transfer", "notes": "" },
    { "id": "Y24", "phone": "555-010-0121", "dateReceived": "2025-03-11", "amountReceived": 25.25, "method": "Bank Transfer", "notes": "" },
    { "id": "Y25", "phone": "555 010 0122X", "dateReceived": "2025-03-12", "amountReceived": 70, "method": "Online", "notes": "" },
    { "id": "Y26", "phone": "555-999-0000", "dateReceived": "2025-03-13", "amountReceived": 35, "method": "Cash", "notes": "" },
    { "id": "Y27", "phone": "555-010-0103", "dateReceived": "", "amountReceived": null, "method": "", "notes": "Promised next month" }
  ],
  "lookups": ["5550100106", "(555) 010-0107", "0551234", "551234", "555-010-0111", "555-010-0112", "555-000-0000", "--", "555 010 0122X", ""]
}
```

- [ ] **Step 2: Write the oracle** (`tools/excel-oracle.ps1`)

```powershell
#Requires -Version 7
<#
.SYNOPSIS
Regenerates test/fixtures/parity-expected.json by pushing parity-input.json through the real
workbook in Excel. Re-run whenever the workbook's formulas change, then run the parity test.
#>
param(
  [string]$Workbook = (Join-Path $PSScriptRoot '..\Masjid_Fundraiser_Tracker_v3.xlsx'),
  [string]$InputPath = (Join-Path $PSScriptRoot '..\test\fixtures\parity-input.json'),
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\test\fixtures\parity-expected.json')
)
$ErrorActionPreference = 'Stop'

$fixture = Get-Content -Raw -Encoding utf8 $InputPath | ConvertFrom-Json -DateKind String
$workingCopy = Join-Path ([IO.Path]::GetTempPath()) ("parity-" + [guid]::NewGuid() + '.xlsx')
Copy-Item $Workbook $workingCopy

function Test-Present($value) { $null -ne $value -and [string]$value -ne '' }
function ConvertTo-Serial([string]$iso) {
  [DateTime]::ParseExact($iso, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture).ToOADate()
}
# Text format first, so '0551234' keeps its leading zero exactly as a volunteer typed it.
function Set-Text($cell, [string]$value) { $cell.NumberFormat = '@'; $cell.Value2 = $value }
function Read-Cell($cell, [switch]$AsDate) {
  $value = $cell.Value2
  if ($null -eq $value -or ($value -is [string] -and $value -eq '')) { return $null }
  if ($AsDate -and $value -is [double]) { return [DateTime]::FromOADate($value).ToString('yyyy-MM-dd') }
  return $value
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $book = $excel.Workbooks.Open($workingCopy)
  $pledgeSheet = $book.Worksheets.Item('Pledges')
  $paymentSheet = $book.Worksheets.Item('Payments')
  $summarySheet = $book.Worksheets.Item('Summary')
  foreach ($sheet in @($pledgeSheet, $paymentSheet, $summarySheet)) { $sheet.Unprotect() }

  $row = 5
  foreach ($p in $fixture.pledges) {
    if (Test-Present $p.phone) { Set-Text $pledgeSheet.Range("A$row") $p.phone }
    if (Test-Present $p.name) { Set-Text $pledgeSheet.Range("B$row") $p.name }
    if (Test-Present $p.datePledged) { $pledgeSheet.Range("C$row").Value2 = ConvertTo-Serial $p.datePledged }
    if (Test-Present $p.amountPledged) { $pledgeSheet.Range("D$row").Value2 = [double]$p.amountPledged }
    if (Test-Present $p.notes) { Set-Text $pledgeSheet.Range("J$row") $p.notes }
    $row++
  }
  $row = 5
  foreach ($p in $fixture.payments) {
    if (Test-Present $p.phone) { Set-Text $paymentSheet.Range("A$row") $p.phone }
    if (Test-Present $p.dateReceived) { $paymentSheet.Range("C$row").Value2 = ConvertTo-Serial $p.dateReceived }
    if (Test-Present $p.amountReceived) { $paymentSheet.Range("D$row").Value2 = [double]$p.amountReceived }
    if (Test-Present $p.method) { Set-Text $paymentSheet.Range("E$row") $p.method }
    if (Test-Present $p.notes) { Set-Text $paymentSheet.Range("F$row") $p.notes }
    $row++
  }
  $summarySheet.Range('B4').Value2 = [double]$fixture.settings.goal
  $excel.CalculateFullRebuild()

  $pledgeResults = for ($i = 0; $i -lt $fixture.pledges.Count; $i++) {
    $r = 5 + $i
    [ordered]@{
      id = $fixture.pledges[$i].id
      E = Read-Cell $pledgeSheet.Range("E$r") -AsDate
      F = Read-Cell $pledgeSheet.Range("F$r")
      G = Read-Cell $pledgeSheet.Range("G$r")
      H = Read-Cell $pledgeSheet.Range("H$r")
      I = Read-Cell $pledgeSheet.Range("I$r")
    }
  }
  $paymentResults = for ($i = 0; $i -lt $fixture.payments.Count; $i++) {
    [ordered]@{ id = $fixture.payments[$i].id; B = Read-Cell $paymentSheet.Range("B$(5 + $i)") }
  }
  $summary = [ordered]@{}
  foreach ($r in @(5..16) + @(21..26) + @(30..37)) { $summary["B$r"] = Read-Cell $summarySheet.Range("B$r") }

  $lookupResults = foreach ($query in $fixture.lookups) {
    $lookupCell = $summarySheet.Range('B41')
    if ($query -eq '') { [void]$lookupCell.ClearContents() } else { Set-Text $lookupCell $query }
    $excel.Calculate()
    $result = [ordered]@{ input = $query }
    foreach ($r in 42..50) { $result["B$r"] = Read-Cell $summarySheet.Range("B$r") -AsDate:($r -in 43, 45) }
    $result
  }
  $book.Close($false)
}
finally {
  $excel.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  Remove-Item $workingCopy -ErrorAction SilentlyContinue
}

[ordered]@{
  source   = 'Masjid_Fundraiser_Tracker_v3.xlsx'
  today    = (Get-Date).ToString('yyyy-MM-dd')
  pledges  = @($pledgeResults)
  payments = @($paymentResults)
  summary  = $summary
  lookups  = @($lookupResults)
} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8NoBOM $OutputPath
Write-Host "Wrote $OutputPath"
```

- [ ] **Step 3: Generate the expected values**

Run (PowerShell tool): `pwsh -NoProfile -File tools/excel-oracle.ps1`
Expected: `Wrote …\parity-expected.json`, with 22 pledge rows, 27 payment rows and 10 lookups. Spot-check by hand:
- P04 `I` is `"Paid"`.
- P08 `F` is `200`.
- Y14 `B` is `"⚠ no amount on Pledges"`.
- Y15 `B` is `null`.
- P17 `E` is `"2099-06-01"`.
- B25 is `1`.

If Excel leaves an `EXCEL.EXE` process behind, end it before re-running.

- [ ] **Step 4: Write the parity test** (`test/engine/parity.test.ts`)

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compute, findByPhone, type Computed } from '../../web/src/engine';
import { toCents } from '../../web/src/money';
import type { Payment, Pledge, Settings } from '../../web/src/types';

type Cell = string | number | null;
interface FixtureInput {
  settings: Settings;
  pledges: Omit<Pledge, 'updatedAt' | 'updatedBy'>[];
  payments: Omit<Payment, 'updatedAt' | 'updatedBy'>[];
  lookups: string[];
}
interface FixtureExpected {
  today: string;
  pledges: { id: string; E: Cell; F: Cell; G: Cell; H: Cell; I: Cell }[];
  payments: { id: string; B: Cell }[];
  summary: Record<string, Cell>;
  lookups: Record<string, Cell>[];
}

const readJson = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')) as T;
const input = readJson<FixtureInput>('parity-input.json');
const expected = readJson<FixtureExpected>('parity-expected.json');
const stamp = { updatedAt: '', updatedBy: '' };
const computed = compute(
  input.pledges.map((p) => ({ ...p, ...stamp })),
  input.payments.map((p) => ({ ...p, ...stamp })),
  input.settings,
  expected.today,
);

const cents = (value: Cell): Cell => (typeof value === 'number' ? Math.round(value * 100) : value);
const blankToNull = (value: string): string | null => (value === '' ? null : value);
const MONEY_CELLS = new Set(['B5', 'B6', 'B7', 'B8', 'B15', 'B16', 'B30', 'B31', 'B32', 'B33', 'B34', 'B35', 'B36', 'B37', 'B44', 'B46', 'B47']);
const normalise = (record: Record<string, Cell>) =>
  Object.fromEntries(Object.entries(record).map(([cell, value]) => [cell, MONEY_CELLS.has(cell) ? cents(value) : value]));

function lookupBlock(result: Computed, query: string): Record<string, Cell> {
  const cells = ['B42', 'B43', 'B44', 'B45', 'B46', 'B47', 'B48', 'B49', 'B50'];
  if (query === '') return Object.fromEntries(cells.map((cell) => [cell, null]));
  const donor = findByPhone(result, query);
  if (!donor) return Object.fromEntries(cells.map((cell) => [cell, 'Not found']));
  const values: Cell[] = [
    blankToNull(donor.pledge.name),
    blankToNull(donor.pledge.datePledged),
    toCents(donor.pledge.amountPledged),
    blankToNull(donor.lastPaymentDate),
    donor.receivedCents,
    donor.balanceCents,
    donor.paymentCount,
    donor.status,
    blankToNull(donor.pledge.notes),
  ];
  return Object.fromEntries(cells.map((cell, i) => [cell, values[i]]));
}

describe('parity with Masjid_Fundraiser_Tracker_v3.xlsx (values computed by Excel)', () => {
  it('matches Pledges E–I on every row', () => {
    expect(computed.pledges.map((d) => ({ id: d.pledge.id, E: blankToNull(d.lastPaymentDate), F: d.receivedCents, G: d.balanceCents, H: d.paymentCount, I: d.status }))).toEqual(
      expected.pledges.map((row) => ({ ...row, F: cents(row.F), G: cents(row.G) })),
    );
  });

  it('matches Payments B on every row', () => {
    expect(computed.payments.map((d) => ({ id: d.payment.id, B: blankToNull(d.donorName) }))).toEqual(expected.payments);
  });

  it('matches every Summary figure', () => {
    const { totals, methods } = computed;
    const health = Object.fromEntries(computed.health.map((check) => [check.id, check.ids.length]));
    const { B14, ...rest } = normalise(expected.summary);
    expect({
      B5: totals.pledgedCents, B6: totals.receivedCents, B7: totals.outstandingCents, B8: totals.creditCents,
      B9: totals.donorCount, B10: totals.statusCounts.Paid, B11: totals.statusCounts.Partial,
      B12: totals.statusCounts.Pending, B13: totals.statusCounts.Overpaid,
      B15: totals.loggedCents, B16: totals.unmatchedCents,
      B21: health.notMatched, B22: health.duplicates, B23: health.pledgeNoPhone,
      B24: health.paymentIncomplete, B25: health.futureDated, B26: health.predatesPledge,
      B30: methods[0].cents, B31: methods[1].cents, B32: methods[2].cents, B33: methods[3].cents,
      B34: methods[4].cents, B35: methods[5].cents, B36: methods[6].cents, B37: computed.methodTotalCents,
    }).toEqual(rest);
    expect(totals.goalFraction).toBeCloseTo(Number(B14), 12);
  });

  it('matches the Donor Lookup block for every query', () => {
    for (const row of expected.lookups) {
      const { input: query, ...cells } = row;
      expect(lookupBlock(computed, String(query)), `lookup "${String(query)}"`).toEqual(normalise(cells));
    }
  });
});
```

- [ ] **Step 5: Run it**

Run: `npx vitest run test/engine/parity.test.ts`
Expected: PASS (4 tests). **If any cell differs, Excel is right.** Fix the engine, add a focused unit test for the case to Task 3 or 4's suite, and never edit `parity-expected.json` by hand.

- [ ] **Step 6: Commit**

```bash
git add test/fixtures tools/excel-oracle.ps1 test/engine/parity.test.ts
git commit -m "test(engine): parity with values computed by Excel"
```

---

### Task 6: Client validation and shared cases

**Files:**
- Create: `web/src/validate.ts`, `test/support/validationCases.ts`
- Test: `test/validate.test.ts`

**Interfaces:**
- Consumes: `isIsoDate`, `WARNING_MARK`, drafts
- Produces:
  - `FieldErrors = Partial<Record<string, string>>`
  - `amountError(value: number | null): string | undefined`
  - `validatePledge(draft: PledgeDraft): FieldErrors`
  - `validatePayment(draft: PaymentDraft, methods: readonly string[]): FieldErrors`
  - `MAX_TEXT = 500`, `MAX_AMOUNT = 1_000_000_000`
  - `VALIDATION_CASES`, which Task 7 reuses

- [ ] **Step 1: Write the shared cases** (`test/support/validationCases.ts`)

```ts
import type { PaymentDraft, PledgeDraft } from '../../web/src/types';
import { METHODS } from './factories';

export { METHODS };

const pledge: PledgeDraft = { phone: '555-010-0101', name: 'Aisha Rahman', datePledged: '2025-01-10', amountPledged: 500, notes: '' };
const payment: PaymentDraft = { phone: '555-010-0101', dateReceived: '2025-01-15', amountReceived: 200, method: 'Cash', notes: '' };

export type ValidationCase =
  | { name: string; tab: 'Pledges'; draft: PledgeDraft; invalidField: keyof PledgeDraft | null }
  | { name: string; tab: 'Payments'; draft: PaymentDraft; invalidField: keyof PaymentDraft | null };

export const VALIDATION_CASES: ValidationCase[] = [
  { name: 'complete pledge', tab: 'Pledges', draft: pledge, invalidField: null },
  { name: 'pledge with every field blank', tab: 'Pledges', draft: { phone: '', name: '', datePledged: '', amountPledged: null, notes: '' }, invalidField: null },
  { name: 'zero pledge', tab: 'Pledges', draft: { ...pledge, amountPledged: 0 }, invalidField: null },
  { name: 'negative amount', tab: 'Pledges', draft: { ...pledge, amountPledged: -1 }, invalidField: 'amountPledged' },
  { name: 'three decimal places', tab: 'Pledges', draft: { ...pledge, amountPledged: 1.005 }, invalidField: 'amountPledged' },
  { name: 'absurdly large amount', tab: 'Pledges', draft: { ...pledge, amountPledged: 1e10 }, invalidField: 'amountPledged' },
  { name: 'impossible date', tab: 'Pledges', draft: { ...pledge, datePledged: '2025-02-30' }, invalidField: 'datePledged' },
  { name: 'US-style date', tab: 'Pledges', draft: { ...pledge, datePledged: '01/10/2025' }, invalidField: 'datePledged' },
  { name: 'name posing as a warning', tab: 'Pledges', draft: { ...pledge, name: '⚠ phone not in Pledges' }, invalidField: 'name' },
  { name: 'overlong notes', tab: 'Pledges', draft: { ...pledge, notes: 'x'.repeat(501) }, invalidField: 'notes' },
  { name: 'complete payment', tab: 'Payments', draft: payment, invalidField: null },
  { name: 'float-dust amount', tab: 'Payments', draft: { ...payment, amountReceived: 0.1 + 0.2 }, invalidField: null },
  { name: 'payment with only a phone', tab: 'Payments', draft: { ...payment, dateReceived: '', amountReceived: null, method: '' }, invalidField: null },
  { name: 'payment without a phone', tab: 'Payments', draft: { ...payment, phone: '' }, invalidField: 'phone' },
  { name: 'payment with a whitespace phone', tab: 'Payments', draft: { ...payment, phone: '   ' }, invalidField: 'phone' },
  { name: 'method not in the list', tab: 'Payments', draft: { ...payment, method: 'Venmo' }, invalidField: 'method' },
];
```

- [ ] **Step 2: Write the failing test** (`test/validate.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { validatePayment, validatePledge } from '../web/src/validate';
import { METHODS, VALIDATION_CASES } from './support/validationCases';

describe('client validation', () => {
  for (const testCase of VALIDATION_CASES) {
    it(`${testCase.tab}: ${testCase.name}`, () => {
      const errors = testCase.tab === 'Pledges' ? validatePledge(testCase.draft) : validatePayment(testCase.draft, METHODS);
      if (testCase.invalidField === null) expect(errors).toEqual({});
      else expect(Object.keys(errors)).toEqual([testCase.invalidField]);
    });
  }
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run test/validate.test.ts`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 4: Implement** (`web/src/validate.ts`)

```ts
import { isIsoDate } from './dates';
import { WARNING_MARK } from './engine/constants';
import type { PaymentDraft, PledgeDraft } from './types';

// Keep these rules identical to validateRow_ in apps-script/Code.gs; test/support/validationCases.ts runs against both.
export const MAX_TEXT = 500;
export const MAX_AMOUNT = 1_000_000_000;

export type FieldErrors = Partial<Record<string, string>>;

export function amountError(value: number | null): string | undefined {
  if (value === null) return undefined;
  if (!Number.isFinite(value) || value < 0) return 'Enter an amount of 0 or more.';
  if (value > MAX_AMOUNT) return 'That amount is too large.';
  if (Math.abs(Math.round(value * 100) - value * 100) > 1e-6) return 'Use at most 2 decimal places.';
  return undefined;
}

function dateError(value: string): string | undefined {
  return value === '' || isIsoDate(value) ? undefined : 'Enter a valid date.';
}

function textError(value: string): string | undefined {
  return value.length > MAX_TEXT ? `Keep this under ${MAX_TEXT} characters.` : undefined;
}

function compact(errors: Record<string, string | undefined>): FieldErrors {
  return Object.fromEntries(Object.entries(errors).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

export function validatePledge(draft: PledgeDraft): FieldErrors {
  return compact({
    phone: textError(draft.phone),
    name: textError(draft.name) ?? (draft.name.startsWith(WARNING_MARK) ? `A name cannot start with ${WARNING_MARK}.` : undefined),
    datePledged: dateError(draft.datePledged),
    amountPledged: amountError(draft.amountPledged),
    notes: textError(draft.notes),
  });
}

export function validatePayment(draft: PaymentDraft, methods: readonly string[]): FieldErrors {
  return compact({
    phone: draft.phone.trim() === '' ? "Enter the donor's phone number." : textError(draft.phone),
    dateReceived: dateError(draft.dateReceived),
    amountReceived: amountError(draft.amountReceived),
    method: draft.method === '' || methods.includes(draft.method) ? undefined : 'Pick a method from the list.',
    notes: textError(draft.notes),
  });
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run test/validate.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/validate.ts test/support/validationCases.ts test/validate.test.ts
git commit -m "feat: client-side validation with shared case table"
```

---

### Task 7: Apps Script server

**Files:**
- Create: `apps-script/Code.gs`, `apps-script/appsscript.json`, `test/support/appsScript.ts`
- Test: `test/server/code.test.ts`

**Interfaces:**
- Consumes: the `VALIDATION_CASES` and `METHODS` wire contract from Task 6
- Produces:
  - HTTP contract: `POST {idToken, op, payload}` returns `{ok: true, data}` or `{ok: false, error: {code, message, field?, current?}}`
  - Ops: `load`, `upsertPledge`, `upsertPayment`, `deletePledge`, `deletePayment`, `setSetting`
  - Error codes: `UNAUTHENTICATED`, `FORBIDDEN`, `CONFLICT`, `NOT_FOUND`, `BAD_REQUEST`, `BUSY`, `INTERNAL`
  - `setup()`, which is run by hand once

- [ ] **Step 1: Write the fakes and loader** (`test/support/appsScript.ts`)

```ts
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const CLIENT_ID = 'test-client.apps.googleusercontent.com';
export const OWNER = 'owner@example.com';

const stripQuotePrefix = (value: unknown) => (typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value);

// Stores exactly what Code.gs writes (raw) and returns what Sheets would read back
// (a leading apostrophe forces text and is not part of the value).
export class FakeSheet {
  raw: unknown[][] = [];
  constructor(readonly name: string) {}
  private width() {
    return Math.max(0, ...this.raw.map((row) => row.length));
  }
  getDataRange() {
    const width = this.width();
    return { getValues: () => this.raw.map((row) => Array.from({ length: width }, (_, i) => stripQuotePrefix(row[i] ?? ''))) };
  }
  appendRow(values: unknown[]) {
    this.raw.push([...values]);
  }
  deleteRow(rowNumber: number) {
    this.raw.splice(rowNumber - 1, 1);
  }
  getMaxRows() {
    return 1000;
  }
  setFrozenRows(_rows: number) {}
  getRange(row: number, column: number, numRows = 1, numColumns = 1) {
    const write = (r: number, c: number, value: unknown) => {
      while (this.raw.length < r) this.raw.push([]);
      this.raw[r - 1][c - 1] = value;
    };
    return {
      setValues: (values: unknown[][]) => values.forEach((rowValues, i) => rowValues.forEach((value, j) => write(row + i, column + j, value))),
      setValue: (value: unknown) => write(row, column, value),
      setNumberFormat: (_format: string) => ({ numRows, numColumns }),
    };
  }
}

interface TokenInfo {
  status: number;
  body: Record<string, string>;
}

export function createServer() {
  const sheets = new Map<string, FakeSheet>();
  const tokens = new Map<string, TokenInfo>();
  const cache = new Map<string, string>();
  const state = { fetchCount: 0, lockAvailable: true };

  const spreadsheet = {
    getSheetByName: (name: string) => sheets.get(name) ?? null,
    insertSheet: (name: string) => {
      const sheet = new FakeSheet(name);
      sheets.set(name, sheet);
      return sheet;
    },
  };

  const context = vm.createContext({
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => ({ text, setMimeType() { return this; } }),
    },
    UrlFetchApp: {
      fetch: (url: string) => {
        state.fetchCount += 1;
        const token = decodeURIComponent(new URL(url).searchParams.get('id_token') ?? '');
        const info = tokens.get(token) ?? { status: 400, body: { error: 'invalid_token' } };
        return { getResponseCode: () => info.status, getContentText: () => JSON.stringify(info.body) };
      },
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key: string) => cache.get(key) ?? null,
        put: (key: string, value: string) => cache.set(key, value),
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => state.lockAvailable, releaseLock: () => undefined }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => (key === 'CLIENT_ID' ? CLIENT_ID : null) }) },
    Session: { getScriptTimeZone: () => 'UTC', getEffectiveUser: () => ({ getEmail: () => OWNER }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (_algorithm: string, text: string) => Array.from(createHash('sha256').update(text).digest()),
      base64EncodeWebSafe: (bytes: number[]) => Buffer.from(bytes).toString('base64url'),
      getUuid: () => randomUUID(),
      formatDate: (date: Date, _tz: string, pattern: string) => (pattern === 'yyyy-MM-dd' ? date.toISOString().slice(0, 10) : date.toISOString()),
    },
  });
  vm.runInContext(readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8'), context, { filename: 'Code.gs' });
  const call = <T>(name: string, ...args: unknown[]): T => (context[name] as (...a: unknown[]) => T)(...args);
  call('setup');

  function tokenFor(email: string, overrides: Record<string, string> = {}) {
    const token = `token-${email}-${tokens.size}`;
    tokens.set(token, {
      status: 200,
      body: { aud: CLIENT_ID, iss: 'https://accounts.google.com', email, email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 3600), ...overrides },
    });
    return token;
  }

  function post(op: string, payload: unknown, idToken: string) {
    const output = call<{ text: string }>('doPost', { postData: { contents: JSON.stringify({ idToken, op, payload }) } });
    return JSON.parse(output.text) as { ok: boolean; data?: any; error?: { code: string; message: string; field?: string; current?: any } };
  }

  return { sheets, state, call, tokenFor, post, sheet: (name: string) => sheets.get(name) as FakeSheet };
}
```

> `data?: any` appears in the *test* helper type on purpose: JSON payloads are asserted structurally. If the reviewer objects, change it to `unknown` and narrow with `expect(...).toMatchObject`. It's never used in `web/src`.

- [ ] **Step 2: Write the failing tests** (`test/server/code.test.ts`)

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { OWNER, createServer } from '../support/appsScript';
import { METHODS, VALIDATION_CASES } from '../support/validationCases';

let server: ReturnType<typeof createServer>;
let token: string;
const pledgeDraft = { phone: '555-010-0101', name: 'Aisha Rahman', datePledged: '2025-01-10', amountPledged: 500, notes: '' };
const paymentDraft = { phone: '555-010-0101', dateReceived: '2025-01-15', amountReceived: 200, method: 'Cash', notes: '' };

beforeEach(() => {
  server = createServer();
  token = server.tokenFor(OWNER);
});

describe('setup', () => {
  it('creates the four tabs with headers, defaults and the owner allowlisted', () => {
    expect(server.sheet('Pledges').getDataRange().getValues()[0]).toEqual(['id', 'phone', 'name', 'datePledged', 'amountPledged', 'notes', 'updatedAt', 'updatedBy']);
    expect(server.sheet('Payments').getDataRange().getValues()[0][3]).toBe('amountReceived');
    expect(server.sheet('Settings').getDataRange().getValues()).toEqual([['key', 'value'], ['goal', 10000], ['paymentMethods', 'Cash,Bank Transfer,Card,Check,Online,Other']]);
    expect(server.sheet('Allowlist').getDataRange().getValues()).toEqual([['email'], [OWNER]]);
  });
  it('is safe to run twice', () => {
    server.call('setup');
    expect(server.sheet('Allowlist').getDataRange().getValues()).toHaveLength(2);
    expect(server.sheet('Settings').getDataRange().getValues()).toHaveLength(3);
  });
});

describe('authentication', () => {
  it.each([
    ['a missing token', ''],
    ['an unknown token', 'forged'],
  ])('rejects %s', (_label, idToken) => {
    expect(server.post('load', {}, idToken).error?.code).toBe('UNAUTHENTICATED');
  });
  it.each([
    ['another app’s token', { aud: 'someone-else' }],
    ['an unverified email', { email_verified: 'false' }],
    ['an expired token', { exp: String(Math.floor(Date.now() / 1000) - 5) }],
    ['a foreign issuer', { iss: 'https://evil.example.com' }],
  ])('rejects %s', (_label, overrides) => {
    expect(server.post('load', {}, server.tokenFor(OWNER, overrides)).error?.code).toBe('UNAUTHENTICATED');
  });
  it('forbids accounts that are not on the allowlist', () => {
    const response = server.post('load', {}, server.tokenFor('stranger@example.com'));
    expect(response.error).toMatchObject({ code: 'FORBIDDEN', message: 'stranger@example.com is not on the volunteer list.' });
  });
  it('matches the allowlist case-insensitively', () => {
    server.sheet('Allowlist').appendRow(['  Volunteer@Example.com ']);
    expect(server.post('load', {}, server.tokenFor('volunteer@example.com')).ok).toBe(true);
  });
  it('verifies a token once, then trusts the cache', () => {
    server.post('load', {}, token);
    server.post('load', {}, token);
    expect(server.state.fetchCount).toBe(1);
  });
  it('re-checks the allowlist on every call, even for a cached token', () => {
    server.post('load', {}, token);
    server.sheet('Allowlist').raw.splice(1, 1);
    expect(server.post('load', {}, token).error?.code).toBe('FORBIDDEN');
  });
});

describe('load', () => {
  it('returns rows, settings and the caller', () => {
    expect(server.post('load', {}, token)).toEqual({
      ok: true,
      data: { pledges: [], payments: [], settings: { goal: 10000, paymentMethods: METHODS }, me: OWNER },
    });
  });
  it('cleans up rows that were edited by hand in the Sheet', () => {
    const sheet = server.sheet('Pledges');
    sheet.appendRow(['h1', 555, 'Hand Typed', new Date(Date.UTC(2025, 0, 10)), '12.5', '', '2025-01-01T00:00:00.000Z', OWNER]);
    sheet.appendRow(['', '', '', '', '', '', '', '']);
    sheet.appendRow(['h2', '1', 'Bad Amount', '', 'twelve', '', '2025-01-01T00:00:00.000Z', OWNER]);
    const { pledges } = server.post('load', {}, token).data;
    expect(pledges).toEqual([
      { id: 'h1', phone: '555', name: 'Hand Typed', datePledged: '2025-01-10', amountPledged: 12.5, notes: '', updatedAt: '2025-01-01T00:00:00.000Z', updatedBy: OWNER },
      { id: 'h2', phone: '1', name: 'Bad Amount', datePledged: '', amountPledged: null, notes: '', updatedAt: '2025-01-01T00:00:00.000Z', updatedBy: OWNER },
    ]);
  });
});

describe('writes', () => {
  it('inserts a row with a server id and stamp', () => {
    const saved = server.post('upsertPledge', pledgeDraft, token).data;
    expect(saved).toMatchObject({ ...pledgeDraft, updatedBy: OWNER });
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(server.post('load', {}, token).data.pledges).toEqual([saved]);
  });

  it.each(['+15550100101', '0551234', '=HYPERLINK("x")', '-5', '@me'])('stores the phone %s as literal text', (phone) => {
    const saved = server.post('upsertPledge', { ...pledgeDraft, phone }, token).data;
    expect(server.sheet('Pledges').raw[1][1]).toBe(`'${phone}`);
    expect(server.post('load', {}, token).data.pledges[0].phone).toBe(saved.phone);
    expect(saved.phone).toBe(phone);
  });

  it('rounds float dust to cents before storing', () => {
    expect(server.post('upsertPayment', { ...paymentDraft, amountReceived: 0.1 + 0.2 }, token).data.amountReceived).toBe(0.3);
  });

  it('updates when the caller saw the latest version', () => {
    const saved = server.post('upsertPledge', pledgeDraft, token).data;
    const updated = server.post('upsertPledge', { ...pledgeDraft, name: 'Aisha R.', id: saved.id, updatedAt: saved.updatedAt }, token);
    expect(updated.data).toMatchObject({ id: saved.id, name: 'Aisha R.' });
    expect(server.post('load', {}, token).data.pledges).toHaveLength(1);
  });

  it('refuses a stale update and returns the current row', () => {
    const saved = server.post('upsertPledge', pledgeDraft, token).data;
    const response = server.post('upsertPledge', { ...pledgeDraft, id: saved.id, updatedAt: 'stale' }, token);
    expect(response.error).toMatchObject({ code: 'CONFLICT', current: saved });
  });

  it('reports NOT_FOUND for a row someone deleted', () => {
    expect(server.post('upsertPledge', { ...pledgeDraft, id: 'gone', updatedAt: 'x' }, token).error?.code).toBe('NOT_FOUND');
    expect(server.post('deletePayment', { id: 'gone', updatedAt: 'x' }, token).error?.code).toBe('NOT_FOUND');
  });

  it('deletes with the same version check', () => {
    const saved = server.post('upsertPayment', paymentDraft, token).data;
    expect(server.post('deletePayment', { id: saved.id, updatedAt: 'stale' }, token).error?.code).toBe('CONFLICT');
    expect(server.post('deletePayment', { id: saved.id, updatedAt: saved.updatedAt }, token)).toEqual({ ok: true, data: { id: saved.id } });
    expect(server.post('load', {}, token).data.payments).toEqual([]);
  });

  it('rejects non-numeric amounts sent over the wire', () => {
    expect(server.post('upsertPledge', { ...pledgeDraft, amountPledged: '12' }, token).error).toMatchObject({ code: 'BAD_REQUEST', field: 'amountPledged' });
  });

  it('answers BUSY instead of waiting forever for the lock', () => {
    server.state.lockAvailable = false;
    expect(server.post('upsertPledge', pledgeDraft, token).error?.code).toBe('BUSY');
  });

  it('rejects unknown operations', () => {
    expect(server.post('dropTables', {}, token).error?.code).toBe('BAD_REQUEST');
  });
});

describe('settings', () => {
  it('changes the goal', () => {
    expect(server.post('setSetting', { key: 'goal', value: 25000 }, token).data).toEqual({ goal: 25000, paymentMethods: METHODS });
  });
  it('refuses a negative goal and any other key', () => {
    expect(server.post('setSetting', { key: 'goal', value: -1 }, token).error?.code).toBe('BAD_REQUEST');
    expect(server.post('setSetting', { key: 'paymentMethods', value: 'Cash' }, token).error?.code).toBe('BAD_REQUEST');
  });
});

describe('server validation matches the client', () => {
  for (const testCase of VALIDATION_CASES) {
    it(`${testCase.tab}: ${testCase.name}`, () => {
      const response = server.post(testCase.tab === 'Pledges' ? 'upsertPledge' : 'upsertPayment', testCase.draft, token);
      if (testCase.invalidField === null) expect(response.ok).toBe(true);
      else expect(response.error).toMatchObject({ code: 'BAD_REQUEST', field: testCase.invalidField });
    });
  }
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run test/server`
Expected: FAIL with "ENOENT … apps-script/Code.gs".

- [ ] **Step 4: Implement** (`apps-script/Code.gs`)

```js
// ICG Fundraiser Tracker API. Bound to the data Sheet; deployed as a web app that executes as
// the owner, so only this script ever touches the Sheet. Every request must carry a Google ID
// token for an allowlisted, verified email.

const HEADERS = {
  Pledges: ['id', 'phone', 'name', 'datePledged', 'amountPledged', 'notes', 'updatedAt', 'updatedBy'],
  Payments: ['id', 'phone', 'dateReceived', 'amountReceived', 'method', 'notes', 'updatedAt', 'updatedBy'],
};
const ENTRY_FIELDS = {
  Pledges: ['phone', 'name', 'datePledged', 'amountPledged', 'notes'],
  Payments: ['phone', 'dateReceived', 'amountReceived', 'method', 'notes'],
};
const AMOUNT_FIELDS = ['amountPledged', 'amountReceived'];
const DATE_FIELDS = ['datePledged', 'dateReceived'];
const DEFAULT_SETTINGS = [['goal', 10000], ['paymentMethods', 'Cash,Bank Transfer,Card,Check,Online,Other']];
// Keep in step with web/src/validate.ts.
const MAX_TEXT = 500;
const MAX_AMOUNT = 1000000000;
const WARNING_MARK = '⚠';
const TOKEN_CACHE_SECONDS = 300;
const LOCK_WAIT_MS = 10000;
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

class ApiError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.code = code;
    this.extra = extra || {};
  }
}

function doPost(e) {
  let body;
  try {
    const request = JSON.parse(e.postData.contents);
    const email = verifyToken_(request.idToken);
    body = { ok: true, data: dispatch_(request.op, request.payload || {}, email) };
  } catch (err) {
    body = { ok: false, error: errorBody_(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function dispatch_(op, payload, email) {
  switch (op) {
    case 'load':
      return { pledges: readRows_('Pledges'), payments: readRows_('Payments'), settings: readSettings_(), me: email };
    case 'upsertPledge':
      return withLock_(() => upsert_('Pledges', payload, email));
    case 'upsertPayment':
      return withLock_(() => upsert_('Payments', payload, email));
    case 'deletePledge':
      return withLock_(() => remove_('Pledges', payload));
    case 'deletePayment':
      return withLock_(() => remove_('Payments', payload));
    case 'setSetting':
      return withLock_(() => setSetting_(payload));
    default:
      throw new ApiError('BAD_REQUEST', 'Unknown operation: ' + op);
  }
}

function errorBody_(err) {
  if (err instanceof ApiError) return Object.assign({ code: err.code, message: err.message }, err.extra);
  console.error(err);
  return { code: 'INTERNAL', message: 'Something went wrong on the server. Try again.' };
}

function verifyToken_(token) {
  if (typeof token !== 'string' || token === '') throw new ApiError('UNAUTHENTICATED', 'Please sign in.');
  const cache = CacheService.getScriptCache();
  const cacheKey = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  let email = cache.get(cacheKey);
  if (!email) {
    const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw new ApiError('UNAUTHENTICATED', 'Your sign-in has expired. Please sign in again.');
    const info = JSON.parse(response.getContentText());
    const clientId = PropertiesService.getScriptProperties().getProperty('CLIENT_ID');
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expSeconds = Number(info.exp);
    const valid = clientId && info.aud === clientId && info.email_verified === 'true' && GOOGLE_ISSUERS.indexOf(info.iss) >= 0 && expSeconds > nowSeconds && info.email;
    if (!valid) throw new ApiError('UNAUTHENTICATED', 'Your sign-in has expired. Please sign in again.');
    email = String(info.email).toLowerCase();
    cache.put(cacheKey, email, Math.min(TOKEN_CACHE_SECONDS, expSeconds - nowSeconds));
  }
  // Not cached, so removing someone from the Allowlist takes effect on their next request.
  if (allowlist_().indexOf(email) < 0) throw new ApiError('FORBIDDEN', email + ' is not on the volunteer list.');
  return email;
}

function allowlist_() {
  return sheet_('Allowlist').getDataRange().getValues().slice(1)
    .map((row) => String(row[0]).trim().toLowerCase())
    .filter(Boolean);
}

function sheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new ApiError('INTERNAL', 'The "' + name + '" tab is missing. Run setup() in Apps Script.');
  return sheet;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) throw new ApiError('BUSY', 'The tracker is busy. Try again in a moment.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function readRows_(tab) {
  return sheet_(tab).getDataRange().getValues().slice(1)
    .filter((row) => row[0] !== '')
    .map((row) => toRecord_(tab, row));
}

function toRecord_(tab, row) {
  const record = {};
  HEADERS[tab].forEach((field, i) => {
    record[field] = fromCell_(field, row[i]);
  });
  return record;
}

// Tolerates rows typed straight into the Sheet: real dates become ISO text, junk amounts become blank.
function fromCell_(field, value) {
  if (AMOUNT_FIELDS.indexOf(field) >= 0) {
    if (value === '' || value === null || value === undefined) return null;
    const amount = Number(value);
    return isFinite(amount) ? amount : null;
  }
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return DATE_FIELDS.indexOf(field) >= 0
      ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : Utilities.formatDate(value, 'UTC', "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
  }
  return value === null || value === undefined ? '' : String(value);
}

// The apostrophe forces Sheets to store text verbatim: it keeps leading zeros and '+', stops
// dates being reinterpreted, and prevents a value like '=HYPERLINK(...)' running as a formula.
function toSheetRow_(tab, record) {
  return HEADERS[tab].map((field) => {
    const value = record[field];
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' && value !== '') return "'" + value;
    return value;
  });
}

function invalid_(field, message) {
  return new ApiError('BAD_REQUEST', message, { field: field });
}

function isIsoDate_(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function amountProblem_(value) {
  if (value === null) return '';
  if (!isFinite(value) || value < 0) return 'Enter an amount of 0 or more.';
  if (value > MAX_AMOUNT) return 'That amount is too large.';
  if (Math.abs(Math.round(value * 100) - value * 100) > 1e-6) return 'Use at most 2 decimal places.';
  return '';
}

function validateRow_(tab, payload, methods) {
  const row = {};
  ENTRY_FIELDS[tab].forEach((field) => {
    const value = payload[field];
    if (AMOUNT_FIELDS.indexOf(field) >= 0) {
      if (value !== null && typeof value !== 'number') throw invalid_(field, 'Amount must be a number.');
      const problem = amountProblem_(value);
      if (problem) throw invalid_(field, problem);
      row[field] = value === null ? null : Math.round(value * 100) / 100;
      return;
    }
    if (typeof value !== 'string') throw invalid_(field, 'Expected text.');
    if (value.length > MAX_TEXT) throw invalid_(field, 'Keep this under ' + MAX_TEXT + ' characters.');
    if (DATE_FIELDS.indexOf(field) >= 0 && value !== '' && !isIsoDate_(value)) throw invalid_(field, 'Enter a valid date.');
    row[field] = value;
  });
  if (tab === 'Pledges' && row.name.indexOf(WARNING_MARK) === 0) throw invalid_('name', 'A name cannot start with ' + WARNING_MARK + '.');
  if (tab === 'Payments') {
    if (row.phone.trim() === '') throw invalid_('phone', "Enter the donor's phone number.");
    if (row.method !== '' && methods.indexOf(row.method) < 0) throw invalid_('method', 'Pick a method from the list.');
  }
  return row;
}

function findRow_(sheet, tab, id) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) return { rowNumber: i + 1, record: toRecord_(tab, values[i]) };
  }
  return null;
}

function assertUnchanged_(found, updatedAt) {
  if (!found) throw new ApiError('NOT_FOUND', 'Someone else deleted this row.');
  if (found.record.updatedAt !== updatedAt) {
    throw new ApiError('CONFLICT', 'Someone else changed this row since you opened it.', { current: found.record });
  }
}

function upsert_(tab, payload, email) {
  const methods = tab === 'Payments' ? readSettings_().paymentMethods : [];
  const record = validateRow_(tab, payload, methods);
  record.updatedAt = new Date().toISOString();
  record.updatedBy = email;
  const sheet = sheet_(tab);
  if (!payload.id) {
    record.id = Utilities.getUuid();
    sheet.appendRow(toSheetRow_(tab, record));
    return record;
  }
  const found = findRow_(sheet, tab, payload.id);
  assertUnchanged_(found, payload.updatedAt);
  record.id = payload.id;
  sheet.getRange(found.rowNumber, 1, 1, HEADERS[tab].length).setValues([toSheetRow_(tab, record)]);
  return record;
}

function remove_(tab, payload) {
  const sheet = sheet_(tab);
  const found = findRow_(sheet, tab, payload.id);
  assertUnchanged_(found, payload.updatedAt);
  sheet.deleteRow(found.rowNumber);
  return { id: payload.id };
}

function readSettings_() {
  const values = {};
  sheet_('Settings').getDataRange().getValues().slice(1).forEach((row) => {
    values[String(row[0]).trim()] = row[1];
  });
  const goal = values.goal === '' || values.goal === undefined ? null : Number(values.goal);
  return {
    goal: goal === null || isFinite(goal) ? goal : null,
    paymentMethods: String(values.paymentMethods || '').split(',').map((method) => method.trim()).filter(Boolean),
  };
}

function setSetting_(payload) {
  if (payload.key !== 'goal') throw invalid_('key', 'Only the goal can be changed from the app.');
  const value = payload.value;
  if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > MAX_AMOUNT) throw invalid_('value', 'Enter a goal of 0 or more.');
  const goal = Math.round(value * 100) / 100;
  const sheet = sheet_('Settings');
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === 'goal') {
      sheet.getRange(i + 1, 2).setValue(goal);
      return readSettings_();
    }
  }
  sheet.appendRow(['goal', goal]);
  return readSettings_();
}

// Run once from the Apps Script editor. Safe to re-run: existing tabs are left alone.
function setup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach((tab) => {
    ensureTab_(spreadsheet, tab, HEADERS[tab], (sheet) => {
      HEADERS[tab].forEach((field, i) => {
        if (AMOUNT_FIELDS.indexOf(field) < 0) sheet.getRange(1, i + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
      });
    });
  });
  ensureTab_(spreadsheet, 'Settings', ['key', 'value'], (sheet) => DEFAULT_SETTINGS.forEach((row) => sheet.appendRow(row)));
  ensureTab_(spreadsheet, 'Allowlist', ['email'], (sheet) => {
    const owner = Session.getEffectiveUser().getEmail();
    if (owner) sheet.appendRow([owner]);
  });
}

function ensureTab_(spreadsheet, name, headers, initialise) {
  if (spreadsheet.getSheetByName(name)) return;
  const sheet = spreadsheet.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  initialise(sheet);
}
```

`apps-script/appsscript.json`:
```json
{
  "timeZone": "America/New_York",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets.currentonly",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/userinfo.email"
  ],
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run test/server`
Expected: PASS (all tests, including 16 shared validation cases).

- [ ] **Step 6: Commit**

```bash
git add apps-script test/support/appsScript.ts test/server
git commit -m "feat(server): Apps Script API with token check, allowlist, locking and conflicts"
```

---

### Task 8: API client and sign-in helpers

**Files:**
- Create: `web/src/api.ts`, `web/src/auth.ts`
- Test: `test/api.test.ts`, `test/auth.test.ts`

**Interfaces:**
- Consumes: the server contract from Task 7
- Produces:
  - `ApiErrorCode`, `class ApiError { code; field?; current? }`, `LoadResult`, `Versioned { id; updatedAt }`
  - `interface Api { load; savePledge(draft, existing?); savePayment(draft, existing?); deletePledge(row); deletePayment(row); setGoal(goal) }`
  - `TokenSource = (forceRefresh: boolean) => Promise<string>`
  - `createApi(scriptUrl, getToken, fetchImpl?)`
  - `decodeJwtPayload(token)`, `isFresh(token, nowSeconds)`
  - `interface Auth { getToken(forceRefresh); signOut() }`, `createAuth(clientId, host)`

- [ ] **Step 1: Write the failing tests**

`test/api.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from '../web/src/api';

const URL = 'https://script.google.com/macros/s/abc/exec';
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const draft = { phone: '1', name: 'A', datePledged: '', amountPledged: 5, notes: '' };

describe('createApi', () => {
  it('posts text/plain JSON so the browser skips the CORS preflight', async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true, data: { pledges: [], payments: [], settings: { goal: 1, paymentMethods: [] }, me: 'a@b.c' } }));
    const api = createApi(URL, async () => 'tok', fetchImpl);
    await api.load();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' });
    expect(JSON.parse(String(init.body))).toEqual({ idToken: 'tok', op: 'load', payload: {} });
  });

  it('sends id and version when editing, and neither when adding', async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true, data: {} }));
    const api = createApi(URL, async () => 'tok', fetchImpl);
    await api.savePledge(draft);
    await api.savePledge(draft, { id: 'p1', updatedAt: 'v1' });
    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect(bodies[0].payload).toEqual(draft);
    expect(bodies[1].payload).toEqual({ ...draft, id: 'p1', updatedAt: 'v1' });
  });

  it('turns an error body into an ApiError with its details', async () => {
    const api = createApi(URL, async () => 'tok', async () => json({ ok: false, error: { code: 'CONFLICT', message: 'changed', current: { id: 'p1' } } }));
    await expect(api.deletePledge({ id: 'p1', updatedAt: 'v0' })).rejects.toMatchObject({ code: 'CONFLICT', message: 'changed', current: { id: 'p1' } });
  });

  it('refreshes an expired token once and retries', async () => {
    const getToken = vi.fn(async (force: boolean) => (force ? 'fresh' : 'stale'));
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      JSON.parse(String(init?.body)).idToken === 'stale'
        ? json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'expired' } })
        : json({ ok: true, data: { goal: 5, paymentMethods: [] } }),
    );
    const api = createApi(URL, getToken, fetchImpl);
    await expect(api.setGoal(5)).resolves.toEqual({ goal: 5, paymentMethods: [] });
    expect(getToken.mock.calls).toEqual([[false], [true]]);
  });

  it('reports a network failure plainly', async () => {
    const api = createApi(URL, async () => 'tok', async () => { throw new TypeError('Failed to fetch'); });
    await expect(api.load()).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('explains an HTML answer, which means the deployment is misconfigured', async () => {
    const api = createApi(URL, async () => 'tok', async () => new Response('<html>Sign in</html>', { status: 200 }));
    const error = await api.load().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'INTERNAL' });
    expect((error as ApiError).message).toContain('Anyone');
  });
});
```

`test/auth.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, isFresh } from '../web/src/auth';

const encode = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

describe('decodeJwtPayload', () => {
  it('decodes base64url with UTF-8 characters', () => {
    expect(decodeJwtPayload(encode({ email: 'a@b.c', name: 'Zübeyde', exp: 100 }))).toEqual({ email: 'a@b.c', name: 'Zübeyde', exp: 100 });
  });
  it('rejects a malformed token', () => {
    expect(() => decodeJwtPayload('nope')).toThrow('Malformed');
  });
});

describe('isFresh', () => {
  it('treats a token as stale within a minute of expiry', () => {
    const token = encode({ exp: 1000 });
    expect(isFresh(token, 900)).toBe(true);
    expect(isFresh(token, 941)).toBe(false);
    expect(isFresh(null, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/api.test.ts test/auth.test.ts`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Implement**

`web/src/api.ts`:
```ts
import type { Payment, PaymentDraft, Pledge, PledgeDraft, Settings } from './types';

export type ApiErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'CONFLICT' | 'NOT_FOUND' | 'BAD_REQUEST' | 'BUSY' | 'INTERNAL' | 'NETWORK';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly field?: string;
  readonly current?: unknown;

  constructor(code: ApiErrorCode, message: string, field?: string, current?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.field = field;
    this.current = current;
  }
}

export interface LoadResult {
  pledges: Pledge[];
  payments: Payment[];
  settings: Settings;
  me: string;
}

export interface Versioned {
  id: string;
  updatedAt: string;
}

export interface Api {
  load(): Promise<LoadResult>;
  savePledge(draft: PledgeDraft, existing?: Versioned): Promise<Pledge>;
  savePayment(draft: PaymentDraft, existing?: Versioned): Promise<Payment>;
  deletePledge(row: Versioned): Promise<void>;
  deletePayment(row: Versioned): Promise<void>;
  setGoal(goal: number): Promise<Settings>;
}

export type TokenSource = (forceRefresh: boolean) => Promise<string>;

type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ApiErrorCode; message: string; field?: string; current?: unknown } };

export function createApi(scriptUrl: string, getToken: TokenSource, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Api {
  async function send<T>(op: string, payload: unknown, forceRefresh: boolean): Promise<T> {
    const idToken = await getToken(forceRefresh);
    let response: Response;
    try {
      // text/plain keeps this a "simple" request; Apps Script cannot answer a CORS preflight.
      response = await fetchImpl(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ idToken, op, payload }),
        redirect: 'follow',
      });
    } catch {
      throw new ApiError('NETWORK', 'Could not reach the tracker. Check your connection and try again.');
    }
    if (!response.ok) throw new ApiError('NETWORK', `The tracker answered with an error (${response.status}). Try again.`);
    let body: ApiResponse<T>;
    try {
      body = (await response.json()) as ApiResponse<T>;
    } catch {
      throw new ApiError('INTERNAL', 'The tracker sent back an unexpected page. The Apps Script deployment must allow access to "Anyone".');
    }
    if (body.ok) return body.data;
    throw new ApiError(body.error.code, body.error.message, body.error.field, body.error.current);
  }

  async function call<T>(op: string, payload: unknown): Promise<T> {
    try {
      return await send<T>(op, payload, false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') return send<T>(op, payload, true);
      throw err;
    }
  }

  const withVersion = <D extends object>(draft: D, existing?: Versioned) => (existing ? { ...draft, id: existing.id, updatedAt: existing.updatedAt } : draft);

  return {
    load: () => call<LoadResult>('load', {}),
    savePledge: (draft, existing) => call<Pledge>('upsertPledge', withVersion(draft, existing)),
    savePayment: (draft, existing) => call<Payment>('upsertPayment', withVersion(draft, existing)),
    deletePledge: async (row) => {
      await call<unknown>('deletePledge', { id: row.id, updatedAt: row.updatedAt });
    },
    deletePayment: async (row) => {
      await call<unknown>('deletePayment', { id: row.id, updatedAt: row.updatedAt });
    },
    setGoal: (goal) => call<Settings>('setSetting', { key: 'goal', value: goal }),
  };
}
```

`web/src/auth.ts`:
```ts
import { h } from './ui/dom';

export interface Auth {
  getToken(forceRefresh: boolean): Promise<string>;
  signOut(): void;
}

const EXPIRY_MARGIN_SECONDS = 60;
const GIS_LOAD_TIMEOUT_MS = 15000;

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) throw new Error('Malformed sign-in token.');
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

export function isFresh(token: string | null, nowSeconds: number): boolean {
  if (!token) return false;
  const exp = Number(decodeJwtPayload(token).exp);
  return Number.isFinite(exp) && exp - EXPIRY_MARGIN_SECONDS > nowSeconds;
}

function waitForGoogle(): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (typeof google !== 'undefined' && google.accounts?.id) resolve();
      else if (Date.now() - started > GIS_LOAD_TIMEOUT_MS) reject(new Error('Google sign-in did not load. Check your connection and reload the page.'));
      else setTimeout(poll, 50);
    };
    poll();
  });
}

export function createAuth(clientId: string, host: HTMLElement): Auth {
  let token: string | null = null;
  let waiting: Array<(credential: string) => void> = [];
  let initialised = false;
  const buttonSlot = h('div', { class: 'signin-button' });
  const panel = h(
    'div',
    { class: 'signin card-elevated' },
    h('p', { class: 'eyebrow' }, 'Islamic Center of Greensboro'),
    h('h1', { class: 'display-md' }, 'Fundraiser Tracker'),
    h('p', { class: 'body-md ink-soft' }, 'Sign in with the Google account the organiser added to the volunteer list.'),
    buttonSlot,
  );

  function initialise() {
    if (initialised) return;
    google.accounts.id.initialize({
      client_id: clientId,
      auto_select: true,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true,
      callback: (response) => {
        token = response.credential;
        host.hidden = true;
        host.replaceChildren();
        const resolvers = waiting;
        waiting = [];
        resolvers.forEach((resolve) => resolve(response.credential));
      },
    });
    initialised = true;
  }

  return {
    async getToken(forceRefresh) {
      if (!forceRefresh && isFresh(token, Date.now() / 1000)) return token as string;
      await waitForGoogle();
      initialise();
      return new Promise<string>((resolve) => {
        waiting.push(resolve);
        if (waiting.length > 1) return;
        host.hidden = false;
        host.replaceChildren(panel);
        google.accounts.id.renderButton(buttonSlot, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular' });
        google.accounts.id.prompt();
      });
    },
    signOut() {
      if (typeof google !== 'undefined') google.accounts.id.disableAutoSelect();
      token = null;
      window.location.reload();
    },
  };
}
```

> `token as string` is a narrowing after `isFresh` has proved it non-null. It isn't an `any` escape. If `@types/google.accounts` lacks `use_fedcm_for_prompt`, delete that line and don't cast around it.

`auth.ts` imports `h` from `web/src/ui/dom.ts`, which Task 11 creates. Create `dom.ts` now, exactly as written in Task 11 Step 3, so this task typechecks.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run test/api.test.ts test/auth.test.ts && npm run typecheck`
Expected: PASS, and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/auth.ts web/src/ui/dom.ts test/api.test.ts test/auth.test.ts
git commit -m "feat: Apps Script client with token refresh, Google sign-in wrapper"
```

---

### Task 9: Store with optimistic writes

**Files:**
- Create: `web/src/store.ts`
- Test: `test/store.test.ts`

**Interfaces:**
- Consumes: `Api`, `ApiError`, `compute`, `Computed`
- Produces:
  - `State { pledges; payments; settings; me; computed }`
  - `interface Store { state(); subscribe(fn); load(); savePledge(draft, existing?); savePayment(draft, existing?); deletePledge(row); deletePayment(row); setGoal(goal) }`
  - `createStore(api, today: () => string)`
  - `isPending(row: { id: string }): boolean`

- [ ] **Step 1: Write the failing tests** (`test/store.test.ts`)

```ts
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../web/src/api';
import { createStore, isPending } from '../web/src/store';
import type { Pledge } from '../web/src/types';
import { SETTINGS, TODAY, payment, pledge } from './support/factories';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const aisha = pledge({ id: 'p1', phone: '1', name: 'Aisha', amountPledged: 100 });
function fakeApi(overrides: Partial<Api> = {}): Api {
  return {
    load: async () => ({ pledges: [aisha], payments: [payment({ id: 'y1', phone: '1', amountReceived: 40 })], settings: SETTINGS, me: 'me@example.com' }),
    savePledge: async (draft, existing) => ({ ...aisha, ...draft, id: existing?.id ?? 'server-id', updatedAt: 'v2' }),
    savePayment: async (draft) => ({ ...payment(), ...draft, id: 'server-pay' }),
    deletePledge: async () => undefined,
    deletePayment: async () => undefined,
    setGoal: async (goal) => ({ ...SETTINGS, goal }),
    ...overrides,
  };
}
const draftOf = (p: Pledge) => ({ phone: p.phone, name: p.name, datePledged: p.datePledged, amountPledged: p.amountPledged, notes: p.notes });

describe('store', () => {
  it('computes derived state on load and notifies subscribers', async () => {
    const store = createStore(fakeApi(), () => TODAY);
    const listener = vi.fn();
    store.subscribe(listener);
    await store.load();
    expect(store.state()?.computed.pledges[0].receivedCents).toBe(4000);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('shows a new row immediately, then swaps in the server copy', async () => {
    const pending = deferred<Pledge>();
    const store = createStore(fakeApi({ savePledge: () => pending.promise }), () => TODAY);
    await store.load();
    const saving = store.savePledge({ ...draftOf(aisha), phone: '2', name: 'Bilal' });
    const provisional = store.state()?.pledges.at(-1);
    expect(provisional?.name).toBe('Bilal');
    expect(provisional && isPending(provisional)).toBe(true);
    pending.resolve({ ...aisha, id: 'server-id', phone: '2', name: 'Bilal', updatedAt: 'v1' });
    await saving;
    expect(store.state()?.pledges.map((p) => p.id)).toEqual(['p1', 'server-id']);
  });

  it('rolls an edit back and rethrows when the server refuses it', async () => {
    const conflict = new ApiError('CONFLICT', 'changed');
    const store = createStore(fakeApi({ savePledge: async () => { throw conflict; } }), () => TODAY);
    await store.load();
    await expect(store.savePledge({ ...draftOf(aisha), name: 'Changed' }, aisha)).rejects.toBe(conflict);
    expect(store.state()?.pledges[0].name).toBe('Aisha');
  });

  it('removes a failed new row entirely', async () => {
    const store = createStore(fakeApi({ savePledge: async () => { throw new ApiError('NETWORK', 'offline'); } }), () => TODAY);
    await store.load();
    await expect(store.savePledge(draftOf(aisha))).rejects.toMatchObject({ code: 'NETWORK' });
    expect(store.state()?.pledges).toHaveLength(1);
  });

  it('restores a row at its old position when a delete fails', async () => {
    const store = createStore(
      fakeApi({
        load: async () => ({ pledges: [aisha, pledge({ id: 'p2' }), pledge({ id: 'p3' })], payments: [], settings: SETTINGS, me: 'me@example.com' }),
        deletePledge: async () => { throw new ApiError('BUSY', 'busy'); },
      }),
      () => TODAY,
    );
    await store.load();
    const middle = store.state()?.pledges[1] as Pledge;
    await expect(store.deletePledge(middle)).rejects.toMatchObject({ code: 'BUSY' });
    expect(store.state()?.pledges.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('treats deleting an already-deleted row as done', async () => {
    const store = createStore(fakeApi({ deletePledge: async () => { throw new ApiError('NOT_FOUND', 'gone'); } }), () => TODAY);
    await store.load();
    await expect(store.deletePledge(aisha)).resolves.toBeUndefined();
    expect(store.state()?.pledges).toEqual([]);
  });

  it('updates the goal optimistically and rolls back on failure', async () => {
    const store = createStore(fakeApi({ setGoal: async () => { throw new ApiError('BAD_REQUEST', 'no'); } }), () => TODAY);
    await store.load();
    const attempt = store.setGoal(99);
    expect(store.state()?.settings.goal).toBe(99);
    await expect(attempt).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(store.state()?.settings.goal).toBe(SETTINGS.goal);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/store.test.ts`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Implement** (`web/src/store.ts`)

```ts
import { ApiError, type Api } from './api';
import { compute, type Computed } from './engine';
import type { Payment, PaymentDraft, Pledge, PledgeDraft, Settings } from './types';

export interface State {
  pledges: Pledge[];
  payments: Payment[];
  settings: Settings;
  me: string;
  computed: Computed;
}

type Base = Omit<State, 'computed'>;
type Row = Pledge | Payment;
type Listener = (state: State) => void;

export interface Store {
  state(): State | null;
  subscribe(listener: Listener): () => void;
  load(): Promise<void>;
  savePledge(draft: PledgeDraft, existing?: Pledge): Promise<void>;
  savePayment(draft: PaymentDraft, existing?: Payment): Promise<void>;
  deletePledge(row: Pledge): Promise<void>;
  deletePayment(row: Payment): Promise<void>;
  setGoal(goal: number): Promise<void>;
}

const PENDING_PREFIX = 'pending-';

export function isPending(row: { id: string }): boolean {
  return row.id.startsWith(PENDING_PREFIX);
}

interface Collection<T extends Row> {
  get(state: Base): T[];
  with(state: Base, rows: T[]): Base;
}

const base = (state: State): Base => ({ pledges: state.pledges, payments: state.payments, settings: state.settings, me: state.me });
const pledgeRows: Collection<Pledge> = { get: (s) => s.pledges, with: (s, rows) => ({ ...s, pledges: rows }) };
const paymentRows: Collection<Payment> = { get: (s) => s.payments, with: (s, rows) => ({ ...s, payments: rows }) };

export function createStore(api: Api, today: () => string): Store {
  let current: State | null = null;
  let pendingCount = 0;
  const listeners = new Set<Listener>();

  function publish(next: Base) {
    const state: State = { ...next, computed: compute(next.pledges, next.payments, next.settings, today()) };
    current = state;
    listeners.forEach((listener) => listener(state));
  }

  function loaded(): Base {
    if (!current) throw new Error('The tracker has not finished loading.');
    return base(current);
  }

  async function save<T extends Row>(collection: Collection<T>, provisional: T, existing: T | undefined, send: () => Promise<T>) {
    const rows = collection.get(loaded());
    publish(collection.with(loaded(), existing ? rows.map((r) => (r.id === existing.id ? provisional : r)) : [...rows, provisional]));
    try {
      const saved = await send();
      publish(collection.with(loaded(), collection.get(loaded()).map((r) => (r.id === provisional.id ? saved : r))));
    } catch (err) {
      const now = collection.get(loaded());
      const rolledBack = existing ? now.map((r) => (r.id === existing.id ? existing : r)) : now.filter((r) => r.id !== provisional.id);
      publish(collection.with(loaded(), rolledBack));
      throw err;
    }
  }

  async function remove<T extends Row>(collection: Collection<T>, row: T, send: () => Promise<void>) {
    const index = collection.get(loaded()).findIndex((r) => r.id === row.id);
    publish(collection.with(loaded(), collection.get(loaded()).filter((r) => r.id !== row.id)));
    try {
      await send();
    } catch (err) {
      // The row is already gone on the server, which is what the user asked for.
      if (err instanceof ApiError && err.code === 'NOT_FOUND') return;
      const restored = [...collection.get(loaded())];
      restored.splice(index < 0 ? restored.length : Math.min(index, restored.length), 0, row);
      publish(collection.with(loaded(), restored));
      throw err;
    }
  }

  const provisionalFields = (existing: Row | undefined) => ({
    id: existing?.id ?? `${PENDING_PREFIX}${++pendingCount}`,
    updatedAt: existing?.updatedAt ?? '',
    updatedBy: existing?.updatedBy ?? loaded().me,
  });

  return {
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load() {
      const result = await api.load();
      publish({ pledges: result.pledges, payments: result.payments, settings: result.settings, me: result.me });
    },
    savePledge: (draft, existing) => save(pledgeRows, { ...provisionalFields(existing), ...draft }, existing, () => api.savePledge(draft, existing)),
    savePayment: (draft, existing) => save(paymentRows, { ...provisionalFields(existing), ...draft }, existing, () => api.savePayment(draft, existing)),
    deletePledge: (row) => remove(pledgeRows, row, () => api.deletePledge(row)),
    deletePayment: (row) => remove(paymentRows, row, () => api.deletePayment(row)),
    async setGoal(goal) {
      const previous = loaded().settings;
      publish({ ...loaded(), settings: { ...previous, goal } });
      try {
        const settings = await api.setGoal(goal);
        publish({ ...loaded(), settings });
      } catch (err) {
        publish({ ...loaded(), settings: previous });
        throw err;
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/store.test.ts && npm run typecheck`
Expected: PASS (7 tests), and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/store.ts test/store.test.ts
git commit -m "feat: store with optimistic writes and rollback"
```

---

### Task 10: Design system CSS and theme toggle

Delegate this task to a subagent that loads the `frontend-design:frontend-design` skill and reads `DESIGN.md`. The CSS below is the baseline to implement. The subagent may refine spacing and details, but must not add colours or break the Global Constraints.

**Files:**
- Create: `web/src/styles/tokens.css`, `web/src/styles/base.css`, `web/src/styles/components.css`, `web/src/theme.ts`
- Test: `test/theme.test.ts`

**Interfaces:**
- Produces:
  - `Theme`, `currentTheme()`, `toggleTheme(): Theme`, and a `themechange` event on `document`
  - Class names used by Tasks 11–14: `btn btn-primary|btn-secondary|btn-ghost|btn-danger`, `input`, `field`, `label`, `help`, `field-error`, `card`, `card-elevated`, `stat-card`, `stat-label`, `stat-value`, `progress-track`, `progress-fill`, `badge badge-active|badge-inactive|badge-category`, `method-*`, `data-table`, `table-wrap`, `num`, `derived`, `row-danger`, `row-pending`, `cell-warning`, `warning-text`, `modal`, `modal-title`, `modal-actions`, `toasts`, `toast toast-info|toast-error`, `banner banner-warning`, `chip`, `view`, `view-header`, `toolbar`, `totals-band`, `container`, `container-wide`, `nav-bar`, `nav-inner`, `wordmark`, `tabs`, `tab`, `nav-actions`, `eyebrow`, `display-md`, `display-lg`, `heading-md`, `body-md`, `meta`, `ink-soft`, `gold`, `numeric-xl`, `numeric-lg`, `empty`, `hint`, `hint-warning`, `skeleton`, `health-list`, `method-grid`, `swatch`, `is-flagged`, `signin`, `signin-button`, `grid-stats`, `lookup-card`, `match-list`, `match`, `required`, `spacer`

- [ ] **Step 1: Write the failing test** (`test/theme.test.ts`)

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { currentTheme, toggleTheme } from '../web/src/theme';

describe('theme', () => {
  it('toggles, remembers the choice and announces the change', () => {
    document.documentElement.dataset.theme = 'light';
    const listener = vi.fn();
    document.addEventListener('themechange', listener);
    expect(toggleTheme()).toBe('dark');
    expect(currentTheme()).toBe('dark');
    expect(localStorage.getItem('icg-theme')).toBe('dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/theme.test.ts`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Implement `web/src/theme.ts`**

```ts
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'icg-theme';

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch (err) {
    console.warn('Theme preference could not be saved; it will reset on reload.', err);
  }
  document.dispatchEvent(new Event('themechange'));
  return next;
}
```

- [ ] **Step 4: Write `web/src/styles/tokens.css`**

```css
/* Mirrors DESIGN.md (ICG Heritage). The only file allowed to contain colour literals. */
:root {
  --color-bg: #fbf9f3;
  --color-surface: #ffffff;
  --color-surface-soft: #f5f1e8;
  --color-surface-sunken: #efe9d9;
  --color-ink: #1a2e1f;
  --color-ink-soft: #5a6b5f;
  --color-ink-muted: #8a9690;
  --color-rule: #e8e0cc;
  --color-rule-strong: #d4c79e;
  --color-gold: #a87c0a;
  --color-gold-soft: #c69b2a;
  --color-gold-tint: #f7eecf;
  --color-emerald: #2d5e3e;
  --color-emerald-soft: #3f7551;
  --color-emerald-tint: #dde9df;
  --color-warning: #9c6b1f;
  --color-warning-tint: #f4e4c2;
  --color-danger: #8b2e2e;
  --color-danger-tint: #f0d8d8;
  --color-payment-cash: #2d5e3e;
  --color-payment-bank: #3a5a8c;
  --color-payment-card: #6b4d8c;
  --color-payment-online: #a8651f;
  --chart-1: #2d5e3e;
  --chart-2: #a87c0a;
  --chart-3: #3a5a8c;
  --chart-4: #8b2e2e;
  --chart-5: #6b4d8c;
  --chart-6: #a8651f;
  --color-scrim: rgba(26, 46, 31, 0.2);
  --shadow-rest: 0 1px 2px rgba(26, 46, 31, 0.04), 0 4px 16px rgba(26, 46, 31, 0.05);
  --shadow-lift: 0 4px 8px rgba(26, 46, 31, 0.06), 0 16px 40px rgba(26, 46, 31, 0.1);

  --font-display: 'Cormorant Garamond', Georgia, serif;
  --font-ui: 'Inter Variable', Inter, system-ui, sans-serif;

  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 20px;
  --radius-full: 9999px;

  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 40px;
  --space-2xl: 72px;
  --space-3xl: 120px;

  --container: 1080px;
  --container-wide: 1200px;
  color-scheme: light;
}

/* Screen-only, so printing always uses the light tokens above. */
@media screen {
  :root[data-theme='dark'] {
    --color-bg: #15110a;
    --color-surface: #1f1a10;
    --color-surface-soft: #28221a;
    --color-surface-sunken: #1a160e;
    --color-ink: #f1ebd8;
    --color-ink-soft: #c5bda3;
    --color-ink-muted: #8a8270;
    --color-rule: #3a3320;
    --color-rule-strong: #5a4f30;
    --color-gold: #d4af37;
    --color-gold-soft: #e6c463;
    --color-gold-tint: #3d3415;
    --color-emerald: #5a9b6f;
    --color-emerald-soft: #73b187;
    --color-emerald-tint: #1f3a26;
    --color-warning: #d4a04a;
    --color-warning-tint: #3d2e12;
    --color-danger: #c65656;
    --color-danger-tint: #3a1818;
    --color-payment-cash: #5a9b6f;
    --color-payment-bank: #7591c4;
    --color-payment-card: #9b7ec4;
    --color-payment-online: #d4914a;
    --chart-1: #5a9b6f;
    --chart-2: #d4af37;
    --chart-3: #7591c4;
    --chart-4: #c65656;
    --chart-5: #9b7ec4;
    --chart-6: #d4914a;
    --color-scrim: rgba(10, 8, 4, 0.55);
    --shadow-rest: 0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 16px rgba(0, 0, 0, 0.25);
    --shadow-lift: 0 4px 8px rgba(0, 0, 0, 0.35), 0 16px 40px rgba(0, 0, 0, 0.45);
    color-scheme: dark;
  }
}
```

- [ ] **Step 5: Write `web/src/styles/base.css`**

```css
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-ink);
  font: 400 0.9375rem/1.6 var(--font-ui);
  font-feature-settings: 'tnum';
}
h1, h2, h3, p, dl, dd, ul { margin: 0; }
ul { padding: 0; list-style: none; }
button, input, select, textarea { font: inherit; color: inherit; }
a { color: var(--color-emerald); }
[hidden] { display: none !important; }
:focus-visible { outline: 2px solid var(--color-gold); outline-offset: 2px; }

.display-lg { font: 500 2.75rem/1.15 var(--font-display); letter-spacing: -0.005em; }
.display-md { font: 500 2rem/1.2 var(--font-display); }
.heading-md { font: 600 1.125rem/1.4 var(--font-ui); }
.body-md { font-size: 0.9375rem; line-height: 1.6; }
.label { font: 500 0.8125rem/1.4 var(--font-ui); letter-spacing: 0.01em; }
.meta { font-size: 0.75rem; line-height: 1.5; letter-spacing: 0.02em; color: var(--color-ink-muted); }
.eyebrow { font: 600 0.6875rem/1.4 var(--font-ui); letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-ink-soft); }
.numeric-xl { font: 600 2.25rem/1.1 var(--font-ui); letter-spacing: -0.01em; font-feature-settings: 'tnum'; }
.numeric-lg { font: 600 1.5rem/1.2 var(--font-ui); font-feature-settings: 'tnum'; }
.ink-soft { color: var(--color-ink-soft); }
.gold { color: var(--color-gold); }
.warning-text { color: var(--color-danger); font-weight: 500; }

.container { max-width: var(--container); margin: 0 auto; padding: var(--space-xl) var(--space-md) var(--space-2xl); }
.container-wide { max-width: var(--container-wide); }
.view { display: grid; gap: var(--space-lg); }
.view-header { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-md); flex-wrap: wrap; }
.view-header h1 { margin-top: var(--space-xs); }
.view-header h1::after { content: ''; display: block; width: 80px; height: 1px; margin-top: var(--space-sm); background: var(--color-gold); }
.toolbar { display: flex; gap: var(--space-sm); align-items: center; flex-wrap: wrap; }
.spacer { flex: 1; }
.empty { padding: var(--space-xl) var(--space-md); text-align: center; color: var(--color-ink-muted); }

@media print {
  .nav-bar, .toolbar, .btn, .banner, .toasts { display: none !important; }
  .container { padding: 0; max-width: none; }
  .card, .stat-card { box-shadow: none; break-inside: avoid; }
}
```

- [ ] **Step 6: Write `web/src/styles/components.css`**

```css
/* Nav */
.nav-bar { position: sticky; top: 0; z-index: 10; background: var(--color-bg); }
.nav-inner { max-width: var(--container-wide); margin: 0 auto; padding: var(--space-md) var(--space-md); display: flex; align-items: center; gap: var(--space-lg); flex-wrap: wrap; }
.wordmark {
  font: 600 1.125rem/1.2 var(--font-display);
  text-decoration: none;
  background: linear-gradient(to right, var(--color-gold), var(--color-emerald));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.tabs { display: flex; gap: var(--space-xs); flex: 1; overflow-x: auto; }
.tab { padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm); color: var(--color-ink-soft); text-decoration: none; font: 500 0.8125rem/1.4 var(--font-ui); white-space: nowrap; }
.tab:hover { background: var(--color-surface-soft); }
.tab[aria-current='page'] { color: var(--color-ink); box-shadow: inset 0 -2px 0 var(--color-gold); }
.nav-actions { display: flex; align-items: center; gap: var(--space-sm); }

/* Buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-xs); border: 1px solid transparent; border-radius: var(--radius-sm); padding: 10px 20px; font: 500 0.8125rem/1.4 var(--font-ui); letter-spacing: 0.01em; cursor: pointer; min-height: 40px; }
.btn:disabled { opacity: 0.6; cursor: progress; }
.btn-primary { background: var(--color-emerald); color: var(--color-surface); }
.btn-primary:hover:not(:disabled) { background: var(--color-emerald-soft); }
.btn-secondary { background: var(--color-surface); color: var(--color-ink); border-color: var(--color-rule); }
.btn-secondary:hover:not(:disabled) { border-color: var(--color-rule-strong); }
.btn-ghost { background: transparent; color: var(--color-ink-soft); padding: 8px 12px; }
.btn-ghost:hover:not(:disabled) { background: var(--color-surface-soft); color: var(--color-ink); }
.btn-danger { background: var(--color-danger); color: var(--color-surface); padding: 8px 14px; }

/* Inputs */
.field { display: grid; gap: var(--space-xs); }
.input { width: 100%; background: var(--color-surface); border: 1px solid var(--color-rule); border-radius: var(--radius-sm); padding: 10px 14px; min-height: 44px; }
.input:focus { outline: 3px solid var(--color-emerald-tint); border-color: var(--color-emerald); }
.input[aria-invalid='true'] { border-color: var(--color-danger); }
textarea.input { resize: vertical; }
.search { max-width: 360px; }
.help { font-size: 0.75rem; color: var(--color-ink-muted); }
.field-error { font-size: 0.8125rem; color: var(--color-danger); }
.required { color: var(--color-danger); }
.hint { font-size: 0.8125rem; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm); background: var(--color-surface-soft); }
.hint-warning { background: var(--color-warning-tint); color: var(--color-warning); }
.form { display: grid; gap: var(--space-md); }

/* Cards, stats, progress */
.card, .card-elevated, .stat-card { background: var(--color-surface); border: 1px solid var(--color-rule); border-radius: var(--radius-md); box-shadow: var(--shadow-rest); }
.card { padding: var(--space-lg); display: grid; gap: var(--space-md); }
.card-elevated { padding: 32px; }
.grid-stats { display: grid; gap: var(--space-lg); grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
.stat-card { padding: 20px 24px; display: grid; gap: var(--space-xs); }
.stat-value { color: var(--color-gold); }
.progress-track { height: 6px; border-radius: var(--radius-full); background: var(--color-surface-sunken); overflow: hidden; }
.progress-fill { height: 100%; border-radius: var(--radius-full); background: var(--color-emerald); }
.is-flagged { background: var(--color-warning-tint); border-color: var(--color-warning); }

/* Badges */
.badge { display: inline-block; border-radius: var(--radius-full); padding: 2px 10px; font-size: 0.75rem; line-height: 1.5; white-space: nowrap; }
.badge-active { background: var(--color-emerald-tint); color: var(--color-emerald); }
.badge-inactive { background: var(--color-warning-tint); color: var(--color-warning); }
.badge-category { background: var(--color-gold-tint); color: var(--color-gold); }
.method { background: var(--color-surface-soft); color: var(--color-ink-soft); }
.method-cash { background: var(--color-emerald-tint); color: var(--color-payment-cash); }
.method-bank-transfer { color: var(--color-payment-bank); }
.method-card { color: var(--color-payment-card); }
.method-online { color: var(--color-payment-online); }

/* Tables */
.table-wrap { background: var(--color-surface); border: 1px solid var(--color-rule); border-radius: var(--radius-md); box-shadow: var(--shadow-rest); overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th { text-align: left; padding: var(--space-sm) var(--space-md); border-bottom: 1px solid var(--color-rule-strong); }
.data-table th button { all: unset; cursor: pointer; font: 600 0.6875rem/1.4 var(--font-ui); letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-ink-soft); }
.data-table th[aria-sort] button { color: var(--color-ink); }
.data-table td { padding: var(--space-sm) var(--space-md); height: 48px; border-bottom: 1px solid var(--color-rule); vertical-align: middle; }
.data-table tbody tr { cursor: pointer; }
.data-table tbody tr:hover { background: var(--color-surface-soft); }
.data-table tbody tr:last-child td { border-bottom: 0; }
.data-table .num { text-align: right; white-space: nowrap; }
.data-table .derived { color: var(--color-ink-soft); }
.row-danger { background: var(--color-danger-tint); }
.row-danger:hover { background: var(--color-danger-tint) !important; }
.row-pending { opacity: 0.6; cursor: progress !important; }
.cell-warning { background: var(--color-warning-tint); color: var(--color-warning); }
.totals-band { font-size: 0.8125rem; color: var(--color-ink-soft); }

@media (max-width: 720px) {
  .data-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .data-table, .data-table tbody, .data-table tr, .data-table td { display: block; }
  .data-table tr { padding: var(--space-sm) 0; border-bottom: 1px solid var(--color-rule); }
  .data-table td { height: auto; border: 0; display: flex; justify-content: space-between; gap: var(--space-md); padding: var(--space-xs) var(--space-md); text-align: right; }
  .data-table td::before { content: attr(data-label); font: 600 0.6875rem/1.8 var(--font-ui); letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-ink-muted); text-align: left; }
}

/* Modal */
.modal { border: 1px solid var(--color-rule); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-ink); padding: 32px; width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 32px); box-shadow: var(--shadow-lift); }
.modal::backdrop { background: var(--color-scrim); }
.modal-title { font: 500 2rem/1.2 var(--font-display); margin-bottom: var(--space-lg); }
.modal-actions { display: flex; gap: var(--space-sm); margin-top: var(--space-lg); flex-wrap: wrap; }

/* Toasts, banners, chips */
.toasts { position: fixed; bottom: var(--space-md); left: 50%; transform: translateX(-50%); display: grid; gap: var(--space-sm); z-index: 50; width: min(480px, calc(100vw - 32px)); }
.toast { padding: var(--space-md); border-radius: var(--radius-sm); background: var(--color-surface); border: 1px solid var(--color-rule); box-shadow: var(--shadow-lift); }
.toast-error { border-color: var(--color-danger); color: var(--color-danger); }
.banner { padding: var(--space-sm) var(--space-md); text-align: center; font-size: 0.8125rem; }
.banner-warning { background: var(--color-warning-tint); color: var(--color-warning); }
.chip { border: 1px solid var(--color-rule-strong); background: var(--color-gold-tint); color: var(--color-ink); border-radius: var(--radius-full); padding: 4px 12px; cursor: pointer; font-size: 0.8125rem; }

/* Summary */
.health-list li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); padding: var(--space-sm) 0; border-bottom: 1px solid var(--color-rule); }
.health-list li:last-child { border-bottom: 0; }
.method-grid { display: grid; gap: var(--space-lg); grid-template-columns: minmax(180px, 240px) 1fr; align-items: center; }
@media (max-width: 720px) { .method-grid { grid-template-columns: 1fr; } }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: var(--radius-full); margin-right: var(--space-sm); background: var(--color-rule-strong); }
.stat-row { display: flex; flex-wrap: wrap; gap: var(--space-xl); }

/* Lookup, sign-in, loading */
.lookup-card dl { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-sm) var(--space-lg); }
.lookup-card dt { color: var(--color-ink-muted); }
.match-list { display: grid; gap: var(--space-xs); }
.match { all: unset; cursor: pointer; display: block; padding: var(--space-sm) var(--space-md); border-radius: var(--radius-sm); }
.match:hover, .match:focus-visible { background: var(--color-surface-soft); }
.signin { max-width: 440px; margin: var(--space-3xl) auto; display: grid; gap: var(--space-md); text-align: center; justify-items: center; }
.skeleton { height: 120px; border-radius: var(--radius-md); background: var(--color-surface-sunken); }
```

- [ ] **Step 7: Verify**

Run: `npx vitest run test/theme.test.ts && npm run build`
Expected: PASS, and the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add web/src/styles web/src/theme.ts test/theme.test.ts
git commit -m "feat(ui): ICG Heritage design tokens, components, light/dark theme"
```

---

### Task 11: UI primitives

**Files:**
- Create: `web/src/ui/dom.ts` (if Task 8 didn't already), `web/src/format.ts`, `web/src/ui/table.ts`, `web/src/ui/dialog.ts`, `web/src/ui/toast.ts`, `web/src/ui/field.ts`, `web/src/ui/form.ts`, `web/src/ui/badges.ts`, `web/src/ui/search.ts`, `web/src/ui/filter.ts`, `web/src/ui/errors.ts`
- Test: `test/ui/format.test.ts`, `test/ui/table.test.ts`, `test/ui/form.test.ts`

**Interfaces:**
- Consumes: `ApiError`, `FieldErrors`, `matchKey`, `Status`
- Produces:
  - `h(tag, attrs?, ...children)`, `Child`
  - `formatCents(cents | null)`, `formatDate(iso)`, `formatPercent(fraction)`, `parseAmount(text): number | null | 'invalid'`
  - `Column<R>`, `SortState`, `nextSort(current, key)`, `sortRows(rows, columns, sort)`, `renderTable(options)`
  - `openDialog(title, body, footer): DialogHandle`, `confirmDialog(message, confirmLabel, variant?): Promise<boolean>`
  - `showToast(message, kind?)`
  - `field(options): Field`
  - `runForm<D>(spec): DialogHandle`
  - `statusBadge(status)`, `methodBadge(method)`
  - `matchesQuery(query, texts, key)`
  - `ListFilter`, `filterChip(filter, onClear)`
  - `createErrorReporter(reload)`, `messageOf(err)`

- [ ] **Step 1: Write the failing tests**

`test/ui/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatCents, formatDate, formatPercent, parseAmount } from '../../web/src/format';

describe('format', () => {
  it('shows money like the workbook, with credits in brackets', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-5000)).toBe('($50.00)');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(null)).toBe('');
  });
  it('formats ISO dates without timezone drift', () => {
    expect(formatDate('2025-01-10')).toBe('Jan 10, 2025');
    expect(formatDate('')).toBe('');
  });
  it('formats percentages', () => {
    expect(formatPercent(0.035)).toBe('3.5%');
  });
  it('parses what volunteers type', () => {
    expect(parseAmount(' $1,250.50 ')).toBe(1250.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('twelve')).toBe('invalid');
  });
});
```

`test/ui/table.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { nextSort, renderTable, sortRows, type Column } from '../../web/src/ui/table';
import { matchesQuery } from '../../web/src/ui/search';

interface Row { id: string; name: string; amount: number | null }
const columns: Column<Row>[] = [
  { key: 'name', label: 'Name', value: (r) => r.name },
  { key: 'amount', label: 'Amount', numeric: true, value: (r) => r.amount },
];
const rows: Row[] = [
  { id: 'a', name: 'Bilal', amount: 20 },
  { id: 'b', name: '<img src=x onerror="window.hacked=1">', amount: null },
  { id: 'c', name: 'aisha', amount: 5 },
];

describe('table', () => {
  it('renders user text as text, never as HTML', () => {
    const table = renderTable({ columns, rows, sort: null, rowId: (r) => r.id, onSort: () => undefined, empty: 'none' });
    expect(table.querySelector('img')).toBeNull();
    expect(table.textContent).toContain('<img src=x onerror="window.hacked=1">');
  });
  it('sorts numbers numerically, text naturally, blanks last in both directions', () => {
    expect(sortRows(rows, columns, { key: 'amount', direction: 'asc' }).map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(sortRows(rows, columns, { key: 'amount', direction: 'desc' }).map((r) => r.id)).toEqual(['a', 'c', 'b']);
    expect(sortRows(rows, columns, { key: 'name', direction: 'asc' }).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
  it('toggles direction on the same column and resets on a new one', () => {
    expect(nextSort(null, 'name')).toEqual({ key: 'name', direction: 'asc' });
    expect(nextSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({ key: 'name', direction: 'desc' });
    expect(nextSort({ key: 'name', direction: 'desc' }, 'amount')).toEqual({ key: 'amount', direction: 'asc' });
  });
  it('opens a row by click and by Enter', () => {
    const onOpen = vi.fn();
    const table = renderTable({ columns, rows, sort: null, rowId: (r) => r.id, onSort: () => undefined, onOpen, empty: 'none' });
    const [first, second] = table.querySelectorAll('tbody tr');
    (first as HTMLElement).click();
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onOpen.mock.calls.map((call) => call[0].id)).toEqual(['a', 'b']);
  });
  it('shows the empty message when there are no rows', () => {
    expect(renderTable({ columns, rows: [], sort: null, rowId: (r) => r.id, onSort: () => undefined, empty: 'No pledges yet.' }).textContent).toBe('No pledges yet.');
  });
});

describe('matchesQuery', () => {
  it('matches text case-insensitively and phones in any format', () => {
    expect(matchesQuery('AISHA', ['Aisha Rahman'], '#5550100101')).toBe(true);
    expect(matchesQuery('(555) 010', ['x'], '#5550100101')).toBe(true);
    expect(matchesQuery('999', ['x'], '#5550100101')).toBe(false);
    expect(matchesQuery('   ', ['x'], '')).toBe(true);
  });
});
```

`test/ui/form.test.ts`:
```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../web/src/api';
import { h } from '../../web/src/ui/dom';
import { field } from '../../web/src/ui/field';
import { runForm } from '../../web/src/ui/form';

afterEach(() => document.body.replaceChildren());

function setup(onSave: (draft: { name: string }) => Promise<void>, reportError = vi.fn()) {
  const name = field({ name: 'name', label: 'Name', value: '' });
  const form = h('form', { class: 'form' }, name.wrapper);
  const dialog = runForm({
    title: 'Test',
    form,
    fields: { name },
    read: () => ({ draft: { name: name.input.value }, errors: {} }),
    validate: (draft) => (draft.name ? {} : { name: 'Required.' }),
    onSave,
    deleteMessage: '',
    reportError,
  });
  const submit = () => form.dispatchEvent(new Event('submit', { cancelable: true }));
  return { name, dialog, submit, reportError };
}

describe('runForm', () => {
  it('shows validation errors without saving', () => {
    const onSave = vi.fn(async () => undefined);
    const { submit } = setup(onSave);
    submit();
    expect(onSave).not.toHaveBeenCalled();
    expect(document.querySelector('.field-error')?.textContent).toBe('Required.');
  });

  it('saves once even when Save is pressed twice', async () => {
    let finish!: () => void;
    const onSave = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { name, submit, dialog } = setup(onSave);
    name.input.value = 'Aisha';
    submit();
    submit();
    expect(onSave).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(dialog.element.open).toBe(false));
  });

  it('puts a server field error back on the field and keeps the dialog open', async () => {
    const { name, submit, dialog } = setup(async () => { throw new ApiError('BAD_REQUEST', 'Too long.', 'name'); });
    name.input.value = 'x';
    submit();
    await vi.waitFor(() => expect(name.input.getAttribute('aria-invalid')).toBe('true'));
    expect(dialog.element.open).toBe(true);
  });

  it('closes and reports any other failure', async () => {
    const conflict = new ApiError('CONFLICT', 'changed');
    const { name, submit, reportError, dialog } = setup(async () => { throw conflict; });
    name.input.value = 'x';
    submit();
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledWith(conflict));
    expect(dialog.element.open).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/ui`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Implement**

`web/src/ui/dom.ts`:
```ts
export type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | undefined>;

// Children are appended as nodes or text, never parsed as HTML, so donor data cannot inject markup.
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === 'number' ? String(child) : child);
  }
  return element;
}
```

`web/src/format.ts`:
```ts
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', currencySign: 'accounting' });
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

export function formatCents(cents: number | null): string {
  return cents === null ? '' : currency.format(cents / 100);
}

export function formatPercent(fraction: number): string {
  return percent.format(fraction);
}

export function formatDate(iso: string): string {
  if (iso === '') return '';
  const [year, month, day] = iso.split('-').map(Number);
  return dateFormat.format(Date.UTC(year, month - 1, day));
}

export function parseAmount(text: string): number | null | 'invalid' {
  const cleaned = text.trim().replace(/[$,]/g, '');
  if (cleaned === '') return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : 'invalid';
}
```

`web/src/ui/table.ts`:
```ts
import { h } from './dom';

export interface Column<R> {
  key: string;
  label: string;
  value: (row: R) => string | number | null;
  display?: (row: R) => Node | string;
  numeric?: boolean;
  derived?: boolean;
  cellClass?: (row: R) => string | undefined;
}

export interface SortState {
  key: string;
  direction: 'asc' | 'desc';
}

export interface TableOptions<R> {
  columns: Column<R>[];
  rows: R[];
  sort: SortState | null;
  rowId: (row: R) => string;
  rowClass?: (row: R) => string | undefined;
  onSort: (key: string) => void;
  onOpen?: (row: R) => void;
  empty: string;
}

export function nextSort(current: SortState | null, key: string): SortState {
  if (current?.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  return { key, direction: 'asc' };
}

const isBlank = (value: string | number | null) => value === null || value === '';
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortRows<R>(rows: readonly R[], columns: readonly Column<R>[], sort: SortState | null): R[] {
  const column = sort && columns.find((c) => c.key === sort.key);
  if (!sort || !column) return [...rows];
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = column.value(a);
    const right = column.value(b);
    if (isBlank(left) || isBlank(right)) return Number(isBlank(left)) - Number(isBlank(right));
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
    return collator.compare(String(left), String(right)) * direction;
  });
}

export function renderTable<R>(options: TableOptions<R>): HTMLElement {
  if (options.rows.length === 0) return h('p', { class: 'empty' }, options.empty);
  const head = h(
    'tr',
    {},
    ...options.columns.map((column) => {
      const sorted = options.sort?.key === column.key ? options.sort.direction : null;
      const button = h('button', { type: 'button' }, column.label);
      button.addEventListener('click', () => options.onSort(column.key));
      return h('th', { scope: 'col', class: column.numeric ? 'num' : undefined, 'aria-sort': sorted === null ? undefined : sorted === 'asc' ? 'ascending' : 'descending' }, button);
    }),
  );
  const body = h(
    'tbody',
    {},
    ...options.rows.map((row) => {
      const tr = h(
        'tr',
        { tabindex: 0, 'data-id': options.rowId(row), class: options.rowClass?.(row) },
        ...options.columns.map((column) => {
          const classes = [column.numeric ? 'num' : '', column.derived ? 'derived' : '', column.cellClass?.(row) ?? ''].filter(Boolean).join(' ');
          const content = column.display ? column.display(row) : String(column.value(row) ?? '');
          return h('td', { 'data-label': column.label, class: classes || undefined }, content);
        }),
      );
      if (options.onOpen) {
        const open = options.onOpen;
        tr.addEventListener('click', () => open(row));
        tr.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') open(row);
        });
      }
      return tr;
    }),
  );
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' }, h('thead', {}, head), body));
}
```

`web/src/ui/dialog.ts`:
```ts
import { h, type Child } from './dom';

export interface DialogHandle {
  element: HTMLDialogElement;
  close(): void;
}

let dialogCount = 0;

export function openDialog(title: string, body: Node, footer: Child[]): DialogHandle {
  const titleId = `dialog-title-${++dialogCount}`;
  const dialog = h('dialog', { class: 'modal', 'aria-labelledby': titleId }, h('h2', { class: 'modal-title', id: titleId }, title), body, h('div', { class: 'modal-actions' }, ...footer));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return { element: dialog, close: () => dialog.close() };
}

export function confirmDialog(message: string, confirmLabel: string, variant: 'danger' | 'primary' = 'danger'): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false;
    const cancel = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Cancel');
    const confirm = h('button', { type: 'button', class: `btn btn-${variant}` }, confirmLabel);
    const handle = openDialog('Please confirm', h('p', { class: 'body-md' }, message), [h('span', { class: 'spacer' }), cancel, confirm]);
    cancel.addEventListener('click', () => handle.close());
    confirm.addEventListener('click', () => {
      confirmed = true;
      handle.close();
    });
    handle.element.addEventListener('close', () => resolve(confirmed));
  });
}
```

`web/src/ui/toast.ts`:
```ts
import { h } from './dom';

const LIFETIME_MS = { info: 4000, error: 8000 } as const;

export function showToast(message: string, kind: 'info' | 'error' = 'info'): void {
  let region = document.getElementById('toasts');
  if (!region) {
    region = h('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  const toast = h('div', { class: `toast toast-${kind}` }, message);
  region.append(toast);
  setTimeout(() => toast.remove(), LIFETIME_MS[kind]);
}
```

`web/src/ui/field.ts`:
```ts
import { h } from './dom';

export interface Field {
  wrapper: HTMLElement;
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  setError(message: string | undefined): void;
}

export interface FieldOptions {
  name: string;
  label: string;
  value: string;
  help?: string;
  type?: 'text' | 'tel' | 'date' | 'textarea' | 'select';
  inputmode?: string;
  options?: readonly string[];
  required?: boolean;
}

let fieldCount = 0;

export function field(options: FieldOptions): Field {
  const id = `field-${options.name}-${++fieldCount}`;
  const helpId = `${id}-help`;
  let input: Field['input'];
  if (options.type === 'textarea') {
    input = h('textarea', { id, name: options.name, class: 'input', rows: 3 });
  } else if (options.type === 'select') {
    // Keep a value that is no longer in the list so opening an old payment does not silently change it.
    const choices = options.options ?? [];
    const values = options.value && !choices.includes(options.value) ? [...choices, options.value] : choices;
    input = h('select', { id, name: options.name, class: 'input' }, h('option', { value: '' }, '— none —'), ...values.map((value) => h('option', { value }, value)));
  } else {
    input = h('input', { id, name: options.name, class: 'input', type: options.type ?? 'text', inputmode: options.inputmode, autocomplete: 'off' });
  }
  input.value = options.value;
  if (options.help) input.setAttribute('aria-describedby', helpId);
  const error = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const wrapper = h(
    'div',
    { class: 'field' },
    h('label', { for: id, class: 'label' }, options.label, options.required ? h('span', { class: 'required', 'aria-hidden': 'true' }, ' *') : null),
    input,
    options.help ? h('p', { class: 'help', id: helpId }, options.help) : null,
    error,
  );
  return {
    wrapper,
    input,
    setError(message) {
      error.hidden = !message;
      error.textContent = message ?? '';
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
    },
  };
}
```

`web/src/ui/form.ts`:
```ts
import { ApiError } from '../api';
import type { FieldErrors } from '../validate';
import { confirmDialog, openDialog, type DialogHandle } from './dialog';
import { h } from './dom';
import type { Field } from './field';
import { showToast } from './toast';

export interface FormSpec<D> {
  title: string;
  form: HTMLFormElement;
  fields: Record<string, Field>;
  read(): { draft: D; errors: FieldErrors };
  validate(draft: D): FieldErrors;
  onSave(draft: D): Promise<void>;
  onDelete?: () => Promise<void>;
  deleteMessage: string;
  reportError(err: unknown): void;
}

let formCount = 0;

export function runForm<D>(spec: FormSpec<D>): DialogHandle {
  spec.form.id ||= `form-${++formCount}`;
  spec.form.noValidate = true;
  const save = h('button', { type: 'submit', class: 'btn btn-primary', form: spec.form.id }, 'Save');
  const cancel = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Cancel');
  const remove = spec.onDelete ? h('button', { type: 'button', class: 'btn btn-danger' }, 'Delete') : null;
  const dialog = openDialog(spec.title, spec.form, [remove, h('span', { class: 'spacer' }), cancel, save]);
  const buttons = [save, cancel, remove].filter((b): b is HTMLButtonElement => b !== null);
  const setBusy = (busy: boolean, label = 'Saving…') => {
    buttons.forEach((button) => { button.disabled = busy; });
    save.textContent = busy ? label : 'Save';
  };

  cancel.addEventListener('click', () => dialog.close());

  spec.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (save.disabled) return;
    const { draft, errors: parseErrors } = spec.read();
    const errors = { ...spec.validate(draft), ...parseErrors };
    for (const [name, fieldHandle] of Object.entries(spec.fields)) fieldHandle.setError(errors[name]);
    const firstInvalid = Object.keys(spec.fields).find((name) => errors[name]);
    if (firstInvalid) {
      spec.fields[firstInvalid].input.focus();
      return;
    }
    setBusy(true);
    try {
      await spec.onSave(draft);
      dialog.close();
      showToast('Saved.');
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === 'BAD_REQUEST' && err.field && spec.fields[err.field]) {
        spec.fields[err.field].setError(err.message);
        return;
      }
      dialog.close();
      spec.reportError(err);
    }
  });

  if (remove && spec.onDelete) {
    const onDelete = spec.onDelete;
    remove.addEventListener('click', async () => {
      if (!(await confirmDialog(spec.deleteMessage, 'Delete'))) return;
      setBusy(true, 'Deleting…');
      try {
        await onDelete();
        dialog.close();
        showToast('Deleted.');
      } catch (err) {
        dialog.close();
        spec.reportError(err);
      }
    });
  }
  return dialog;
}
```

`web/src/ui/badges.ts`:
```ts
import { STATUS, type Status } from '../engine';
import { h } from './dom';

const STATUS_VARIANT: Record<Status, string> = {
  [STATUS.paid]: 'badge-active',
  [STATUS.partial]: 'badge-inactive',
  [STATUS.pending]: 'badge-inactive',
  [STATUS.overpaid]: 'badge-category',
};

export function statusBadge(status: Status | null): Node | string {
  return status ? h('span', { class: `badge ${STATUS_VARIANT[status]}` }, status) : '';
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function methodBadge(method: string): Node | string {
  return method ? h('span', { class: `badge method method-${slug(method)}` }, method) : '';
}
```

`web/src/ui/search.ts`:
```ts
import { matchKey } from '../matchKey';

export function matchesQuery(query: string, texts: readonly string[], key: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  if (texts.some((text) => text.toLowerCase().includes(needle))) return true;
  // Also match phones however they were typed: "(555) 010" finds "555-010-0101".
  const digits = matchKey(needle).slice(1);
  return digits.length > 0 && key.includes(digits);
}
```

`web/src/ui/filter.ts`:
```ts
import { h } from './dom';

export interface ListFilter {
  label: string;
  ids: ReadonlySet<string>;
}

export function filterChip(filter: ListFilter, onClear: () => void): HTMLElement {
  const chip = h('button', { type: 'button', class: 'chip', 'aria-label': `Clear filter: ${filter.label}` }, `Showing: ${filter.label} ×`);
  chip.addEventListener('click', onClear);
  return chip;
}
```

`web/src/ui/errors.ts`:
```ts
import { ApiError } from '../api';
import { confirmDialog } from './dialog';
import { showToast } from './toast';

export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Try again.';
}

export function createErrorReporter(reload: () => Promise<void>): (err: unknown) => Promise<void> {
  return async (err) => {
    if (err instanceof ApiError && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND')) {
      const message =
        err.code === 'CONFLICT'
          ? 'Someone else changed this row since you opened it. Reload to see the latest version, then make your change again.'
          : 'Someone else deleted this row. Reload to see the latest list.';
      if (await confirmDialog(message, 'Reload', 'primary')) {
        await reload().catch((reloadError: unknown) => showToast(messageOf(reloadError), 'error'));
      }
      return;
    }
    showToast(messageOf(err), 'error');
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/ui && npm run typecheck`
Expected: PASS, and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/ui web/src/format.ts test/ui
git commit -m "feat(ui): table, dialogs, forms, toasts and formatting primitives"
```

---

### Task 12: Pledges and Payments screens

**Files:**
- Create: `web/src/ui/help.ts`, `web/src/ui/pledgeForm.ts`, `web/src/ui/paymentForm.ts`, `web/src/ui/pledgesView.ts`, `web/src/ui/paymentsView.ts`
- Test: `test/ui/lists.test.ts`

**Interfaces:**
- Consumes: `Store`, `State`, `isPending`, the engine, and Task 11's primitives
- Produces:
  - `ListViewDeps { store: Store; reportError(err: unknown): void }`
  - `createPledgesView(deps)` returns `(state, filter, clearFilter) => HTMLElement`
  - `createPaymentsView(deps)`, same shape
  - `openPledgeForm(options)`, `openPaymentForm(options)`

- [ ] **Step 1: Write the failing tests** (`test/ui/lists.test.ts`)

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compute } from '../../web/src/engine';
import type { State, Store } from '../../web/src/store';
import { openPaymentForm } from '../../web/src/ui/paymentForm';
import { openPledgeForm } from '../../web/src/ui/pledgeForm';
import { createPaymentsView } from '../../web/src/ui/paymentsView';
import { createPledgesView } from '../../web/src/ui/pledgesView';
import { METHODS, SETTINGS, TODAY, payment, pledge } from '../support/factories';

afterEach(() => document.body.replaceChildren());

const pledges = [
  pledge({ id: 'p1', phone: '555-010-0101', name: 'Aisha Rahman', amountPledged: 100 }),
  pledge({ id: 'p2', phone: '5550100101', name: 'Aisha again', amountPledged: 100 }),
  pledge({ id: 'p3', phone: '555-010-0103', name: 'Chen Wei', amountPledged: 300 }),
];
const payments = [payment({ id: 'y1', phone: '555-999-0000', amountReceived: 35, dateReceived: '2099-01-01' })];
const state: State = { pledges, payments, settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, payments, SETTINGS, TODAY) };
const store = { savePledge: vi.fn(async () => undefined), savePayment: vi.fn(async () => undefined), deletePledge: vi.fn(), deletePayment: vi.fn() } as unknown as Store;
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

describe('pledges view', () => {
  it('marks duplicates red and filters by search without losing the box', () => {
    const view = createPledgesView({ store, reportError: vi.fn() })(state, null, () => undefined);
    document.body.append(view);
    expect([...view.querySelectorAll('tr.row-danger')].map((tr) => tr.getAttribute('data-id'))).toEqual(['p1', 'p2']);
    const search = view.querySelector('input[type=search]') as HTMLInputElement;
    type(search, 'chen');
    expect([...view.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('data-id'))).toEqual(['p3']);
    expect(document.body.contains(search)).toBe(true);
  });

  it('shows only filtered rows and a chip that clears the filter', () => {
    const clear = vi.fn();
    const view = createPledgesView({ store, reportError: vi.fn() })(state, { label: 'Donors listed more than once', ids: new Set(['p2']) }, clear);
    expect(view.querySelectorAll('tbody tr')).toHaveLength(1);
    (view.querySelector('.chip') as HTMLButtonElement).click();
    expect(clear).toHaveBeenCalled();
  });
});

describe('payments view', () => {
  it('flags a payment that will not be counted and a future date', () => {
    const view = createPaymentsView({ store, reportError: vi.fn() })(state, null, () => undefined);
    expect(view.querySelector('tr.row-danger')?.textContent).toContain('⚠ phone not in Pledges');
    expect(view.querySelector('td.cell-warning')).not.toBeNull();
  });
});

describe('payment form', () => {
  it('previews the donor while the phone is typed', () => {
    openPaymentForm({ methods: METHODS, pledges, onSave: vi.fn(), reportError: vi.fn() });
    const phone = document.querySelector('input[name=phone]') as HTMLInputElement;
    const preview = document.querySelector('[data-role=donor-preview]') as HTMLElement;
    type(phone, '(555) 010-0103');
    expect(preview.textContent).toContain('Chen Wei');
    type(phone, '123');
    expect(preview.textContent).toContain('⚠ phone not in Pledges');
    expect(preview.className).toContain('hint-warning');
  });

  it('turns typed text into a draft', async () => {
    const onSave = vi.fn(async () => undefined);
    openPaymentForm({ methods: METHODS, pledges, onSave, reportError: vi.fn() });
    type(document.querySelector('input[name=phone]') as HTMLInputElement, '555-010-0103');
    type(document.querySelector('input[name=amountReceived]') as HTMLInputElement, '$1,200');
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toEqual({ phone: '555-010-0103', dateReceived: TODAY_LOCAL(), amountReceived: 1200, method: '', notes: '' });
  });
});

describe('pledge form', () => {
  it('warns when the phone already belongs to another pledge', () => {
    openPledgeForm({ pledges, existing: pledges[2], onSave: vi.fn(), reportError: vi.fn() });
    type(document.querySelector('input[name=phone]') as HTMLInputElement, '555 010 0101');
    const hint = document.querySelector('.hint-warning') as HTMLElement;
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain('Aisha Rahman');
  });

  it('rejects an amount that is not a number', () => {
    const onSave = vi.fn();
    openPledgeForm({ pledges, onSave, reportError: vi.fn() });
    type(document.querySelector('input[name=amountPledged]') as HTMLInputElement, 'lots');
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(onSave).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Enter a number, e.g. 250.');
  });
});

function TODAY_LOCAL() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
```

> The `as unknown as Store` double cast is confined to this test double. It's not `as any`, and production code never does it.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/ui/lists.test.ts`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Implement**

`web/src/ui/help.ts`. Adapted from the workbook's header tooltips (`xl/comments1.xml`, `comments2.xml`):
```ts
export const PLEDGE_HELP = {
  phone: "The donor's phone number — it is their ID. Dashes, spaces and brackets don't matter. One pledge per donor.",
  name: 'Full name, e.g. Ahmed Yusuf.',
  datePledged: 'The date the pledge was made.',
  amountPledged: 'Total amount promised, e.g. 500. Enter 0 if not known yet — payments are not counted until this is filled in.',
  notes: 'Anything worth remembering, e.g. "Prefers to pay after Jumuah".',
} as const;

export const PAYMENT_HELP = {
  phone: "Use the same number as on the donor's pledge — dashes, spaces and brackets don't matter.",
  dateReceived: 'The date this payment came in. Record each installment separately.',
  amountReceived: 'The amount of this single payment, e.g. 200.',
  method: 'How the money was paid.',
  notes: 'e.g. "First installment".',
} as const;

export const NOT_A_NUMBER = 'Enter a number, e.g. 250.';
```

`web/src/ui/pledgeForm.ts`:
```ts
import { todayIso } from '../dates';
import { matchKey } from '../matchKey';
import { parseAmount } from '../format';
import type { Pledge, PledgeDraft } from '../types';
import { validatePledge, type FieldErrors } from '../validate';
import { h } from './dom';
import { field } from './field';
import { runForm } from './form';
import { NOT_A_NUMBER, PLEDGE_HELP } from './help';

export interface PledgeFormOptions {
  existing?: Pledge;
  pledges: readonly Pledge[];
  onSave(draft: PledgeDraft): Promise<void>;
  onDelete?: () => Promise<void>;
  reportError(err: unknown): void;
}

function otherPledgeWithPhone(pledges: readonly Pledge[], phone: string, exceptId: string | undefined): Pledge | undefined {
  const key = matchKey(phone);
  if (key === '') return undefined;
  return pledges.find((p) => p.id !== exceptId && matchKey(p.phone) === key);
}

export function openPledgeForm(options: PledgeFormOptions): void {
  const existing = options.existing;
  const fields = {
    phone: field({ name: 'phone', label: 'Phone number', type: 'tel', value: existing?.phone ?? '', help: PLEDGE_HELP.phone }),
    name: field({ name: 'name', label: 'Donor name', value: existing?.name ?? '', help: PLEDGE_HELP.name }),
    datePledged: field({ name: 'datePledged', label: 'Date pledged', type: 'date', value: existing ? existing.datePledged : todayIso(), help: PLEDGE_HELP.datePledged }),
    amountPledged: field({ name: 'amountPledged', label: 'Amount pledged ($)', inputmode: 'decimal', value: existing?.amountPledged?.toString() ?? '', help: PLEDGE_HELP.amountPledged }),
    notes: field({ name: 'notes', label: 'Notes', type: 'textarea', value: existing?.notes ?? '', help: PLEDGE_HELP.notes }),
  };
  const duplicateHint = h('p', { class: 'hint hint-warning', role: 'status', hidden: true });
  const updateHint = () => {
    const other = otherPledgeWithPhone(options.pledges, fields.phone.input.value, existing?.id);
    duplicateHint.hidden = !other;
    duplicateHint.textContent = other
      ? `This phone number is already on the pledge for ${other.name || 'a donor with no name'}. Each donor should appear only once, or their payments are counted twice.`
      : '';
  };
  fields.phone.input.addEventListener('input', updateHint);
  updateHint();

  const form = h('form', { class: 'form' }, fields.phone.wrapper, duplicateHint, fields.name.wrapper, fields.datePledged.wrapper, fields.amountPledged.wrapper, fields.notes.wrapper);
  runForm<PledgeDraft>({
    title: existing ? 'Edit pledge' : 'Add pledge',
    form,
    fields,
    read() {
      const amount = parseAmount(fields.amountPledged.input.value);
      const errors: FieldErrors = amount === 'invalid' ? { amountPledged: NOT_A_NUMBER } : {};
      return {
        draft: {
          phone: fields.phone.input.value.trim(),
          name: fields.name.input.value.trim(),
          datePledged: fields.datePledged.input.value,
          amountPledged: amount === 'invalid' ? null : amount,
          notes: fields.notes.input.value.trim(),
        },
        errors,
      };
    },
    validate: validatePledge,
    onSave: options.onSave,
    onDelete: options.onDelete,
    deleteMessage: "Delete this pledge? The donor's payments stay on the Payments tab but will show as not matched.",
    reportError: options.reportError,
  });
}
```

`web/src/ui/paymentForm.ts`:
```ts
import { todayIso } from '../dates';
import { WARNING_MARK, createDonorResolver } from '../engine';
import { parseAmount } from '../format';
import type { Payment, PaymentDraft, Pledge } from '../types';
import { validatePayment, type FieldErrors } from '../validate';
import { h } from './dom';
import { field } from './field';
import { runForm } from './form';
import { NOT_A_NUMBER, PAYMENT_HELP } from './help';

export interface PaymentFormOptions {
  existing?: Payment;
  methods: readonly string[];
  pledges: readonly Pledge[];
  onSave(draft: PaymentDraft): Promise<void>;
  onDelete?: () => Promise<void>;
  reportError(err: unknown): void;
}

export function openPaymentForm(options: PaymentFormOptions): void {
  const existing = options.existing;
  const resolveDonor = createDonorResolver(options.pledges);
  const fields = {
    phone: field({ name: 'phone', label: 'Phone number', type: 'tel', value: existing?.phone ?? '', help: PAYMENT_HELP.phone, required: true }),
    dateReceived: field({ name: 'dateReceived', label: 'Date received', type: 'date', value: existing ? existing.dateReceived : todayIso(), help: PAYMENT_HELP.dateReceived }),
    amountReceived: field({ name: 'amountReceived', label: 'Amount received ($)', inputmode: 'decimal', value: existing?.amountReceived?.toString() ?? '', help: PAYMENT_HELP.amountReceived }),
    method: field({ name: 'method', label: 'Payment method', type: 'select', options: options.methods, value: existing?.method ?? '', help: PAYMENT_HELP.method }),
    notes: field({ name: 'notes', label: 'Notes', type: 'textarea', value: existing?.notes ?? '', help: PAYMENT_HELP.notes }),
  };
  const preview = h('p', { class: 'hint', role: 'status', 'data-role': 'donor-preview' });
  // Shows, before saving, exactly what the Donor Name column will say, so a mistyped phone is caught at the door.
  const updatePreview = () => {
    const phone = fields.phone.input.value.trim();
    const donor = resolveDonor(phone);
    const warning = donor.startsWith(WARNING_MARK);
    preview.className = warning ? 'hint hint-warning' : 'hint';
    if (phone === '') preview.textContent = 'Type the phone number to find the donor.';
    else if (warning) preview.textContent = `${donor} — this payment will not be counted until that is fixed.`;
    else preview.textContent = `Donor: ${donor || '(no name on the pledge)'}`;
  };
  fields.phone.input.addEventListener('input', updatePreview);
  updatePreview();

  const form = h('form', { class: 'form' }, fields.phone.wrapper, preview, fields.dateReceived.wrapper, fields.amountReceived.wrapper, fields.method.wrapper, fields.notes.wrapper);
  runForm<PaymentDraft>({
    title: existing ? 'Edit payment' : 'Log a payment',
    form,
    fields,
    read() {
      const amount = parseAmount(fields.amountReceived.input.value);
      const errors: FieldErrors = amount === 'invalid' ? { amountReceived: NOT_A_NUMBER } : {};
      return {
        draft: {
          phone: fields.phone.input.value.trim(),
          dateReceived: fields.dateReceived.input.value,
          amountReceived: amount === 'invalid' ? null : amount,
          method: fields.method.input.value,
          notes: fields.notes.input.value.trim(),
        },
        errors,
      };
    },
    validate: (draft) => validatePayment(draft, options.methods),
    onSave: options.onSave,
    onDelete: options.onDelete,
    deleteMessage: 'Delete this payment? It will be removed from every total.',
    reportError: options.reportError,
  });
}
```

`web/src/ui/pledgesView.ts`:
```ts
import type { DerivedPledge } from '../engine';
import { formatCents, formatDate } from '../format';
import { toCents } from '../money';
import { isPending, type State, type Store } from '../store';
import type { Pledge } from '../types';
import { statusBadge } from './badges';
import { h } from './dom';
import { filterChip, type ListFilter } from './filter';
import { openPledgeForm } from './pledgeForm';
import { matchesQuery } from './search';
import { nextSort, renderTable, sortRows, type Column, type SortState } from './table';

export interface ListViewDeps {
  store: Store;
  reportError(err: unknown): void;
}

const COLUMNS: Column<DerivedPledge>[] = [
  { key: 'phone', label: 'Phone Number', value: (d) => d.pledge.phone },
  { key: 'name', label: 'Donor Name', value: (d) => d.pledge.name },
  { key: 'datePledged', label: 'Date Pledged', value: (d) => d.pledge.datePledged, display: (d) => formatDate(d.pledge.datePledged) },
  { key: 'amountPledged', label: 'Amount Pledged', numeric: true, value: (d) => d.pledge.amountPledged, display: (d) => formatCents(toCents(d.pledge.amountPledged)) },
  { key: 'lastPaymentDate', label: 'Last Payment', derived: true, value: (d) => d.lastPaymentDate, display: (d) => formatDate(d.lastPaymentDate) },
  { key: 'received', label: 'Received', derived: true, numeric: true, value: (d) => d.receivedCents, display: (d) => formatCents(d.receivedCents) },
  { key: 'balance', label: 'Balance Due', derived: true, numeric: true, value: (d) => d.balanceCents, display: (d) => formatCents(d.balanceCents) },
  { key: 'paymentCount', label: '# Payments', derived: true, numeric: true, value: (d) => d.paymentCount },
  { key: 'status', label: 'Status', derived: true, value: (d) => d.status, display: (d) => statusBadge(d.status) },
  { key: 'notes', label: 'Notes', value: (d) => d.pledge.notes },
];

export function createPledgesView(deps: ListViewDeps) {
  let query = '';
  let sort: SortState | null = null;

  return function render(state: State, filter: ListFilter | null, clearFilter: () => void): HTMLElement {
    const openEditor = (existing?: Pledge) =>
      openPledgeForm({
        existing,
        pledges: state.pledges,
        onSave: (draft) => deps.store.savePledge(draft, existing),
        onDelete: existing ? () => deps.store.deletePledge(existing) : undefined,
        reportError: deps.reportError,
      });
    const tableSlot = h('div');
    const drawTable = () => {
      const rows = state.computed.pledges.filter(
        (d) => (!filter || filter.ids.has(d.pledge.id)) && matchesQuery(query, [d.pledge.phone, d.pledge.name, d.pledge.notes], d.key),
      );
      tableSlot.replaceChildren(
        renderTable({
          columns: COLUMNS,
          rows: sortRows(rows, COLUMNS, sort),
          sort,
          rowId: (d) => d.pledge.id,
          rowClass: (d) => (isPending(d.pledge) ? 'row-pending' : d.duplicate ? 'row-danger' : undefined),
          onSort: (key) => {
            sort = nextSort(sort, key);
            drawTable();
          },
          onOpen: (d) => {
            if (!isPending(d.pledge)) openEditor(d.pledge);
          },
          empty: filter || query ? 'No pledges match.' : 'No pledges yet. Use “Add pledge” to record the first one.',
        }),
      );
    };
    const search = h('input', { type: 'search', class: 'input search', placeholder: 'Search phone, name or notes', 'aria-label': 'Search pledges' });
    search.value = query;
    search.addEventListener('input', () => {
      query = search.value;
      drawTable();
    });
    const add = h('button', { type: 'button', class: 'btn btn-primary' }, 'Add pledge');
    add.addEventListener('click', () => openEditor());
    drawTable();
    const totals = state.computed.totals;
    return h(
      'section',
      { class: 'view' },
      h('header', { class: 'view-header' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Donors'), h('h1', { class: 'display-md' }, 'Pledges')), add),
      h('p', { class: 'totals-band' }, `Pledged ${formatCents(totals.pledgedCents)} · Received ${formatCents(totals.receivedCents)} · Outstanding ${formatCents(totals.outstandingCents)} · ${totals.pledgePaymentCount} payments`),
      h('div', { class: 'toolbar' }, search, filter ? filterChip(filter, clearFilter) : null),
      tableSlot,
    );
  };
}
```

`web/src/ui/paymentsView.ts`:
```ts
import type { DerivedPayment } from '../engine';
import { formatCents, formatDate } from '../format';
import { toCents } from '../money';
import { isPending, type State } from '../store';
import type { Payment } from '../types';
import { methodBadge } from './badges';
import { h } from './dom';
import { filterChip, type ListFilter } from './filter';
import { openPaymentForm } from './paymentForm';
import type { ListViewDeps } from './pledgesView';
import { matchesQuery } from './search';
import { nextSort, renderTable, sortRows, type Column, type SortState } from './table';

const COLUMNS: Column<DerivedPayment>[] = [
  { key: 'phone', label: 'Phone Number', value: (d) => d.payment.phone },
  { key: 'donor', label: 'Donor Name', derived: true, value: (d) => d.donorName, display: (d) => (d.notCounted ? h('span', { class: 'warning-text' }, d.donorName) : d.donorName) },
  { key: 'dateReceived', label: 'Date Received', value: (d) => d.payment.dateReceived, display: (d) => formatDate(d.payment.dateReceived), cellClass: (d) => (d.futureDate ? 'cell-warning' : undefined) },
  { key: 'amount', label: 'Amount', numeric: true, value: (d) => d.payment.amountReceived, display: (d) => formatCents(toCents(d.payment.amountReceived)) },
  { key: 'method', label: 'Method', value: (d) => d.payment.method, display: (d) => methodBadge(d.payment.method) },
  { key: 'notes', label: 'Notes', value: (d) => d.payment.notes },
];

export function createPaymentsView(deps: ListViewDeps) {
  let query = '';
  let sort: SortState | null = null;

  return function render(state: State, filter: ListFilter | null, clearFilter: () => void): HTMLElement {
    const openEditor = (existing?: Payment) =>
      openPaymentForm({
        existing,
        methods: state.settings.paymentMethods,
        pledges: state.pledges,
        onSave: (draft) => deps.store.savePayment(draft, existing),
        onDelete: existing ? () => deps.store.deletePayment(existing) : undefined,
        reportError: deps.reportError,
      });
    const tableSlot = h('div');
    const drawTable = () => {
      const rows = state.computed.payments.filter(
        (d) => (!filter || filter.ids.has(d.payment.id)) && matchesQuery(query, [d.payment.phone, d.donorName, d.payment.notes, d.payment.method], d.key),
      );
      tableSlot.replaceChildren(
        renderTable({
          columns: COLUMNS,
          rows: sortRows(rows, COLUMNS, sort),
          sort,
          rowId: (d) => d.payment.id,
          rowClass: (d) => (isPending(d.payment) ? 'row-pending' : d.notCounted ? 'row-danger' : undefined),
          onSort: (key) => {
            sort = nextSort(sort, key);
            drawTable();
          },
          onOpen: (d) => {
            if (!isPending(d.payment)) openEditor(d.payment);
          },
          empty: filter || query ? 'No payments match.' : 'No payments yet. Use “Log a payment” when money comes in.',
        }),
      );
    };
    const search = h('input', { type: 'search', class: 'input search', placeholder: 'Search phone, donor, method or notes', 'aria-label': 'Search payments' });
    search.value = query;
    search.addEventListener('input', () => {
      query = search.value;
      drawTable();
    });
    const add = h('button', { type: 'button', class: 'btn btn-primary' }, 'Log a payment');
    add.addEventListener('click', () => openEditor());
    drawTable();
    const totals = state.computed.totals;
    return h(
      'section',
      { class: 'view' },
      h('header', { class: 'view-header' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Money received'), h('h1', { class: 'display-md' }, 'Payments')), add),
      h('p', { class: 'totals-band' }, `${totals.paymentsWithAmount} payments · ${formatCents(totals.loggedCents)} logged`),
      h('div', { class: 'toolbar' }, search, filter ? filterChip(filter, clearFilter) : null),
      tableSlot,
    );
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/ui && npm run typecheck`
Expected: PASS, and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/ui test/ui/lists.test.ts
git commit -m "feat(ui): Pledges and Payments screens with live donor preview"
```

---

### Task 13: Summary, Find donor, chart, goal, export

**Files:**
- Create: `web/src/ui/chartSlots.ts`, `web/src/ui/methodChart.ts`, `web/src/ui/goalForm.ts`, `web/src/ui/summaryView.ts`, `web/src/ui/lookupView.ts`, `web/src/ui/export.ts`
- Test: `test/ui/summary.test.ts`, `test/ui/lookup.test.ts`, `test/ui/export.test.ts`

**Interfaces:**
- Consumes: `Computed`, `MethodRow`, `HealthCheck`, `ListFilter`, `Store`
- Produces:
  - `chartSlots(rows): Map<string, number>`, `drawMethodChart(canvas, rows)`
  - `openGoalForm(goal, onSave, reportError)`
  - `SummaryDeps { store; reportError; showList(view, filter); exportWorkbook(state); drawChart(canvas, rows) }`, `renderSummary(state, deps)`
  - `createLookupView()` returns `(state) => HTMLElement`
  - `pledgeSheetRows(c)`, `paymentSheetRows(c)`, `summarySheetRows(state)`, `downloadWorkbook(state)`

- [ ] **Step 1: Write the failing tests**

`test/ui/summary.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { compute } from '../../web/src/engine';
import type { State, Store } from '../../web/src/store';
import { chartSlots } from '../../web/src/ui/chartSlots';
import { renderSummary } from '../../web/src/ui/summaryView';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

const pledges = [pledge({ id: 'p1', phone: '1', amountPledged: 100 })];
const payments = [payment({ id: 'y1', phone: '1', amountReceived: 40, method: 'Cash' }), payment({ id: 'y2', phone: '9', amountReceived: 10, method: 'Card' })];
const state: State = { pledges, payments, settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, payments, SETTINGS, TODAY) };

function render() {
  const deps = { store: {} as Store, reportError: vi.fn(), showList: vi.fn(), exportWorkbook: vi.fn(async () => undefined), drawChart: vi.fn() };
  const view = renderSummary(state, deps);
  document.body.replaceChildren(view);
  return { view, deps };
}

describe('summary', () => {
  it('shows the headline figures', () => {
    const { view } = render();
    expect(view.textContent).toContain('$100.00');
    expect(view.textContent).toContain('$40.00');
    expect(view.textContent).toContain('0.4% of goal received');
  });

  it('highlights unmatched money and links a health problem to its rows', () => {
    const { view, deps } = render();
    expect(view.querySelector('[data-role=unmatched]')?.classList.contains('is-flagged')).toBe(true);
    const show = view.querySelector('[data-health=notMatched] button') as HTMLButtonElement;
    show.click();
    expect(deps.showList).toHaveBeenCalledWith('payments', { label: 'Payments not matched to a pledge', ids: new Set(['y2']) });
    expect(view.querySelector('[data-health=duplicates] button')).toBeNull();
  });

  it('draws the method chart once the view is on the page', async () => {
    const { deps } = render();
    await Promise.resolve();
    expect(deps.drawChart).toHaveBeenCalledTimes(1);
  });
});

describe('chartSlots', () => {
  it('gives each non-zero method a stable colour slot, cycling after six', () => {
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((label) => ({ label, cents: 1, kind: 'method' as const }));
    const slots = chartSlots([{ label: 'Zero', cents: 0, kind: 'method' }, ...rows]);
    expect(slots.has('Zero')).toBe(false);
    expect(slots.get('A')).toBe(1);
    expect(slots.get('G')).toBe(1);
  });
});
```

`test/ui/lookup.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { compute } from '../../web/src/engine';
import type { State } from '../../web/src/store';
import { createLookupView } from '../../web/src/ui/lookupView';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

const pledges = [
  pledge({ id: 'p1', phone: '555-010-0101', name: '<b>Aisha</b>', amountPledged: 100 }),
  pledge({ id: 'p2', phone: '2', name: 'Aisha Khan', amountPledged: 50 }),
];
const payments = [payment({ phone: '5550100101', amountReceived: 40, dateReceived: '2025-01-05', method: 'Cash' })];
const state: State = { pledges, payments, settings: SETTINGS, me: 'me', computed: compute(pledges, payments, SETTINGS, TODAY) };
const search = (view: HTMLElement, text: string) => {
  const input = view.querySelector('input') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input'));
};

describe('find donor', () => {
  it('finds by phone in any format and shows payment history as text', () => {
    const view = createLookupView()(state);
    search(view, '(555) 010 0101');
    expect(view.querySelector('.lookup-card b')).toBeNull();
    expect(view.textContent).toContain('<b>Aisha</b>');
    expect(view.textContent).toContain('$40.00');
    expect(view.textContent).toContain('Partial');
  });

  it('lists name matches, then opens the chosen donor', () => {
    const view = createLookupView()(state);
    search(view, 'aisha');
    const matches = view.querySelectorAll('.match');
    expect(matches).toHaveLength(2);
    (matches[1] as HTMLButtonElement).click();
    expect(view.textContent).toContain('Aisha Khan');
  });

  it('says Not found', () => {
    const view = createLookupView()(state);
    search(view, '999');
    expect(view.textContent).toContain('Not found');
  });
});
```

`test/ui/export.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { compute } from '../../web/src/engine';
import { paymentSheetRows, pledgeSheetRows } from '../../web/src/ui/export';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

describe('export rows', () => {
  const computed = compute(
    [pledge({ phone: '0551234', name: 'Hamza', amountPledged: 50 })],
    [payment({ phone: '0551234', amountReceived: 20.5, method: 'Cash', dateReceived: '2025-02-11' })],
    SETTINGS,
    TODAY,
  );
  it('keeps phones as text and money in dollars', () => {
    expect(pledgeSheetRows(computed)[1]).toEqual(['0551234', 'Hamza', '', 50, '2025-02-11', 20.5, 29.5, 1, 'Partial', '', '']);
  });
  it('marks payments that were not counted', () => {
    expect(paymentSheetRows(computed)[0]).toEqual(['Phone Number', 'Donor Name', 'Date Received', 'Amount Received ($)', 'Payment Method', 'Notes', 'Counted']);
    expect(paymentSheetRows(computed)[1]).toEqual(['0551234', 'Hamza', '2025-02-11', 20.5, 'Cash', '', 'Yes']);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/ui/summary.test.ts test/ui/lookup.test.ts test/ui/export.test.ts`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Implement**

`web/src/ui/chartSlots.ts`:
```ts
import type { MethodRow } from '../engine';

const PALETTE_SIZE = 6;

// The doughnut and the table beside it must agree on colours, so both derive them here.
export function chartSlots(rows: readonly MethodRow[]): Map<string, number> {
  const slots = new Map<string, number>();
  rows.filter((row) => row.cents > 0).forEach((row, index) => slots.set(row.label, (index % PALETTE_SIZE) + 1));
  return slots;
}
```

`web/src/ui/methodChart.ts`:
```ts
import { ArcElement, Chart, DoughnutController, Tooltip } from 'chart.js';
import type { MethodRow } from '../engine';
import { formatCents } from '../format';
import { chartSlots } from './chartSlots';

Chart.register(DoughnutController, ArcElement, Tooltip);

let active: Chart<'doughnut'> | null = null;
let stopRetheming: (() => void) | null = null;

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const colours = (labels: readonly string[], slots: Map<string, number>) => labels.map((label) => cssVar(`--chart-${slots.get(label) ?? 1}`));

// Each Summary render makes a new canvas, so the previous chart and its theme listener are torn down here.
export function drawMethodChart(canvas: HTMLCanvasElement, rows: readonly MethodRow[]): void {
  active?.destroy();
  stopRetheming?.();
  const slots = chartSlots(rows);
  const shown = rows.filter((row) => row.cents > 0);
  const labels = shown.map((row) => row.label);
  active = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: shown.map((row) => row.cents / 100), backgroundColor: colours(labels, slots), borderColor: cssVar('--color-surface'), borderWidth: 2 }],
    },
    options: {
      cutout: '62%',
      animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => `${item.label}: ${formatCents(Math.round(item.parsed * 100))}` } },
      },
    },
  });
  const chart = active;
  const retheme = () => {
    const dataset = chart.data.datasets[0];
    dataset.backgroundColor = colours(labels, slots);
    dataset.borderColor = cssVar('--color-surface');
    chart.update();
  };
  document.addEventListener('themechange', retheme);
  stopRetheming = () => document.removeEventListener('themechange', retheme);
}
```

`web/src/ui/goalForm.ts`:
```ts
import { parseAmount } from '../format';
import { amountError } from '../validate';
import { h } from './dom';
import { field } from './field';
import { runForm } from './form';
import { NOT_A_NUMBER } from './help';

export function openGoalForm(goal: number | null, onSave: (goal: number) => Promise<void>, reportError: (err: unknown) => void): void {
  const goalField = field({ name: 'goal', label: 'Fundraiser goal ($)', inputmode: 'decimal', value: goal?.toString() ?? '', help: '% of goal received is measured against this figure.' });
  runForm<{ goal: number | null }>({
    title: 'Edit goal',
    form: h('form', { class: 'form' }, goalField.wrapper),
    fields: { goal: goalField },
    read() {
      const amount = parseAmount(goalField.input.value);
      return { draft: { goal: amount === 'invalid' ? null : amount }, errors: amount === 'invalid' ? { goal: NOT_A_NUMBER } : {} };
    },
    validate: (draft) => {
      const error = draft.goal === null ? 'Enter a goal.' : amountError(draft.goal);
      return error ? { goal: error } : {};
    },
    onSave: (draft) => onSave(draft.goal ?? 0),
    deleteMessage: '',
    reportError,
  });
}
```

`web/src/ui/summaryView.ts`:
```ts
import type { HealthCheck, MethodRow } from '../engine';
import { formatCents, formatPercent } from '../format';
import type { State, Store } from '../store';
import { chartSlots } from './chartSlots';
import { h } from './dom';
import type { ListFilter } from './filter';
import { openGoalForm } from './goalForm';

export interface SummaryDeps {
  store: Store;
  reportError(err: unknown): void;
  showList(view: 'pledges' | 'payments', filter: ListFilter): void;
  exportWorkbook(state: State): Promise<void>;
  drawChart(canvas: HTMLCanvasElement, rows: readonly MethodRow[]): void;
}

const statCard = (label: string, value: string) => h('div', { class: 'stat-card' }, h('p', { class: 'eyebrow' }, label), h('p', { class: 'numeric-xl stat-value' }, value));
const stat = (label: string, value: string | number) => h('div', {}, h('p', { class: 'eyebrow' }, label), h('p', { class: 'numeric-lg' }, String(value)));

function healthItem(check: HealthCheck, deps: SummaryDeps): HTMLElement {
  const count = check.ids.length;
  const action = count > 0 ? h('button', { type: 'button', class: 'btn btn-ghost' }, `Show ${count}`) : h('span', { class: 'numeric-lg ink-soft' }, '0');
  if (action instanceof HTMLButtonElement) action.addEventListener('click', () => deps.showList(check.target, { label: check.label, ids: new Set(check.ids) }));
  return h('li', { 'data-health': check.id, class: count > 0 ? 'is-flagged' : undefined }, h('span', {}, check.label), action);
}

function methodTable(state: State): HTMLElement {
  const slots = chartSlots(state.computed.methods);
  const { methodTotalCents } = state.computed;
  const { loggedCents } = state.computed.totals;
  return h(
    'table',
    { class: 'data-table' },
    h(
      'tbody',
      {},
      ...state.computed.methods.map((row) => {
        const slot = slots.get(row.label);
        return h(
          'tr',
          {},
          h('td', {}, h('span', { class: 'swatch', style: slot ? `background: var(--chart-${slot})` : undefined }), row.label),
          h('td', { class: 'num' }, formatCents(row.cents)),
        );
      }),
      h('tr', { class: methodTotalCents === loggedCents ? undefined : 'row-danger' }, h('td', {}, h('strong', {}, 'Total (should match Payments Logged)')), h('td', { class: 'num' }, h('strong', {}, formatCents(methodTotalCents)))),
    ),
  );
}

export function renderSummary(state: State, deps: SummaryDeps): HTMLElement {
  const { totals, health, methods } = state.computed;
  const progress = Math.min(Math.max(totals.goalFraction, 0), 1);

  const editGoal = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Edit goal');
  editGoal.addEventListener('click', () => openGoalForm(state.settings.goal, (goal) => deps.store.setGoal(goal), deps.reportError));
  const download = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Download .xlsx');
  download.addEventListener('click', () => {
    deps.exportWorkbook(state).catch(deps.reportError);
  });

  const hasPayments = methods.some((row) => row.cents > 0);
  const canvas = h('canvas', { width: 240, height: 240, role: 'img', 'aria-label': 'Share of money collected by payment method' });
  if (hasPayments) {
    // Runs after the caller has attached the view, which Chart.js needs for sizing.
    queueMicrotask(() => {
      if (canvas.isConnected) deps.drawChart(canvas, methods);
    });
  }

  return h(
    'section',
    { class: 'view' },
    h('header', { class: 'view-header' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Updates as volunteers save'), h('h1', { class: 'display-md' }, 'Fundraiser summary')), download),
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'view-header' }, h('p', { class: 'eyebrow' }, 'Goal'), editGoal),
      h('p', {}, h('span', { class: 'numeric-xl gold' }, formatCents(totals.receivedCents)), h('span', { class: 'ink-soft' }, ` received of ${formatCents(totals.goalCents ?? 0)}`)),
      h('div', { class: 'progress-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(progress * 100), 'aria-label': 'Progress toward goal' }, h('div', { class: 'progress-fill', style: `width: ${progress * 100}%` })),
      h('p', { class: 'meta' }, `${formatPercent(totals.goalFraction)} of goal received`),
    ),
    h(
      'div',
      { class: 'grid-stats' },
      statCard('Total pledged', formatCents(totals.pledgedCents)),
      statCard('Total received', formatCents(totals.receivedCents)),
      statCard('Balance outstanding', formatCents(totals.outstandingCents)),
      statCard('Overpaid / credit', formatCents(totals.creditCents)),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'heading-md' }, 'Donors'),
      h('div', { class: 'stat-row' }, stat('Pledged', totals.donorCount), stat('Fully paid', totals.statusCounts.Paid), stat('Partial', totals.statusCounts.Partial), stat('Pending', totals.statusCounts.Pending), stat('Overpaid', totals.statusCounts.Overpaid)),
    ),
    h(
      'section',
      { class: `card${totals.unmatchedCents !== 0 ? ' is-flagged' : ''}`, 'data-role': 'unmatched' },
      h('h2', { class: 'heading-md' }, 'Reconciliation'),
      h('div', { class: 'stat-row' }, stat('Payments logged', formatCents(totals.loggedCents)), stat('Unmatched payments', formatCents(totals.unmatchedCents))),
      totals.unmatchedCents !== 0 ? h('p', { class: 'body-md' }, 'Some logged money is not counted toward any pledge. The Data Health list below shows where.') : null,
    ),
    h('section', { class: 'card' }, h('h2', { class: 'heading-md' }, 'Data health'), h('p', { class: 'meta' }, 'Every figure below should read 0. Anything higher needs a look.'), h('ul', { class: 'health-list' }, ...health.map((check) => healthItem(check, deps)))),
    h('section', { class: 'card' }, h('h2', { class: 'heading-md' }, 'Collected by payment method'), h('div', { class: 'method-grid' }, hasPayments ? canvas : h('p', { class: 'empty' }, 'No payments yet.'), methodTable(state))),
  );
}
```

`web/src/ui/lookupView.ts`:
```ts
import { findByName, findByPhone, paymentsForKey, type DerivedPayment, type DerivedPledge } from '../engine';
import { formatCents, formatDate } from '../format';
import { toCents } from '../money';
import type { State } from '../store';
import { methodBadge, statusBadge } from './badges';
import { h } from './dom';
import { renderTable, type Column } from './table';

const HISTORY: Column<DerivedPayment>[] = [
  { key: 'date', label: 'Date', value: (d) => d.payment.dateReceived, display: (d) => formatDate(d.payment.dateReceived) },
  { key: 'amount', label: 'Amount', numeric: true, value: (d) => d.payment.amountReceived, display: (d) => formatCents(toCents(d.payment.amountReceived)) },
  { key: 'method', label: 'Method', value: (d) => d.payment.method, display: (d) => methodBadge(d.payment.method) },
  { key: 'notes', label: 'Notes', value: (d) => d.payment.notes },
];

function donorCard(donor: DerivedPledge, payments: DerivedPayment[]): HTMLElement {
  const rows: Array<[string, Node | string]> = [
    ['Phone', donor.pledge.phone],
    ['Date pledged', formatDate(donor.pledge.datePledged)],
    ['Amount pledged', formatCents(toCents(donor.pledge.amountPledged))],
    ['Amount received', formatCents(donor.receivedCents)],
    ['Balance due', formatCents(donor.balanceCents)],
    ['Last payment', formatDate(donor.lastPaymentDate)],
    ['# Payments', donor.paymentCount === null ? '' : String(donor.paymentCount)],
    ['Status', statusBadge(donor.status)],
    ['Notes', donor.pledge.notes],
  ];
  return h(
    'article',
    { class: 'card lookup-card' },
    h('h2', { class: 'display-md' }, donor.pledge.name || '(no name)'),
    donor.duplicate ? h('p', { class: 'hint hint-warning' }, 'This phone number is on more than one pledge, so its payments are counted twice. Remove the extra pledge.') : null,
    h('dl', {}, ...rows.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)])),
    h('h3', { class: 'heading-md' }, 'Payments'),
    renderTable({ columns: HISTORY, rows: payments, sort: null, rowId: (d) => d.payment.id, onSort: () => undefined, empty: 'No payments recorded for this donor.' }),
  );
}

export function createLookupView() {
  let query = '';
  let chosenId: string | null = null;

  return function render(state: State): HTMLElement {
    const results = h('div', { class: 'view' });
    const draw = () => {
      const computed = state.computed;
      const text = query.trim();
      if (text === '') {
        results.replaceChildren(h('p', { class: 'meta' }, 'Type a phone number (dashes and spaces do not matter) or part of a name.'));
        return;
      }
      const chosen = chosenId ? (computed.pledges.find((d) => d.pledge.id === chosenId) ?? null) : null;
      const donor = chosen ?? (/\d/.test(text) ? findByPhone(computed, text) : null);
      if (donor) {
        results.replaceChildren(donorCard(donor, paymentsForKey(computed, donor.key)));
        return;
      }
      const matches = findByName(computed, text);
      if (matches.length === 0) {
        results.replaceChildren(h('p', { class: 'empty' }, 'Not found.'));
        return;
      }
      results.replaceChildren(
        h(
          'ul',
          { class: 'match-list' },
          ...matches.map((d) => {
            const button = h('button', { type: 'button', class: 'match' }, d.pledge.name || '(no name)', h('span', { class: 'meta' }, `  ${d.pledge.phone}`));
            button.addEventListener('click', () => {
              chosenId = d.pledge.id;
              draw();
            });
            return h('li', {}, button);
          }),
        ),
      );
    };
    const input = h('input', { type: 'search', class: 'input search', id: 'lookup-input', placeholder: 'Phone number or name', autocomplete: 'off' });
    input.value = query;
    input.addEventListener('input', () => {
      query = input.value;
      chosenId = null;
      draw();
    });
    draw();
    return h(
      'section',
      { class: 'view' },
      h('header', { class: 'view-header' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Donor lookup'), h('h1', { class: 'display-md' }, 'Find a donor'))),
      h('label', { for: 'lookup-input', class: 'label' }, 'Search'),
      input,
      results,
    );
  };
}
```

`web/src/ui/export.ts`:
```ts
import { todayIso } from '../dates';
import type { Computed } from '../engine';
import type { State } from '../store';

type Cell = string | number | null;
const dollars = (cents: number | null): number | null => (cents === null ? null : cents / 100);

export function pledgeSheetRows(computed: Computed): Cell[][] {
  return [
    ['Phone Number', 'Donor Name', 'Date Pledged', 'Amount Pledged ($)', 'Last Payment Date', 'Amount Received ($)', 'Balance Due ($)', '# Payments', 'Status', 'Notes', 'Listed more than once'],
    ...computed.pledges.map((d) => [
      d.pledge.phone, d.pledge.name, d.pledge.datePledged, d.pledge.amountPledged, d.lastPaymentDate,
      dollars(d.receivedCents), dollars(d.balanceCents), d.paymentCount, d.status ?? '', d.pledge.notes, d.duplicate ? 'Yes' : '',
    ]),
  ];
}

export function paymentSheetRows(computed: Computed): Cell[][] {
  return [
    ['Phone Number', 'Donor Name', 'Date Received', 'Amount Received ($)', 'Payment Method', 'Notes', 'Counted'],
    ...computed.payments.map((d) => [d.payment.phone, d.donorName, d.payment.dateReceived, d.payment.amountReceived, d.payment.method, d.payment.notes, d.notCounted ? 'No' : 'Yes']),
  ];
}

export function summarySheetRows(state: State): Cell[][] {
  const { totals, health, methods, methodTotalCents } = state.computed;
  return [
    ['Fundraiser Goal ($)', dollars(totals.goalCents)],
    ['Total Pledged ($)', dollars(totals.pledgedCents)],
    ['Total Received ($)', dollars(totals.receivedCents)],
    ['Total Balance Outstanding ($)', dollars(totals.outstandingCents)],
    ['Total Overpaid / Credit ($)', dollars(totals.creditCents)],
    ['Number of Donors (pledged)', totals.donorCount],
    ['Number Fully Paid', totals.statusCounts.Paid],
    ['Number Partial', totals.statusCounts.Partial],
    ['Number Pending', totals.statusCounts.Pending],
    ['Number Overpaid', totals.statusCounts.Overpaid],
    ['% of Goal Received', totals.goalFraction],
    ['Payments Logged ($)', dollars(totals.loggedCents)],
    ['Unmatched Payments ($)', dollars(totals.unmatchedCents)],
    [],
    ['Data Health', null],
    ...health.map((check): Cell[] => [check.label, check.ids.length]),
    [],
    ['Collected by Payment Method', null],
    ...methods.map((row): Cell[] => [row.label, dollars(row.cents)]),
    ['Total (should match Payments Logged)', dollars(methodTotalCents)],
  ];
}

export async function downloadWorkbook(state: State): Promise<void> {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(pledgeSheetRows(state.computed)), 'Pledges');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(paymentSheetRows(state.computed)), 'Payments');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(summarySheetRows(state)), 'Summary');
  XLSX.writeFile(book, `ICG-Fundraiser-${todayIso()}.xlsx`);
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run test/ui && npm run typecheck && npm run build`
Expected: PASS, typecheck exits 0, and the build succeeds. The build output shows `xlsx` in its own chunk.

- [ ] **Step 5: Commit**

```bash
git add web/src/ui test/ui
git commit -m "feat(ui): summary with health links and method chart, donor lookup, xlsx export"
```

---

### Task 14: App shell, routing and bootstrap

**Files:**
- Create: `web/src/ui/app.ts`, `web/src/ui/screens.ts`
- Modify: `web/src/main.ts` (replace the placeholder entirely)
- Test: `test/ui/app.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces: `ViewName`, `parseRoute(hash)`, `mountApp(root, deps)`, `renderMessageScreen(root, message)`, `renderLoading(root)`

- [ ] **Step 1: Write the failing test** (`test/ui/app.test.ts`)

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { parseRoute } from '../../web/src/ui/app';
import { renderMessageScreen } from '../../web/src/ui/screens';

describe('parseRoute', () => {
  it('maps hashes to views and falls back to the summary', () => {
    expect(parseRoute('#payments')).toBe('payments');
    expect(parseRoute('#/find')).toBe('find');
    expect(parseRoute('')).toBe('summary');
    expect(parseRoute('#nonsense')).toBe('summary');
  });
});

describe('message screen', () => {
  it('shows the message as text and runs the action', () => {
    const root = document.createElement('div');
    const run = vi.fn();
    renderMessageScreen(root, { title: 'Not on the volunteer list', body: '<i>x@y.z</i> is not allowed.', action: { label: 'Use a different account', run } });
    expect(root.querySelector('i')).toBeNull();
    (root.querySelector('button') as HTMLButtonElement).click();
    expect(run).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/ui/app.test.ts`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Implement**

`web/src/ui/screens.ts`:
```ts
import { h } from './dom';

export interface Message {
  title: string;
  body: string;
  action?: { label: string; run(): void };
}

export function renderMessageScreen(root: HTMLElement, message: Message): void {
  const button = message.action ? h('button', { type: 'button', class: 'btn btn-primary' }, message.action.label) : null;
  if (button && message.action) button.addEventListener('click', message.action.run);
  root.replaceChildren(h('main', { class: 'signin card-elevated' }, h('h1', { class: 'display-md' }, message.title), h('p', { class: 'body-md ink-soft' }, message.body), button));
}

export function renderLoading(root: HTMLElement): void {
  root.replaceChildren(
    h('main', { class: 'container', 'aria-busy': 'true' }, h('p', { class: 'eyebrow' }, 'Loading the tracker…'), h('div', { class: 'grid-stats' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }))),
  );
}
```

`web/src/ui/app.ts`:
```ts
import type { Auth } from '../auth';
import type { Store } from '../store';
import { currentTheme, toggleTheme } from '../theme';
import { h } from './dom';
import { createErrorReporter } from './errors';
import { downloadWorkbook } from './export';
import type { ListFilter } from './filter';
import { createLookupView } from './lookupView';
import { drawMethodChart } from './methodChart';
import { createPaymentsView } from './paymentsView';
import { createPledgesView } from './pledgesView';
import { renderSummary } from './summaryView';

export type ViewName = 'summary' | 'pledges' | 'payments' | 'find';

const VIEWS: ReadonlyArray<{ name: ViewName; label: string }> = [
  { name: 'summary', label: 'Summary' },
  { name: 'pledges', label: 'Pledges' },
  { name: 'payments', label: 'Payments' },
  { name: 'find', label: 'Find donor' },
];
const LAST_VIEW_KEY = 'icg-last-view';

export function parseRoute(hash: string): ViewName {
  const name = hash.replace(/^#\/?/, '');
  return VIEWS.find((view) => view.name === name)?.name ?? 'summary';
}

function rememberedView(): ViewName {
  try {
    return parseRoute(`#${localStorage.getItem(LAST_VIEW_KEY) ?? ''}`);
  } catch (err) {
    console.warn('Last view could not be read; starting on Summary.', err);
    return 'summary';
  }
}

function rememberView(view: ViewName) {
  try {
    localStorage.setItem(LAST_VIEW_KEY, view);
  } catch (err) {
    console.warn('Last view could not be saved.', err);
  }
}

export interface AppDeps {
  store: Store;
  auth: Auth;
}

export function mountApp(root: HTMLElement, deps: AppDeps): void {
  let listFilter: { view: ViewName; filter: ListFilter } | null = null;
  const reportError = createErrorReporter(() => deps.store.load());
  const pledgesView = createPledgesView({ store: deps.store, reportError });
  const paymentsView = createPaymentsView({ store: deps.store, reportError });
  const lookupView = createLookupView();

  const tabs = new Map<ViewName, HTMLAnchorElement>();
  const nav = h(
    'nav',
    { class: 'tabs', 'aria-label': 'Sections' },
    ...VIEWS.map((view) => {
      const tab = h('a', { href: `#${view.name}`, class: 'tab' }, view.label);
      tab.addEventListener('click', () => {
        listFilter = null;
        if (parseRoute(location.hash) === view.name) render();
      });
      tabs.set(view.name, tab);
      return tab;
    }),
  );
  const themeButton = h('button', { type: 'button', class: 'btn btn-ghost', 'aria-pressed': String(currentTheme() === 'dark') }, currentTheme() === 'dark' ? 'Light mode' : 'Dark mode');
  themeButton.addEventListener('click', () => {
    const theme = toggleTheme();
    themeButton.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
    themeButton.setAttribute('aria-pressed', String(theme === 'dark'));
  });
  const signOut = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Sign out');
  signOut.addEventListener('click', () => deps.auth.signOut());
  const me = h('span', { class: 'meta' }, deps.store.state()?.me ?? '');
  const offline = h('div', { class: 'banner banner-warning', role: 'status', hidden: navigator.onLine }, 'You are offline. Changes cannot be saved until the connection is back.');
  window.addEventListener('online', () => { offline.hidden = true; });
  window.addEventListener('offline', () => { offline.hidden = false; });

  const main = h('main', { class: 'container', id: 'main' });
  root.replaceChildren(
    h('header', { class: 'nav-bar' }, h('div', { class: 'nav-inner' }, h('a', { href: '#summary', class: 'wordmark' }, 'ICG Fundraiser Tracker'), nav, h('div', { class: 'nav-actions' }, me, themeButton, signOut))),
    offline,
    main,
  );

  function render() {
    const state = deps.store.state();
    if (!state) return;
    const view = parseRoute(location.hash);
    tabs.forEach((tab, name) => (name === view ? tab.setAttribute('aria-current', 'page') : tab.removeAttribute('aria-current')));
    main.classList.toggle('container-wide', view === 'pledges' || view === 'payments');
    const filter = listFilter && listFilter.view === view ? listFilter.filter : null;
    const clearFilter = () => {
      listFilter = null;
      render();
    };
    const content =
      view === 'pledges' ? pledgesView(state, filter, clearFilter)
      : view === 'payments' ? paymentsView(state, filter, clearFilter)
      : view === 'find' ? lookupView(state)
      : renderSummary(state, {
          store: deps.store,
          reportError,
          exportWorkbook: downloadWorkbook,
          drawChart: drawMethodChart,
          showList: (target, targetFilter) => {
            listFilter = { view: target, filter: targetFilter };
            location.hash = target;
          },
        });
    main.replaceChildren(content);
    rememberView(view);
  }

  window.addEventListener('hashchange', () => {
    render();
    window.scrollTo({ top: 0 });
  });
  deps.store.subscribe(render);
  if (!location.hash) history.replaceState(null, '', `#${rememberedView()}`);
  render();
}
```

`web/src/main.ts`:
```ts
import '@fontsource-variable/inter';
import '@fontsource/cormorant-garamond/500.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { ApiError, createApi } from './api';
import { createAuth } from './auth';
import { todayIso } from './dates';
import { createStore } from './store';
import { mountApp } from './ui/app';
import { messageOf } from './ui/errors';
import { renderLoading, renderMessageScreen } from './ui/screens';

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} is missing from index.html`);
  return element;
}

async function start() {
  const root = requireElement('app');
  const scriptUrl = import.meta.env.VITE_SCRIPT_URL;
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!scriptUrl || !clientId) {
    renderMessageScreen(root, { title: 'Not set up yet', body: 'This copy of the tracker has no Apps Script URL or Google client ID. Follow docs/SETUP.md, then rebuild.' });
    return;
  }
  const auth = createAuth(clientId, requireElement('auth'));
  const store = createStore(createApi(scriptUrl, (force) => auth.getToken(force)), () => todayIso());
  renderLoading(root);
  try {
    await store.load();
    mountApp(root, { store, auth });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'FORBIDDEN') {
      renderMessageScreen(root, {
        title: 'Not on the volunteer list',
        body: `${err.message} Ask the organiser to add your Google account, or sign in with a different one.`,
        action: { label: 'Use a different account', run: () => auth.signOut() },
      });
      return;
    }
    renderMessageScreen(root, { title: 'Could not load the tracker', body: messageOf(err), action: { label: 'Try again', run: () => window.location.reload() } });
  }
}

void start();
```

- [ ] **Step 4: Run the full suite and build**

Run: `npm run check`
Expected: typecheck, all tests and the build pass.

- [ ] **Step 5: Smoke-test the unconfigured build**

Run: `npm run build && npx vite preview --outDir dist --port 4173`. Then load `http://localhost:4173` with Playwright (`browser_navigate` + `browser_snapshot`).
Expected: the "Not set up yet" screen, with no console errors. Stop the preview server afterwards.

- [ ] **Step 6: Commit**

```bash
git add web/src test/ui/app.test.ts
git commit -m "feat(ui): app shell, routing, sign-in bootstrap and error screens"
```

---

### Task 15: CI, setup guide and project docs

**Files:**
- Create: `.github/workflows/pages.yml`, `docs/SETUP.md`, `README.md`
- Modify: `CLAUDE.md` (add a web app section)

- [ ] **Step 1: `.github/workflows/pages.yml`**

```yaml
name: Test and deploy

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
        env:
          VITE_BASE: /${{ github.event.repository.name }}/
          VITE_SCRIPT_URL: ${{ vars.VITE_SCRIPT_URL }}
          VITE_GOOGLE_CLIENT_ID: ${{ vars.VITE_GOOGLE_CLIENT_ID }}
      - if: github.event_name != 'pull_request'
        uses: actions/upload-pages-artifact@v5
        with:
          path: dist

  deploy:
    if: github.event_name != 'pull_request'
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

- [ ] **Step 2: `docs/SETUP.md`**

````markdown
# Setting up the Fundraiser Tracker web app

One-time setup, about 30 minutes. You need a Google account (the organiser's) and a GitHub account.

## 1. The data Sheet and its API

1. Create a new Google Sheet named **ICG Fundraiser Data**. Keep it private. Nobody else needs access to it.
2. In the Sheet, open **Extensions → Apps Script**.
3. Replace the contents of `Code.gs` with `apps-script/Code.gs` from this repo.
4. Open **Project Settings**, tick **Show "appsscript.json" manifest file in editor**, then replace that file with `apps-script/appsscript.json`.
5. Back in the editor, pick `setup` from the function list and press **Run**. Approve the permissions. The Sheet now has the **Pledges**, **Payments**, **Settings** and **Allowlist** tabs, and your own email is on the Allowlist.
6. Add each volunteer's Google email to the **Allowlist** tab, one per row. To remove access later, delete their row. It takes effect on their next click.

## 2. The Google sign-in client

1. Go to <https://console.cloud.google.com/>, create a project (for example `icg-fundraiser`), and select it.
2. **APIs & Services → OAuth consent screen**: choose **External** and fill in the app name and your support email. Under **Audience**, press **Publish app**. With only the basic sign-in scopes this needs no Google review, and it lets any allowlisted volunteer sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**. Under **Authorized JavaScript origins** add:
   - `https://<your-github-username>.github.io`
   - `http://localhost:5173` (for local testing)
4. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`.
5. In Apps Script, go to **Project Settings → Script properties → Add**: name `CLIENT_ID`, value = that Client ID.

## 3. Deploy the API

1. In Apps Script, go to **Deploy → New deployment → Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**. "Anyone" only lets the request reach the script. The script itself rejects anyone who isn't signed in and on the Allowlist.
3. Copy the **Web app URL**. It ends in `/exec`.

When you change `Code.gs` later, use **Deploy → Manage deployments → ✎ → Version: New version**. That keeps the same URL.

## 4. Publish the site

1. Create a GitHub repository. It must be public for free GitHub Pages. The code holds no donor data, and the data stays in your private Sheet.
2. Push this folder to it. `.gitignore` keeps the `.xlsx` and `.docx` files out.
3. In the repository, go to **Settings → Pages → Source: GitHub Actions**.
4. **Settings → Secrets and variables → Actions → Variables**: add `VITE_SCRIPT_URL` (from step 3) and `VITE_GOOGLE_CLIENT_ID` (from step 2).
5. **Actions → Test and deploy → Run workflow**. When it finishes, the site is at `https://<user>.github.io/<repo>/`.

## Local development

Create `.env.local` (git-ignored) in the repo root:

```
VITE_SCRIPT_URL=https://script.google.com/macros/s/…/exec
VITE_GOOGLE_CLIENT_ID=….apps.googleusercontent.com
```

Then run `npm install`, then `npm run dev`, and open <http://localhost:5173>.
````

- [ ] **Step 3: `README.md`**

````markdown
# ICG Fundraiser Tracker

A web version of `Masjid_Fundraiser_Tracker_v3.xlsx`. Volunteers sign in with Google and record pledges and payments. The totals, statuses and data-health checks work exactly as they do in the workbook.

- **Setup:** see [docs/SETUP.md](docs/SETUP.md).
- **Design:** [docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md](docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md), plus [DESIGN.md](DESIGN.md) for the visual system.

```bash
npm install
npm run dev      # local app (needs .env.local)
npm run check    # typecheck + tests + build
```
````

- [ ] **Step 4: Update `CLAUDE.md`**

Replace the opening "What this repository is" paragraph so that it lists the web app alongside the two Office files. Then add this section before "## Conventions":

```markdown
## The web app

`web/` (Vite + TypeScript) plus `apps-script/Code.gs` is a second implementation of the workbook: it has the same rules, but its data lives in a private Google Sheet. Spec: `docs/superpowers/specs/2026-09-23-fundraiser-web-app-design.md`.

- **The workbook stays the source of truth.** `web/src/engine/` must reproduce it cell for cell. `tools/excel-oracle.ps1` pushes `test/fixtures/parity-input.json` through the real workbook in Excel and writes `parity-expected.json`, and `test/engine/parity.test.ts` asserts the engine matches. **Any workbook formula change means re-running the oracle and fixing the engine in the same pass.** Never hand-edit the expected file.
- **Validation lives in two places.** It's in `web/src/validate.ts` and in `validateRow_` in `Code.gs`, and `test/support/validationCases.ts` runs against both. Change them together.
- **Code.gs is tested in Node** (`test/support/appsScript.ts` fakes the Apps Script services). After editing it, paste it into the Apps Script editor and deploy a **new version** of the existing deployment, so the URL doesn't change.
- **Text written to the Sheet is apostrophe-prefixed** (`toSheetRow_`). This keeps leading zeros and `+`, and stops formula injection. Don't remove it.
- **Styling** comes only from `web/src/styles/tokens.css` (from `DESIGN.md`). No other file contains colour literals.
- `npm run check` is the gate: typecheck, all tests and the build.
```

Also update the "Conventions" bullet about the guide: the user guide covers the workbook only, and the web app is documented in `docs/SETUP.md`.

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add .github docs/SETUP.md README.md CLAUDE.md
git commit -m "ci: test and deploy to GitHub Pages; setup guide and project docs"
```

---

### Task 16: Deploy and end-to-end check (with the user)

These steps touch the user's Google and GitHub accounts, so each one is outward-facing. **Ask before each one.** The user may prefer to do them personally by following `docs/SETUP.md`.

- [ ] **Step 1:** Walk the user through `docs/SETUP.md` §1–§3. Record the Apps Script URL and the Client ID. Neither is secret.
- [ ] **Step 2:** With explicit permission, create the GitHub repo and push: `gh repo create <name> --public --source . --push`. Then set the variables: `gh variable set VITE_SCRIPT_URL --body …`, `gh variable set VITE_GOOGLE_CLIENT_ID --body …`, and enable Pages from Actions.
- [ ] **Step 3:** Watch the workflow: `gh run watch`. Expected: build and deploy both succeed.
- [ ] **Step 4:** Do the end-to-end pass on the live URL, on desktop and on a phone. Tick each item:
  - [ ] An allowlisted account signs in and lands on Summary. An account that isn't allowlisted sees "Not on the volunteer list".
  - [ ] Add a pledge whose phone starts with `0`. In the Sheet the cell shows the leading zero, and in the app it reads back unchanged.
  - [ ] Add a pledge whose phone starts with `+`. The Sheet shows text, not `#ERROR!`.
  - [ ] Log a payment for an unknown phone. The live preview warns, the row turns red, and Data Health shows 1 with a working "Show" link.
  - [ ] Log payments of 0.10 and 0.20 against a 0.30 pledge. The status reads `Paid` and the balance reads `$0.00`.
  - [ ] Open the same pledge in two browser tabs and save both. The second save gets the "Someone else changed this row" dialog, and Reload shows the first save's change.
  - [ ] Edit the goal. The progress bar and percentage update.
  - [ ] Toggle dark mode, reload, and check the choice is kept. The chart recolours. Printing the Summary gives light colours.
  - [ ] Download .xlsx and open it in Excel. Phones keep their leading zeros.
  - [ ] Leave the tab open for more than an hour, then save something. It saves (the token refreshes silently) or shows the Google sign-in, never a raw error.
  - [ ] Type a date straight into the Sheet's `datePledged` column, then reload the app. The date appears correctly.
- [ ] **Step 5:** Record in `CLAUDE.md` which items were verified and when, the way the Sheets parity check is recorded. Then update the project memory file.
````

