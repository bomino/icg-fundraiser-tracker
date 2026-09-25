// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFLINE_WAIT_MS } from '../../web/src/api';
import type { Auth } from '../../web/src/auth';
import { todayIso } from '../../web/src/dates';
import { FOLLOW_UP_AFTER_DAYS, HEALTH_LABELS, STATUS, WARN_NOT_IN_PLEDGES, WARN_NO_AMOUNT, compute, needsFollowUp, type HealthCheck } from '../../web/src/engine';
import type { State, Store } from '../../web/src/store';
import { AUTO_REFRESH_AFTER_MS, mountApp, parseRoute } from '../../web/src/ui/app';
import { DISPLAY_STALE_AFTER_MS } from '../../web/src/ui/displayView';
import { PAYMENT_HELP, PLEDGE_HELP } from '../../web/src/ui/help';
import { HELP_SECTIONS, QUOTED_MESSAGES, createHelpView } from '../../web/src/ui/helpView';
import { MATCH_LIMIT } from '../../web/src/ui/lookupView';
import { PHONE_TABLE_PAGE_SIZE, TABLE_PAGE_SIZE } from '../../web/src/ui/table';
import { SITE_API_VERSION, SITE_COMMIT } from '../../web/src/version';
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
  const state: State = { pledges, payments: [], settings: SETTINGS, me: 'me@example.com', apiVersion: SITE_API_VERSION, computed: compute(pledges, [], SETTINGS, TODAY) };
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

  it('explains both out-of-date banners', () => {
    const text = createHelpView().textContent ?? '';
    expect(text).toContain("The tracker's server is out of date.");
    expect(text).toContain('The tracker was updated. Reload this page to get the latest version.');
  });

  it('names the commit the site was built from and the Code.gs it needs, for the organiser to quote', () => {
    const text = createHelpView().textContent ?? '';
    expect(text).toContain(SITE_COMMIT === '' ? 'This copy of the app is a local build' : `This copy of the app was built from commit ${SITE_COMMIT}`);
    expect(text).toContain(`const API_VERSION = ${SITE_API_VERSION};`);
  });

  // The guide writes these figures as plain prose, so nothing else fails when the code's value changes.
  it('gives the same day, row, minute and second figures the app uses', () => {
    const text = createHelpView().textContent ?? '';
    expect(text).toContain(`last ${FOLLOW_UP_AFTER_DAYS} days`);
    expect(text).toContain(`first ${TABLE_PAGE_SIZE} rows at a time (${PHONE_TABLE_PAGE_SIZE} on a phone`);
    expect(text).toContain(`only the first ${MATCH_LIMIT} are listed, under a line such as Showing ${MATCH_LIMIT} of 312`);
    // Each minutes figure is tied to its own sentence, or one constant changing to the other's value would still pass.
    expect(text).toContain(`after ${DISPLAY_STALE_AFTER_MS / 60_000} minutes a small note says`);
    expect(text).toContain(`come back to it after ${AUTO_REFRESH_AFTER_MS / 60_000} minutes`);
    expect(text).toContain(`a save waits up to ${OFFLINE_WAIT_MS / 1000} seconds for it`);
  });

  const topicOf = (view: HTMLElement, title: string) =>
    Array.from(view.querySelectorAll<HTMLElement>('.help-topic')).find((topic) => topic.querySelector('h3')?.textContent === title) as HTMLElement;

  // Sign out cannot end the volunteer's Google session, which lets the next person on a shared computer back in with one tap.
  it('does not promise that Sign out alone keeps the next person on a shared computer out', () => {
    const text = topicOf(createHelpView(), 'Signing out').textContent ?? '';
    expect(text).not.toContain('so the next person cannot see donor details');
    expect(text).toContain('does not sign you out of Google');
    expect(text).toContain('Guest or private window');
  });

  // Volunteers follow steps in the order written, and full screen hides the window's close button.
  it('starts the projector steps in a Guest or private window and ends them by leaving full screen, signing out and closing it', () => {
    const steps = Array.from(topicOf(createHelpView(), 'Show the fundraiser on the projector').querySelectorAll('.help-steps > li'), (step) => step.textContent ?? '');
    expect(steps[0]).toContain('Guest or private window');
    expect(steps.at(-1)).toMatch(/F11.*Exit.*Sign out.*close the window/);
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

  // The note that records a bounce is a saved change, and a saved change restarts the follow-up clock.
  it('has a bounced check chased at once, since the note recording it keeps the donor off Needs follow-up', () => {
    const text = topicOf(createHelpView(), 'A check bounced or money was given back').textContent ?? '';
    expect(text).not.toContain('in the usual way');
    expect(text).toContain(`saving the note takes them off Needs follow-up for ${FOLLOW_UP_AFTER_DAYS} days`);
    expect(text).toContain('call them now');

    const pledged = pledge({ phone: '555-010-0101', name: 'Aisha Rahman', amountPledged: 1000, datePledged: '2026-07-01', updatedAt: '2026-07-01T12:00:00.000Z' });
    const noted = { ...pledged, notes: 'Check #1042 for $500 dated 2026-08-01 bounced 2026-09-23', updatedAt: new Date(2026, 8, 23, 12, 0).toISOString() };
    const afterBounce = (donor: typeof pledged, today: string) => needsFollowUp(compute([donor], [], SETTINGS, today).pledges[0], today);
    expect(afterBounce(pledged, TODAY)).toBe(true);
    expect(afterBounce(noted, TODAY)).toBe(false);
    expect(afterBounce(noted, '2026-10-24')).toBe(true);
  });

  it('gives money with no donor a How-to topic, pointed at from the not-in-Pledges warning', () => {
    const view = createHelpView();
    const howTo = Array.from(view.querySelectorAll('#help-how-to .help-topic')).find((topic) => topic.querySelector('h3')?.textContent === NO_PHONE_MONEY_TOPIC);
    expect(howTo?.textContent).toContain(`${GENERAL_DONATIONS.phone} as the phone number and ${GENERAL_DONATIONS.name} as the donor name`);
    const warning = Array.from(view.querySelectorAll('#help-warnings dt')).find((term) => term.textContent === WARN_NOT_IN_PLEDGES);
    expect(warning?.nextElementSibling?.textContent).toContain(`${NO_PHONE_MONEY_TOPIC} in How to…`);
    const overpaid = Array.from(view.querySelectorAll('#help-how-to .help-topic')).find((topic) => topic.querySelector('h3')?.textContent === 'Handle a donor who paid more than they pledged');
    expect(overpaid?.textContent).toContain(`${NO_PHONE_MONEY_TOPIC} in How to…`);
  });

  it('warns about the side effects the General donations pledge really has', () => {
    const howTo = Array.from(createHelpView().querySelectorAll('#help-how-to .help-topic')).find((topic) => topic.querySelector('h3')?.textContent === NO_PHONE_MONEY_TOPIC);
    for (const effect of [STATUS.overpaid, 'Overpaid / credit', HEALTH_LABELS.possibleDuplicatePayments, 'is already logged.', 'Unmatched payments stays at $0.00', 'Needs follow-up']) expect(howTo?.textContent).toContain(effect);

    // Saved today, as the How-to has it saved: a save is activity, so the empty pledge waits the full stretch.
    const general = pledge({ id: 'general', phone: GENERAL_DONATIONS.phone, name: GENERAL_DONATIONS.name, amountPledged: 0, updatedAt: new Date(2026, 8, 23, 12).toISOString() });
    const aisha = pledge({ phone: '555-010-0101', name: 'Aisha Rahman', amountPledged: 1000, datePledged: '2026-09-01' });
    const daysAfterToday = (days: number) => todayIso(new Date(2026, 8, 23 + days));
    const withNoGift = compute([general], [], SETTINGS, TODAY).pledges[0];
    expect(howTo?.textContent).toContain(`${FOLLOW_UP_AFTER_DAYS} days after you save it, it shows under Needs follow-up`);
    expect(needsFollowUp(withNoGift, daysAfterToday(FOLLOW_UP_AFTER_DAYS))).toBe(false);
    expect(needsFollowUp(withNoGift, daysAfterToday(FOLLOW_UP_AFTER_DAYS + 1))).toBe(true);
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

  it('has an online gift logged at what the donor gave, so the website’s fee never becomes their balance', () => {
    const view = createHelpView();
    expect(topicOf(view, 'Log a payment').textContent).toContain('type the amount the donor gave, as shown on their receipt');
    expect(topicOf(view, 'Handle a donor who paid more than they pledged').textContent).toContain('for example, their employer matched the gift');
    expect(topicOf(view, 'Payment methods, the goal and the drive’s name').textContent).toContain('by the amount of its fees');

    const donor = pledge({ phone: '555-010-0101', name: 'Aisha Rahman', amountPledged: 100, datePledged: '2026-08-01' });
    const loggedAt = (amountReceived: number) =>
      compute([donor], [payment({ phone: '555-010-0101', amountReceived, dateReceived: '2026-08-01', method: 'Online' })], SETTINGS, TODAY).pledges[0];
    expect(loggedAt(96.8)).toMatchObject({ status: STATUS.partial, balanceCents: 320 });
    expect(needsFollowUp(loggedAt(96.8), TODAY)).toBe(true);
    expect(loggedAt(100)).toMatchObject({ status: STATUS.paid, balanceCents: 0 });
  });

  // Pasted rows only count once the menu item has checked them and given them ids.
  it('walks the organiser through bringing in an outside list with the Sheet menu item that checks it', () => {
    const view = createHelpView();
    const bringIn = topicOf(view, 'Bring in a list kept outside the tracker').textContent ?? '';
    for (const step of ['File → Make a copy', 'Edit → Paste special → Values only', 'Leave column A (id) empty', 'paste again from column B', 'Fundraiser tracker → Add selected rows to the tracker…', 'right-click and choose Delete rows']) expect(bringIn).toContain(step);
    expect(topicOf(view, 'Keeping the sheet healthy').textContent).toContain('See Bring in a list kept outside the tracker');
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
