// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '../../web/src/auth';
import { HEALTH_LABELS, STATUS, WARN_NOT_IN_PLEDGES, WARN_NO_AMOUNT, compute, needsFollowUp, type HealthCheck } from '../../web/src/engine';
import type { State, Store } from '../../web/src/store';
import { mountApp, parseRoute } from '../../web/src/ui/app';
import { PAYMENT_HELP, PLEDGE_HELP } from '../../web/src/ui/help';
import { HELP_SECTIONS, QUOTED_MESSAGES, createHelpView } from '../../web/src/ui/helpView';
import { SETTINGS, TODAY, payment, pledge } from '../support/factories';

const NO_PHONE_MONEY_TOPIC = 'Record money with no phone number (collection box, walk-in)';
const GENERAL_DONATIONS = { phone: '000-000-0000', name: 'General donations' } as const;

const SECTION_TITLES = [
  'Getting started',
  'The screens',
  'How to…',
  'Understanding the numbers',
  'Warnings and data health',
  'Working together',
  'When something goes wrong',
  'For the organiser',
];

function fakeStore() {
  const pledges = [pledge({ id: 'p1', phone: '555-010-0101', name: 'Aisha Rahman', amountPledged: 100 })];
  const state: State = { pledges, payments: [], settings: SETTINGS, me: 'me@example.com', computed: compute(pledges, [], SETTINGS, TODAY) };
  const listeners = new Set<(state: State) => void>();
  const store = {
    state: () => state,
    subscribe: (listener: (state: State) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: vi.fn(async () => undefined),
    lastLoadedAt: vi.fn(() => Date.now()),
  };
  return { store: store as unknown as Store, publish: () => listeners.forEach((listener) => listener(state)) };
}

const fakeAuth = (): Auth => ({ getToken: vi.fn(async () => 'tok'), refreshIfStale: vi.fn(), hasFreshToken: () => false, suppressPrompts: () => () => undefined, signOut: vi.fn() });

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|gs)$/.test(entry.name) && entry.name !== 'helpView.ts' ? [path] : [];
  });
}

describe('Help route', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
  });
  afterEach(() => {
    document.body.replaceChildren();
    history.replaceState(null, '', '#');
  });

  it('parses #help', () => {
    expect(parseRoute('#help')).toBe('help');
  });

  it('adds a Help tab after Find donor and renders the guide', () => {
    history.replaceState(null, '', '#help');
    mountApp(root, { store: fakeStore().store, auth: fakeAuth() });
    const labels = Array.from(root.querySelectorAll('nav.tabs a')).map((tab) => tab.textContent);
    expect(labels.slice(-2)).toEqual(['Find donor', 'Help']);
    expect(root.querySelector('nav.tabs a[href="#help"]')?.getAttribute('aria-current')).toBe('page');
    expect(root.querySelector('main .help-guide')).not.toBeNull();
  });

  it('keeps expanded sections open when the store publishes', () => {
    history.replaceState(null, '', '#help');
    const { store, publish } = fakeStore();
    mountApp(root, { store, auth: fakeAuth() });
    const last = Array.from(root.querySelectorAll<HTMLDetailsElement>('main details.help-section')).at(-1) as HTMLDetailsElement;
    last.open = true;
    publish();
    expect(Array.from(root.querySelectorAll<HTMLDetailsElement>('main details.help-section')).at(-1)?.open).toBe(true);
  });
});

