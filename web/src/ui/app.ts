import { ApiError } from '../api';
import type { Auth } from '../auth';
import type { Store } from '../store';
import { currentTheme, toggleTheme } from '../theme';
import { confirmDialog } from './dialog';
import { h } from './dom';
import { mountDisplay } from './displayView';
import { createErrorReporter } from './errors';
import { downloadWorkbook } from './export';
import type { ListFilter } from './filter';
import { findFocusSpot, focusSpotOf, type FocusSpot } from './focus';
import { createHelpView } from './helpView';
import { createLookupView } from './lookupView';
import { destroyMethodChart, drawMethodChart } from './methodChart';
import { createPaymentsView } from './paymentsView';
import { createPledgesView } from './pledgesView';
import { renderMessageScreen } from './screens';
import { renderSummary } from './summaryView';
import { mountToasts } from './toast';

export type ViewName = 'summary' | 'pledges' | 'payments' | 'find' | 'help';
/** The Friday display is a route but not a tab: it replaces the whole app shell. */
export type Route = ViewName | 'display';

const VIEWS: ReadonlyArray<{ name: ViewName; label: string }> = [
  { name: 'summary', label: 'Summary' },
  { name: 'pledges', label: 'Pledges' },
  { name: 'payments', label: 'Payments' },
  { name: 'find', label: 'Find donor' },
  { name: 'help', label: 'Help' },
];
const LAST_VIEW_KEY = 'icg-last-view';
export const AUTO_REFRESH_AFTER_MS = 2 * 60 * 1000;

