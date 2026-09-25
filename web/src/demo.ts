import { ApiError, type Api, type LoadResult, type RowRef, type Versioned } from './api';
import type { Payment, PaymentDraft, Pledge, PledgeDraft, Settings } from './types';

// Dev-only stand-in for the Apps Script backend so every screen can be exercised without Google accounts.
// main.ts imports it dynamically behind import.meta.env.DEV, so it never ships in a production build.

const DEMO_USER = 'demo@example.com';
const SEEDED_BY = 'organiser@example.com';
const SEEDED_AT = '2026-09-01T12:00:00.000Z';
// A seeded pledge was last saved on the day it was pledged. A saved change counts as follow-up
// activity (engine/followUp.ts), so the shared, recent SEEDED_AT would empty Needs follow-up.
const pledgeSavedOn = (datePledged: string) => `${datePledged}T12:00:00.000Z`;
const DEFAULT_LATENCY_MS = 300;
const VERSION_FIELDS = new Set(['id', 'updatedAt', 'updatedBy']);
const METHODS = ['Cash', 'Bank Transfer', 'Card', 'Check', 'Online', 'Other'];

// Event-scale seed for the Task 7 performance check (`?demo&big`). Sized to the plan's realistic
// ceiling (~1,500 pledges) plus double the payments, entirely index-derived so two runs — and two
// machines — always produce byte-identical rows.
const BIG_PLEDGE_COUNT = 1500;
const BIG_PAYMENT_COUNT = 3000;
const BIG_FIRST_NAMES = ['Amina', 'Bilal', 'Chioma', 'Dawud', 'Elif', 'Farid', 'Ghalia', 'Hakim', 'Imani', 'Junayd', 'Khadija', 'Layth'];
const BIG_LAST_NAMES = ['Abara', 'Bello', 'Chowdhury', 'Demir', 'Elmi', 'Farouk', 'Gueye', 'Haidari', 'Ibrahim', 'Jalloh', 'Karimi', 'Lawal'];

type PledgeSeed = [phone: string, name: string, datePledged: string, amountPledged: number | null, notes?: string];
type PaymentSeed = [phone: string, dateReceived: string, amountReceived: number | null, method: string, notes?: string];

// Fixed, not wall-clock-relative: a "30 days from today" date would eventually drift into the
// June 2026 window e2e/payments-date-range.spec.ts filters on, or the 30-day Needs-follow-up
// window, silently breaking those hardcoded assertions on whatever day the suite happens to run.
// This stays safely past the rest of the (2026) seed and demonstrates "payment dated in the
// future" for the practical life of this fixture — it will eventually need bumping, like the
// seed's other dates, just on a much longer horizon.
const POST_DATED_CHECK_DATE = '2036-01-01';

