import type { Auth } from '../auth';
import type { Store } from '../store';
import { currentTheme, toggleTheme } from '../theme';
import { h } from './dom';
import { mountDisplay } from './displayView';
import { createErrorReporter } from './errors';
import { downloadWorkbook } from './export';
import type { ListFilter } from './filter';
import { createHelpView } from './helpView';
import { createLookupView } from './lookupView';
import { destroyMethodChart, drawMethodChart } from './methodChart';
import { createPaymentsView } from './paymentsView';
import { createPledgesView } from './pledgesView';
import { renderSummary } from './summaryView';

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
const AUTO_REFRESH_AFTER_MS = 2 * 60 * 1000;

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

// DESIGN.md's projector link; rewritten to #display so that Exit, and a reload after it, leave the mode.
function adoptDisplayParam() {
  const url = new URL(location.href);
  if (url.searchParams.get('display') !== 'friday') return;
  url.searchParams.delete('display');
  url.hash = 'display';
  history.replaceState(null, '', url.href);
}

export function mountApp(root: HTMLElement, deps: AppDeps): void {
  let listFilter: { view: ViewName; filter: ListFilter } | null = null;
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
  const reload = async () => {
    refresh.disabled = true;
    refresh.textContent = 'Refreshing…';
    try {
      await deps.store.load();
    } catch (err) {
      reportError(err);
    } finally {
      refresh.disabled = false;
      refresh.textContent = 'Refresh';
    }
  };
  refresh.addEventListener('click', () => {
    if (!refresh.disabled) void reload();
  });
  const signOut = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Sign out');
  signOut.addEventListener('click', () => deps.auth.signOut());
  const me = h('span', { class: 'meta' }, deps.store.state()?.me ?? '');
  const offline = h('div', { class: 'banner banner-warning', role: 'status', hidden: navigator.onLine }, 'You are offline. Changes cannot be saved until the connection is back.');
  window.addEventListener('online', () => { offline.hidden = true; });
  window.addEventListener('offline', () => { offline.hidden = false; });

  // Capture phase runs before the view opens a form, so a nearly expired sign-in is renewed
  // up front instead of interrupting the Save.
  main.addEventListener('click', () => deps.auth.refreshIfStale(), { capture: true });
  document.addEventListener('visibilitychange', () => {
    // The display runs its own non-prompting refresh; refreshIfStale here could open sign-in on the projector.
    if (exitDisplay || document.visibilityState !== 'visible') return;
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

  // Store publishes rebuild the whole view; without this a volunteer typing a search loses the box mid-word.
  function focusedSearch() {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement) || !main.contains(active) || !active.dataset.focusKey) return null;
    return { key: active.dataset.focusKey, start: active.selectionStart, end: active.selectionEnd };
  }

  function restoreFocus(focus: { key: string; start: number | null; end: number | null }) {
    const input = main.querySelector<HTMLInputElement>(`input[data-focus-key="${focus.key}"]`);
    if (!input) return;
    input.focus();
    if (focus.start !== null && focus.end !== null) input.setSelectionRange(focus.start, focus.end);
  }

  function render() {
    const state = deps.store.state();
    if (!state) return;
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
            location.hash = target;
          },
        });
    const focus = focusedSearch();
    main.replaceChildren(content);
    if (focus) restoreFocus(focus);
    rememberView(view);
  }

  window.addEventListener('hashchange', () => {
    render();
    window.scrollTo({ top: 0 });
    // Find donor is opened with someone waiting, so land in its search box. Only on arrival:
    // render() also runs on every store publish, and must not pull focus from wherever the volunteer is.
    if (parseRoute(location.hash) === 'find') main.querySelector<HTMLInputElement>('#lookup-input')?.focus();
  });
  deps.store.subscribe(render);
  adoptDisplayParam();
  if (!location.hash) history.replaceState(null, '', `#${rememberedView()}`);
  render();
}
