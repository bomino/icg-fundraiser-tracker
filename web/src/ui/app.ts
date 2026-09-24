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