// Pure calendar-day arithmetic in UTC (no reliance on "today" or the local timezone), so the big
// seed is byte-identical on any date and any machine.
function addDaysIso(base: string, days: number): string {
  const [year, month, day] = base.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${mm}-${dd}`;
}

function seedPledges(): Pledge[] {
  const seeds: PledgeSeed[] = [
    ['555-0101', 'Aisha Rahman', '2026-06-01', 1000],
    ['(555) 0102', 'Omar Siddiqui', '2026-06-03', 2500, 'Paying monthly'],
    ['555 0103', 'Fatima Khan', '2026-06-10', 500],
    ['5550104', 'Yusuf Ali', '2026-06-12', 300],
    ['555-0105', 'Maryam Hassan', '2026-06-15', 1200],
    ['555-0105', 'Maryam Hassan', '2026-07-02', 1200, 'Entered twice by mistake'],
    ['555-0107', '', '2026-07-04', 750, 'Asked to stay anonymous'],
    ['555-0108', 'Bilal Ahmed', '2026-07-08', null, 'Amount to be confirmed'],
    ['', 'Khadija Noor', '2026-07-10', 200, 'Phone number not given'],
    ['555-0110', 'Ibrahim Musa', '2026-07-12', 1500],
    ['555-0111', 'Zainab Osman', '2026-07-15', 1200],
    ['555-0112', 'Hamza Idris', '2026-07-20', 800],
    ['555-0113', 'Sumayyah Bello', '2026-08-01', 400],
    ['555-0114', 'Abdullahi Garba', '2026-08-05', 2000, 'Matching gift from employer expected'],
    ['555-0115', 'Hafsa Yusuf', '2026-09-05', 600, 'Paid before the pledge form came in'],
    ['555-0116', 'Layla Nasser', '2026-08-20', 300],
  ];
  return seeds.map(([phone, name, datePledged, amountPledged, notes = ''], index) => ({
    id: `demo-pledge-${index + 1}`,
    phone,
    name,
    datePledged,
    amountPledged,
    notes,
    updatedAt: pledgeSavedOn(datePledged),
    updatedBy: SEEDED_BY,
  }));
}

function seedPayments(): Payment[] {
  const seeds: PaymentSeed[] = [
    ['555-0101', '2026-06-05', 500, 'Cash'],
    ['555-0101', '2026-07-05', 500, 'Bank Transfer'],
    ['555-0102', '2026-06-10', 250, 'Card'],
    ['555-0102', '2026-07-10', 250, 'Card'],
    ['555-0102', '2026-08-10', 250, 'Card'],
    ['555-0102', '2026-09-10', 250, 'Card'],
    ['555-0104', '2026-06-20', 200, 'Cash'],
    ['555-0104', '2026-07-20', 150, 'Cash', 'Extra towards the carpet'],
    ['555-0105', '2026-06-30', 600, 'Check', 'Check #1042'],
    ['555-0107', '2026-07-15', 250, 'Online'],
    ['555-0108', '2026-07-18', 100, 'Cash'],
    ['555-0199', '2026-07-21', 150, 'Cash', 'Phone not recognised'],
    ['555-0110', '2026-07-25', 500, 'Bank Transfer'],
    ['555-0110', '2026-08-25', 250, ''],
    ['555-0111', '2026-07-30', 600, 'Online'],
    ['555-0111', '2026-08-30', 600, 'Online'],
    ['555-0112', '2026-08-02', 0.1, 'Cash'],
    ['555-0112', '2026-08-03', 0.2, 'Cash'],
    ['555-0112', '2026-08-15', 399.7, 'Other', 'Collected at the Friday table'],
    ['555-0114', '2026-08-10', 1000, 'Check'],
    ['555-0114', '', 250, 'Cash', 'Date not written on the envelope'],
    ['555-0114', POST_DATED_CHECK_DATE, 250, 'Check', 'Post-dated check'],
    ['555-0115', '2026-08-10', 300, 'Card'],
    ['555-0115', '2026-09-01', 300, 'Card'],
    ['555-0113', '2026-09-12', 0, ''],
    // Same phone, amount and date twice - a possible duplicate entry (may just be two real installments).
    ['555-0116', '2026-08-25', 150, 'Cash', 'Possible duplicate entry'],
    ['(555) 0116', '2026-08-25', 150, 'Cash', 'Possible duplicate entry'],
  ];
  return seeds.map(([phone, dateReceived, amountReceived, method, notes = ''], index) => ({
    id: `demo-payment-${index + 1}`,
    phone,
    dateReceived,
    amountReceived,
    method,
    notes,
    updatedAt: SEEDED_AT,
    updatedBy: SEEDED_BY,
  }));
}

// `?demo&big`: an event-scale seed for the Task 7 performance check. Every field is derived from
// the row index alone, so the row count and content never change between runs.
function seedBigPledges(): Pledge[] {
  return Array.from({ length: BIG_PLEDGE_COUNT }, (_, index) => {
    const first = BIG_FIRST_NAMES[index % BIG_FIRST_NAMES.length];
    const last = BIG_LAST_NAMES[(index * 7 + 3) % BIG_LAST_NAMES.length];
    // 1-in-29 pledges have no amount yet, matching the small seed's "amount to be confirmed" case.
    const amountPledged = index % 29 === 0 ? null : 100 + ((index * 37) % 4900);
    const datePledged = addDaysIso('2026-01-01', index % 240);
    return {
      id: `demo-pledge-big-${index + 1}`,
      phone: `555-3${String(index).padStart(4, '0')}`,
      name: `${first} ${last}`,
      datePledged,
      amountPledged,
      notes: index % 50 === 0 ? 'Sample note for the event-scale performance check.' : '',
      updatedAt: pledgeSavedOn(datePledged),
      updatedBy: SEEDED_BY,
    };
  });
}

function seedBigPayments(pledgePhones: readonly string[]): Payment[] {
  return Array.from({ length: BIG_PAYMENT_COUNT }, (_, index) => {
    // Most payments land on a pledge phone (so the Pledges join has real work to do); 1-in-37
    // target an unregistered phone, matching the small seed's "phone not in Pledges" warning.
    const phone = index % 37 === 0 ? `555-9${String(index).padStart(4, '0')}` : pledgePhones[index % pledgePhones.length];
    const amountReceived = index % 41 === 0 ? null : 20 + ((index * 53) % 480);
    return {
      id: `demo-payment-big-${index + 1}`,
      phone,
      dateReceived: addDaysIso('2026-01-15', index % 260),
      amountReceived,
      method: METHODS[index % METHODS.length],
      notes: '',
      updatedAt: SEEDED_AT,
      updatedBy: SEEDED_BY,
    };
  });
}

export interface DemoOptions {
  /** `?demo&big`: seeds 1,500 pledges / 3,000 payments instead of the small hand-authored set. */
  big?: boolean;
}

export function createDemoApi(latencyMs: number = DEFAULT_LATENCY_MS, options: DemoOptions = {}): Api {
  let pledges = options.big ? seedBigPledges() : seedPledges();
  let payments = options.big ? seedBigPayments(pledges.map((pledge) => pledge.phone)) : seedPayments();
  let settings: Settings = { goal: 25000, paymentMethods: METHODS };
  let lastStamp = 0;

  const delay = () => new Promise<void>((resolve) => setTimeout(resolve, latencyMs));
  // The store's conflict check compares updatedAt by equality, so two saves in the same millisecond must still differ.
  const stamp = () => {
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    return new Date(lastStamp).toISOString();
  };

  function assertUnchanged<T extends Versioned>(rows: readonly T[], row: Versioned): T {
    const found = rows.find((candidate) => candidate.id === row.id);
    if (!found) throw new ApiError('NOT_FOUND', 'Someone else deleted this row.');
    if (found.updatedAt !== row.updatedAt) throw new ApiError('CONFLICT', 'Someone else changed this row since you opened it.', undefined, { ...found });
    return found;
  }

  // Mirrors Code.gs upsert_: no version means a create, and a create repeated under the same id returns the first copy.
  function upsert<T extends Pledge | Payment>(rows: readonly T[], draft: Omit<T, keyof Versioned | 'updatedBy'>, row: RowRef): { rows: T[]; saved: T } {
    const record = { ...draft, id: row.id, updatedAt: stamp(), updatedBy: DEMO_USER } as T;
    if (row.updatedAt === undefined) {
      const already = rows.find((candidate) => candidate.id === row.id);
      if (already) {
        const entryFields = Object.keys(draft).filter((field) => !VERSION_FIELDS.has(field)) as Array<keyof T>;
        const same = entryFields.every((field) => already[field] === record[field]);
        if (!same) throw new ApiError('CONFLICT', 'This entry was already saved with different values. Reopen it to check.', undefined, { ...already });
        return { rows: [...rows], saved: already };
      }
      return { rows: [...rows, record], saved: record };
    }
    assertUnchanged(rows, row);
    return { rows: rows.map((candidate) => (candidate.id === row.id ? record : candidate)), saved: record };
  }

  return {
    async load(): Promise<LoadResult> {
      await delay();
      return { pledges: pledges.map((row) => ({ ...row })), payments: payments.map((row) => ({ ...row })), settings: { ...settings, paymentMethods: [...settings.paymentMethods] }, me: DEMO_USER };
    },
    async savePledge(draft: PledgeDraft, row: RowRef): Promise<Pledge> {
      await delay();
      const result = upsert<Pledge>(pledges, draft, row);
      pledges = result.rows;
      return { ...result.saved };
    },
    async savePayment(draft: PaymentDraft, row: RowRef): Promise<Payment> {
      await delay();
      const result = upsert<Payment>(payments, draft, row);
      payments = result.rows;
      return { ...result.saved };
    },
    async deletePledge(row: Versioned): Promise<void> {
      await delay();
      assertUnchanged(pledges, row);
      pledges = pledges.filter((candidate) => candidate.id !== row.id);
    },
    async deletePayment(row: Versioned): Promise<void> {
      await delay();
      assertUnchanged(payments, row);
      payments = payments.filter((candidate) => candidate.id !== row.id);
    },
    async setGoal(goal: number): Promise<Settings> {
      await delay();
      settings = { ...settings, goal: Math.round(goal * 100) / 100 };
      return { ...settings, paymentMethods: [...settings.paymentMethods] };
    },
  };
}
