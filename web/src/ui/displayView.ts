import type { Auth } from '../auth';
import { formatClock, formatFlooredPercent, formatWholeDollars } from '../format';
import type { State, Store } from '../store';
import { h } from './dom';

export const DISPLAY_REFRESH_MS = 3 * 60 * 1000;
export const DISPLAY_STALE_AFTER_MS = 15 * 60 * 1000;
const STALE_CHECK_MS = 30 * 1000;
const DISPLAY_TITLE = 'Fundraiser';

export interface DisplayDeps {
  store: Store;
  auth: Pick<Auth, 'hasFreshToken' | 'suppressPrompts'>;
  /** The app's ordinary refresh. It may open sign-in, so it only runs when someone taps. */
  reconnect(): Promise<void>;
}

function figures(state: State): HTMLElement[] {
  const { receivedCents, goalCents, goalFraction, donorCount } = state.computed.totals;
  const goal = goalCents !== null && goalCents > 0 ? goalCents : null;
  const progress = goal === null ? 0 : Math.min(Math.max(goalFraction, 0), 1);
  const nodes: Array<HTMLElement | null> = [
    h(
      'div',
      { class: 'progress-track friday-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.floor(progress * 100), 'aria-label': 'Progress toward goal' },
      h('div', { class: 'progress-fill', style: `width: ${progress * 100}%` }),
    ),
    h('p', { class: 'friday-raised' }, h('span', { class: 'gold' }, formatWholeDollars(receivedCents)), goal === null ? ' raised' : ` raised of ${formatWholeDollars(goal)}`),
    goal === null ? null : h('p', { class: 'friday-percent' }, formatFlooredPercent(receivedCents, goal)),
    h('p', { class: 'friday-donors ink-soft' }, donorCount === 1 ? '1 donor has pledged' : `${donorCount} donors have pledged`),
  ];
  return nodes.filter((node): node is HTMLElement => node !== null);
}

/**
 * The projector view for jumu'ah announcements. It refreshes on entry, and again whenever its
 * figures reach DISPLAY_REFRESH_MS old, because the tab may not have reloaded since morning data
 * entry. It does so only while the current sign-in will last the whole load, and holds sign-in
 * prompts back otherwise: ID tokens expire hourly, and a Google dialog popping up mid-announcement
 * is the failure this mode exists to avoid.
 * Returns the teardown, which undoes every timer, listener and hold it set up.
 */
export function mountDisplay(root: HTMLElement, deps: DisplayDeps): () => void {
  let releasePrompts: () => void = () => undefined;
  let loading = false;
  let reconnecting = false;
  let closed = false;
  // A failed load leaves lastLoadedAt behind, so without this the 30-second check would retry an outage every 30 seconds.
  let lastAttemptAt = 0;

  const stack = h('div', { class: 'friday-stack' });
  const updated = h('span', { class: 'friday-updated meta' });
  const staleNote = h('button', { type: 'button', class: 'friday-stale', hidden: true }, 'Figures may be out of date — tap to reconnect');
  const view = h(
    'section',
    { class: 'friday', 'aria-label': 'Fundraiser progress' },
    h('a', { href: '#summary', class: 'friday-exit meta' }, 'Exit'),
    stack,
    h('div', { class: 'friday-status', role: 'status' }, updated, staleNote),
  );

  function showStatus() {
    const loadedAt = deps.store.lastLoadedAt();
    updated.textContent = loadedAt === null ? '' : `Updated ${formatClock(loadedAt)}`;
    staleNote.hidden = loadedAt !== null && Date.now() - loadedAt <= DISPLAY_STALE_AFTER_MS;
  }

  function render(state: State) {
    stack.replaceChildren(
      h('p', { class: 'eyebrow friday-eyebrow' }, 'Islamic Center of Greensboro'),
      h('h1', { class: 'friday-title' }, DISPLAY_TITLE),
      ...figures(state),
    );
    showStatus();
  }

  function tick() {
    if (closed || loading || reconnecting || document.visibilityState !== 'visible' || !deps.auth.hasFreshToken()) return;
    loading = true;
    lastAttemptAt = Date.now();
    deps.store
      .load()
      .catch((err: unknown) => console.warn('The display could not refresh; it keeps the last figures.', err))
      .finally(() => {
        loading = false;
        if (!closed) showStatus();
      });
  }

  async function reconnect() {
    if (reconnecting) return;
    reconnecting = true;
    staleNote.disabled = true;
    releasePrompts();
    try {
      await deps.reconnect();
    } finally {
      reconnecting = false;
      staleNote.disabled = false;
      if (!closed) {
        releasePrompts = deps.auth.suppressPrompts();
        showStatus();
      }
    }
  }

  function refreshIfDue() {
    if (document.visibilityState !== 'visible') return;
    const lastTried = Math.max(deps.store.lastLoadedAt() ?? 0, lastAttemptAt);
    if (Date.now() - lastTried >= DISPLAY_REFRESH_MS) tick();
    showStatus();
  }

  // The first render is the only step that can throw, so it runs before anything that would need undoing.
  const state = deps.store.state();
  if (state) render(state);
  staleNote.addEventListener('click', () => void reconnect());
  const checkTimer = setInterval(refreshIfDue, STALE_CHECK_MS);
  document.addEventListener('visibilitychange', refreshIfDue);
  const unsubscribe = deps.store.subscribe(render);
  document.body.dataset.display = 'friday';
  root.replaceChildren(view);
  releasePrompts = deps.auth.suppressPrompts();
  // Only once prompts are held back: a server that rejects the token makes api.ts ask for a new
  // one, and that must not open sign-in on the projector.
  refreshIfDue();

  return () => {
    closed = true;
    clearInterval(checkTimer);
    document.removeEventListener('visibilitychange', refreshIfDue);
    unsubscribe();
    releasePrompts();
    delete document.body.dataset.display;
  };
}
