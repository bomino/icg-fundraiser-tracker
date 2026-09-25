import { ApiError } from '../api';
import type { Auth } from '../auth';
import type { Store } from '../store';
import { currentTheme, toggleTheme } from '../theme';
import { behindHalf } from '../version';
import { confirmDialog } from './dialog';
import { h } from './dom';
import { mountDisplay } from './displayView';
import { createErrorReporter } from './errors';
import { downloadWorkbook } from './export';
import type { ListFilter } from './filter';
import { findFocusSpot, focusableHeading, focusSpotOf, type FocusSpot } from './focus';
import { createHelpView } from './helpView';
import { createLookupView } from './lookupView';
import { createPaymentsView } from './paymentsView';
import { createPledgesView } from './pledgesView';
import { renderMessageScreen } from './screens';
import { renderSummary } from './summaryView';
import { hasActionToast, mountToasts } from './toast';

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
// Only the organiser can fix the first; the second is a tab still running code from before a deploy.
const OUT_OF_DATE = {
  server: "The tracker's server is out of date. Organiser: redeploy Code.gs as a new version (see setup guide).",
  site: 'The tracker was updated. Reload this page to get the latest version.',
} as const;

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

function focusHeading(container: ParentNode) {
  focusableHeading(container)?.focus();
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
  // Set by a Summary "Show", whose button goes with the Summary; a Sections tab keeps its own focus.
  let focusListHeading = false;
  let exitDisplay: (() => void) | null = null;
  let shellShown = false;
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
  // Named for the mode it switches to, so it carries no aria-pressed: in dark mode that would
  // announce "Light mode, pressed", reporting the opposite of the truth.
  const themeButton = h('button', { type: 'button', class: 'btn btn-ghost' }, currentTheme() === 'dark' ? 'Light mode' : 'Dark mode');
  themeButton.addEventListener('click', () => {
    themeButton.textContent = toggleTheme() === 'dark' ? 'Light mode' : 'Dark mode';
  });
  const main = h('main', { class: 'container', id: 'main' });
  const refresh = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Refresh');
  // Set once a refresh finds this account taken off the Allowlist. A failed load keeps every row in
  // memory, so from then on nothing may draw the lists again.
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
  // Shared while it runs, so a Download pressed mid-Refresh waits for that load instead of starting another.
  let loading: Promise<void> | null = null;
  const load = () =>
    (loading ??= (async () => {
      refresh.disabled = true;
      refresh.textContent = 'Refreshing…';
      try {
        await deps.store.load();
      } finally {
        refresh.disabled = false;
        refresh.textContent = 'Refresh';
        loading = null;
      }
    })());
  // Only a refresh (Refresh's, the return-to-tab one or Download's), and never on the projector: a save
  // refused this way keeps its Reopen, so one mistaken Allowlist edit cannot throw away every
  // volunteer's unsaved entry or blank the display.
  const takenOffAllowlist = (err: unknown): err is ApiError => err instanceof ApiError && err.code === 'FORBIDDEN' && !exitDisplay;
  const reload = async () => {
    try {
      await load();
    } catch (err) {
      if (takenOffAllowlist(err)) showRemoved(err);
      else reportError(err);
    }
  };
  // Refreshed first: a laptop kept on the collection table all evening never leaves the tab, so it
  // never reloads on its own, and its copy would lack every other volunteer's entries. A failed
  // refresh rejects, so no out-of-date file is made. Built from the store afterwards, not from the
  // state the Summary was drawn with, which the refresh has just replaced. The refresh's redraw keeps
  // keyboard focus on Download through render()'s own restore, by its data-focus-key.
  let exporting = false;
  const exportWorkbook = async () => {
    if (exporting) return;
    exporting = true;
    try {
      await load();
      const state = deps.store.state();
      if (state) await downloadWorkbook(state, deps.store.lastLoadedAt());
    } catch (err) {
      if (!takenOffAllowlist(err)) throw err;
      showRemoved(err);
    } finally {
      exporting = false;
    }
  };
  refresh.addEventListener('click', () => {
    if (!refresh.disabled) void reload();
  });
  const signOut = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Sign out');
  // Set once the volunteer has chosen to go, so the browser does not ask them a second time.
  let leaving = false;
  // A failed save's Reopen toast holds the only copy of what was typed, once the store has rolled the
  // change back, so leaving loses it just as surely as leaving mid-save.
  const leaveQuestion = () =>
    deps.store.hasUnsettledWrites() ? 'A change is still saving. Signing out now could lose it. Sign out anyway?'
    : hasActionToast() ? 'A change could not be saved. Signing out now loses it. Sign out anyway?'
    : null;
  const confirmSignOut = async () => {
    const question = leaveQuestion();
    if (question !== null && !(await confirmDialog(question, 'Sign out anyway'))) return;
    leaving = true;
    deps.auth.signOut();
  };
  signOut.addEventListener('click', () => void confirmSignOut());
  // Once the page is gone, a failed save can never show its message or Reopen, and a request not yet
  // sent never reaches the sheet. iOS ignores beforeunload, and a tab swiped away or discarded never
  // asks, so this protects closing or reloading a tab on a computer, not a phone.
  window.addEventListener('beforeunload', (event) => {
    if (leaving || leaveQuestion() === null) return;
    event.preventDefault();
    event.returnValue = '';
  });
  const me = h('span', { class: 'meta' }, deps.store.state()?.me ?? '');
  const offline = h('div', { class: 'banner banner-warning', role: 'status', hidden: navigator.onLine }, 'You are offline. Changes cannot be saved until the connection is back.');
  window.addEventListener('online', () => { offline.hidden = true; });
  window.addEventListener('offline', () => { offline.hidden = false; });
  // Only warns: most version gaps are harmless validation changes, which blocking saves would turn into lost work.
  const outOfDate = h('div', { class: 'banner banner-warning', role: 'status', 'data-role': 'version', hidden: true });

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
    outOfDate,
    main,
  ];

  // Every publish carries the version from the latest load. The text is only rewritten when it changes,
  // so a save's publish does not make a screen reader announce the banner again.
  function showOutOfDate(apiVersion: number | undefined) {
    const behind = behindHalf(apiVersion);
    const text = behind ? OUT_OF_DATE[behind] : '';
    if (outOfDate.textContent !== text) outOfDate.textContent = text;
    outOfDate.hidden = behind === null;
  }

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
    showOutOfDate(state.apiVersion);
    const view = parseRoute(location.hash);
    if (view === 'display') {
      exitDisplay ??= mountDisplay(root, { store: deps.store, auth: deps.auth, reconnect: reload });
      shellShown = false;
      return;
    }
    if (!shellShown) {
      exitDisplay?.();
      exitDisplay = null;
      root.replaceChildren(...shell);
      shellShown = true;
    }
    tabs.forEach((tab, name) => (name === view ? tab.setAttribute('aria-current', 'page') : tab.removeAttribute('aria-current')));
    main.classList.toggle('container-wide', view === 'pledges' || view === 'payments');
    // The same object on every render until the next Show: the lists treat a new object as a new drill-down and
    // clear their search, so rebuilding it here would wipe a search on every store publish.
    const filter = listFilter && listFilter.view === view ? listFilter.filter : null;
    const clearFilter = () => {
      const chipHadFocus = document.activeElement instanceof HTMLElement && document.activeElement.dataset.focusKey === 'list-filter';
      listFilter = null;
      render();
      // The chip goes with its filter. The heading is where Show left focus, and names the list now shown in full.
      if (chipHadFocus) focusHeading(main);
    };
    const content =
      view === 'pledges' ? pledgesView(state, filter, clearFilter)
      : view === 'payments' ? paymentsView(state, filter, clearFilter)
      : view === 'find' ? lookupView(state)
      : view === 'help' ? helpView
      : renderSummary(state, {
          store: deps.store,
          reportError,
          exportWorkbook,
          showList: (target, targetFilter) => {
            listFilter = { view: target, filter: targetFilter };
            focusListHeading = true;
            location.hash = target;
          },
        });
    // Help is built once, so a publish hands back the very element on screen; putting it back would
    // only drop the focus of whichever section heading or Contents link had it.
    if (main.firstElementChild !== content) {
      const focus = focusedSpot();
      main.replaceChildren(content);
      if (focus) restoreFocus(focus);
    }
    rememberView(view);
  }

  window.addEventListener('hashchange', () => {
    render();
    window.scrollTo({ top: 0 });
    if (focusListHeading) {
      focusListHeading = false;
      focusHeading(main);
    } else if (parseRoute(location.hash) === 'find') {
      // Find donor is opened with someone waiting, so land in its search box. Only on arrival:
      // render() also runs on every store publish, and must not pull focus from wherever the volunteer is.
      main.querySelector<HTMLInputElement>('#lookup-input')?.focus();
    }
  });
  deps.store.subscribe(render);
  adoptDisplayParam();
  if (!location.hash) history.replaceState(null, '', `#${rememberedView()}`);
  render();
}