export function parseRoute(hash: string): Route {
  const name = hash.replace(/^#\/?/, '');
  if (name === 'display') return 'display';
  return VIEWS.find((view) => view.name === name)?.name ?? 'summary';
}

function rememberedView(): ViewName {
  try {
    const route = parseRoute(`#${localStorage.getItem(LAST_VIEW_KEY) ?? ''}`);
    return route === 'display' ? 'summary' : route;
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

// tabindex -1 lets the heading take focus without becoming a tab stop.
function focusHeading(container: ParentNode) {
  const heading = container.querySelector<HTMLElement>('h1');
  heading?.setAttribute('tabindex', '-1');
  heading?.focus();
}

// DESIGN.md's projector link; rewritten to #display so that Exit, and a reload after it, leave the mode.
function adoptDisplayParam() {
  const url = new URL(location.href);
  if (url.searchParams.get('display') !== 'friday') return;
  url.searchParams.delete('display');
  url.hash = 'display';
  history.replaceState(null, '', url.href);
}

export function mountApp(root: HTMLElement, deps: AppDeps): void {
  mountToasts();
  let listFilter: { view: ViewName; filter: ListFilter } | null = null;
  // Set by a Summary "Show N", whose button goes with the Summary; a Sections tab keeps its own focus.
  let focusListHeading = false;
  let exitDisplay: (() => void) | null = null;
  let shellShown = false;
  // Chart.js and its theme listener would otherwise only get torn down on Summary's *next* draw,
  // outliving a canvas that navigated away in the meantime (see methodChart.ts's own comment).
  let lastView: ViewName | null = null;
  const reportError = createErrorReporter(() => deps.store.load());
  const pledgesView = createPledgesView({ store: deps.store, reportError });
  const paymentsView = createPaymentsView({ store: deps.store, reportError });
  const lookupView = createLookupView({ store: deps.store, reportError });
  // Built once and reattached, so the sections a volunteer opened survive store re-renders.
  const helpView = createHelpView();

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
  const main = h('main', { class: 'container', id: 'main' });
  const refresh = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Refresh');
  // Set once a refresh finds this account taken off the Allowlist. A failed load keeps every row in
  // memory and Download .xlsx is built from them, so from then on nothing may draw the lists again.
  let removed = false;
  const showRemoved = (err: ApiError) => {
    removed = true;
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((dialog) => dialog.close());
    renderMessageScreen(root, {
      title: 'Not on the volunteer list',
      body: `${err.message} If you still help with the fundraiser, ask the organiser to add your Google account back, then press Try again.`,
      action: { label: 'Try again', run: () => window.location.reload() },
    });
    // The control that had focus went with the old page, and no alert toast says why it changed, so a
    // screen reader hears nothing unless focus lands on the new screen.
    focusHeading(root);
  };
  const reload = async () => {
    refresh.disabled = true;
    refresh.textContent = 'Refreshing…';
    try {
      await deps.store.load();
    } catch (err) {
      // Only a refresh, and never on the projector: a save refused this way keeps its Reopen, so one
      // mistaken Allowlist edit cannot throw away every volunteer's unsaved entry or blank the display.
      if (err instanceof ApiError && err.code === 'FORBIDDEN' && !exitDisplay) showRemoved(err);
      else reportError(err);
    } finally {
      refresh.disabled = false;
      refresh.textContent = 'Refresh';
    }
  };
  refresh.addEventListener('click', () => {
    if (!refresh.disabled) void reload();
  });
  const signOut = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Sign out');
  // Set once the volunteer has chosen to go, so the browser does not ask them a second time.
  let leaving = false;
  const confirmSignOut = async () => {
    if (deps.store.hasUnsettledWrites() && !(await confirmDialog('A change is still saving. Signing out now could lose it. Sign out anyway?', 'Sign out anyway'))) return;
    leaving = true;
    deps.auth.signOut();
  };
  signOut.addEventListener('click', () => void confirmSignOut());
  // Once the page is gone, a failed save can never show its message or Reopen, and a request not yet
  // sent never reaches the sheet. iOS ignores beforeunload, and a tab swiped away or discarded never
  // asks, so this protects closing or reloading a tab on a computer, not a phone.
  window.addEventListener('beforeunload', (event) => {
    if (leaving || !deps.store.hasUnsettledWrites()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  const me = h('span', { class: 'meta' }, deps.store.state()?.me ?? '');
  const offline = h('div', { class: 'banner banner-warning', role: 'status', hidden: navigator.onLine }, 'You are offline. Changes cannot be saved until the connection is back.');
  window.addEventListener('online', () => { offline.hidden = true; });
  window.addEventListener('offline', () => { offline.hidden = false; });

  // Capture phase runs before the view opens a form, so a nearly expired sign-in is renewed
  // up front instead of interrupting the Save.
  main.addEventListener('click', () => deps.auth.refreshIfStale(), { capture: true });
  document.addEventListener('visibilitychange', () => {
    // The display runs its own non-prompting refresh; refreshIfStale here could open sign-in on the projector.
    if (removed || exitDisplay || document.visibilityState !== 'visible') return;
    deps.auth.refreshIfStale();
    const loadedAt = deps.store.lastLoadedAt();
    const stale = loadedAt === null || Date.now() - loadedAt > AUTO_REFRESH_AFTER_MS;
    // A reload under an open form would redraw the list the volunteer is editing from.
    if (stale && !refresh.disabled && !document.querySelector('dialog[open]')) void reload();
  });
  const shell = [
    h('header', { class: 'nav-bar' }, h('div', { class: 'nav-inner' }, h('a', { href: '#summary', class: 'wordmark' }, 'ICG Fundraiser Tracker'), nav, h('div', { class: 'nav-actions' }, me, refresh, themeButton, signOut))),
    offline,
    main,
  ];

  // Store publishes rebuild the whole view; without this a volunteer loses their place each time a save
  // lands: a search box mid-word, or the row or button they had tabbed to.
  function focusedSpot() {
    const active = document.activeElement;
    const spot = active && main.contains(active) ? focusSpotOf(active) : null;
    if (!spot) return null;
    const input = active instanceof HTMLInputElement ? active : null;
    return { spot, start: input?.selectionStart ?? null, end: input?.selectionEnd ?? null };
  }

  function restoreFocus(focus: { spot: FocusSpot; start: number | null; end: number | null }) {
    const target = findFocusSpot(focus.spot, main);
    if (!target) return;
    // Its old copy had focus right there a moment ago; taking focus back must not scroll the page.
    target.focus({ preventScroll: true });
    if (target instanceof HTMLInputElement && focus.start !== null && focus.end !== null) target.setSelectionRange(focus.start, focus.end);
  }

  function render() {
    const state = deps.store.state();
    if (!state || removed) return;
    const view = parseRoute(location.hash);
    if (view === 'display') {
      if (lastView === 'summary') destroyMethodChart();
      lastView = null;
      exitDisplay ??= mountDisplay(root, { store: deps.store, auth: deps.auth, reconnect: reload });
      shellShown = false;
      return;
    }
    if (lastView === 'summary' && view !== 'summary') destroyMethodChart();
    lastView = view;
    if (!shellShown) {
      exitDisplay?.();
      exitDisplay = null;
      root.replaceChildren(...shell);
      shellShown = true;
    }
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
      : view === 'help' ? helpView
      : renderSummary(state, {
          store: deps.store,
          reportError,
          exportWorkbook: downloadWorkbook,
          drawChart: drawMethodChart,
          showList: (target, targetFilter) => {
            listFilter = { view: target, filter: targetFilter };
            focusListHeading = true;
            location.hash = target;
          },
        });
    const focus = focusedSpot();
    main.replaceChildren(content);
    if (focus) restoreFocus(focus);
    rememberView(view);
  }

  window.addEventListener('hashchange', () => {
    render();
    window.scrollTo({ top: 0 });
    if (!focusListHeading) return;
    focusListHeading = false;
    focusHeading(main);
  });
  deps.store.subscribe(render);
  adoptDisplayParam();
  if (!location.hash) history.replaceState(null, '', `#${rememberedView()}`);
  render();
}