describe('createHelpView', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('renders every section heading, first one open', () => {
    const view = createHelpView();
    const headings = Array.from(view.querySelectorAll('details.help-section > summary')).map((summary) => summary.textContent?.trim());
    expect(headings).toEqual(SECTION_TITLES);
    expect(HELP_SECTIONS.map((section) => section.title)).toEqual(SECTION_TITLES);
    const sections = Array.from(view.querySelectorAll<HTMLDetailsElement>('details.help-section'));
    expect(sections.map((section) => section.open)).toEqual(SECTION_TITLES.map((_, index) => index === 0));
  });

  it('links every table-of-contents entry to an existing section', () => {
    const view = createHelpView();
    const links = Array.from(view.querySelectorAll<HTMLAnchorElement>('.help-toc a'));
    expect(links).toHaveLength(SECTION_TITLES.length);
    for (const link of links) {
      const id = (link.getAttribute('href') ?? '').replace(/^#/, '');
      expect(view.querySelector(`#${id}`)).toBeInstanceOf(HTMLDetailsElement);
    }
  });

  it('opens a section from the table of contents without leaving the Help route', () => {
    history.replaceState(null, '', '#help');
    const view = createHelpView();
    document.body.append(view);
    const target = view.querySelectorAll<HTMLDetailsElement>('details.help-section')[6];
    Element.prototype.scrollIntoView = vi.fn();
    const link = view.querySelector<HTMLAnchorElement>(`.help-toc a[href="#${target.id}"]`) as HTMLAnchorElement;
    link.click();
    expect(target.open).toBe(true);
    expect(location.hash).toBe('#help');
  });

  it('opens every section for printing and restores them afterwards', () => {
    const view = createHelpView();
    document.body.append(view);
    const sections = Array.from(view.querySelectorAll<HTMLDetailsElement>('details.help-section'));
    sections[2].open = true;
    window.dispatchEvent(new Event('beforeprint'));
    expect(sections.every((section) => section.open)).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(sections.map((section) => section.open)).toEqual(sections.map((_, index) => index === 0 || index === 2));
  });

  it('explains every status, warning and data-health check', () => {
    const text = createHelpView().textContent ?? '';
    for (const label of Object.values(HEALTH_LABELS)) expect(text).toContain(label);
    for (const status of Object.values(STATUS)) expect(text).toContain(status);
    expect(text).toContain(WARN_NOT_IN_PLEDGES);
    expect(text).toContain(WARN_NO_AMOUNT);
  });

  it('points only at How-to topics that exist', () => {
    const view = createHelpView();
    const howToTitles = Array.from(view.querySelectorAll('#help-how-to .help-topic > h3')).map((heading) => heading.textContent);
    const pointers = Array.from(view.querySelectorAll('strong')).filter((title) => title.nextSibling?.textContent?.startsWith(' in How to…'));
    expect(pointers.length).toBeGreaterThan(0);
    for (const pointer of pointers) expect(howToTitles, pointer.textContent ?? '').toContain(pointer.textContent);
  });

  it('sends a real post-dated check to its own topic instead of having its date corrected', () => {
    const view = createHelpView();
    const howToTitles = Array.from(view.querySelectorAll('#help-how-to .help-topic > h3')).map((heading) => heading.textContent);
    expect(howToTitles).toEqual(expect.arrayContaining(['A check bounced or money was given back', 'A donor gives post-dated checks']));
    expect(view.querySelector('dt[data-health="futureDated"] + dd')?.textContent).toContain('A donor gives post-dated checks in How to…');
  });

  it('gives money with no donor a How-to topic, pointed at from the not-in-Pledges warning', () => {
    const view = createHelpView();
    const howTo = Array.from(view.querySelectorAll('#help-how-to .help-topic')).find((topic) => topic.querySelector('h3')?.textContent === NO_PHONE_MONEY_TOPIC);
    expect(howTo?.textContent).toContain(`${GENERAL_DONATIONS.phone} as the phone number and ${GENERAL_DONATIONS.name} as the donor name`);
    const warning = Array.from(view.querySelectorAll('#help-warnings dt')).find((term) => term.textContent === WARN_NOT_IN_PLEDGES);
    expect(warning?.nextElementSibling?.textContent).toContain(`${NO_PHONE_MONEY_TOPIC} in How to…`);
  });

  it('warns about the side effects the General donations pledge really has', () => {
    const howTo = Array.from(createHelpView().querySelectorAll('#help-how-to .help-topic')).find((topic) => topic.querySelector('h3')?.textContent === NO_PHONE_MONEY_TOPIC);
    for (const effect of [STATUS.overpaid, 'Overpaid / credit', HEALTH_LABELS.possibleDuplicatePayments, 'Unmatched payments stays at $0.00']) expect(howTo?.textContent).toContain(effect);

    const general = pledge({ id: 'general', phone: GENERAL_DONATIONS.phone, name: GENERAL_DONATIONS.name, amountPledged: 0 });
    const aisha = pledge({ phone: '555-010-0101', name: 'Aisha Rahman', amountPledged: 1000, datePledged: '2026-09-01' });
    const payments = [
      payment({ phone: '555-010-0101', amountReceived: 500, dateReceived: '2026-09-05' }),
      payment({ phone: GENERAL_DONATIONS.phone, amountReceived: 1200, dateReceived: '2026-08-28' }),
      payment({ phone: GENERAL_DONATIONS.phone, amountReceived: 20, dateReceived: '2026-09-18' }),
      payment({ phone: GENERAL_DONATIONS.phone, amountReceived: 20, dateReceived: '2026-09-18' }),
    ];
    const computed = compute([general, aisha], payments, SETTINGS, TODAY);
    expect(computed.totals).toMatchObject({ receivedCents: 174000, unmatchedCents: 0, creditCents: 124000, donorCount: 1, statusCounts: { Overpaid: 1, Partial: 1 } });
    expect(computed.totals.goalFraction).toBeCloseTo(0.174, 12);
    const flagged = (checks: HealthCheck[]) => Object.fromEntries(checks.map((check) => [check.id, check.ids.length]));
    expect(flagged(computed.health)).toMatchObject({ notMatched: 0, pledgeNoPhone: 0, predatesPledge: 0, possibleDuplicatePayments: 2 });
    expect(needsFollowUp(computed.pledges[0], TODAY)).toBe(false);

    const dated = compute([{ ...general, datePledged: TODAY }, aisha], payments, SETTINGS, TODAY);
    expect(flagged(dated.health)).toMatchObject({ predatesPledge: 1 });
  });

  it('describes the form fields with the same help the forms show', () => {
    const text = createHelpView().textContent ?? '';
    for (const help of [...Object.values(PLEDGE_HELP), ...Object.values(PAYMENT_HELP)]) expect(text).toContain(help);
  });

  it('builds its content as text, never as parsed markup', () => {
    const view = createHelpView();
    expect(view.querySelector('script, iframe, img')).toBeNull();
    expect(view.textContent).toContain('A pledge is a promise; a payment is money in hand.');
    for (const element of Array.from(view.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) expect(attribute.name.startsWith('on')).toBe(false);
    }
  });

  it('quotes only messages the app can actually show', () => {
    // Vitest runs from the repo root (vite.config.ts), and jsdom's import.meta.url is not a file: URL.
    const root = process.cwd();
    const source = [...sourceFiles(join(root, 'web', 'src')), join(root, 'apps-script', 'Code.gs')].map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(QUOTED_MESSAGES.length).toBeGreaterThan(10);
    for (const message of QUOTED_MESSAGES) expect(source, message).toContain(message);
  });
});
