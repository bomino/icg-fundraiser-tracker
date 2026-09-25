import '@fontsource-variable/inter';
import '@fontsource/cormorant-garamond/500.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { ApiError, createApi, type Api } from './api';
import { createAuth, isSignedOutUrl, signInAgainUrl, signedOutUrl, type Auth } from './auth';
import { todayIso } from './dates';
import { createStore } from './store';
import { mountApp } from './ui/app';
import { messageOf } from './ui/errors';
import { renderLoading, renderMessageScreen, renderSignedOut } from './ui/screens';

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} is missing from index.html`);
  return element;
}

async function boot(root: HTMLElement, api: Api, auth: Auth) {
  const store = createStore(api, () => todayIso());
  const stopLoading = renderLoading(root);
  try {
    await store.load();
    mountApp(root, { store, auth });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'FORBIDDEN') {
      renderMessageScreen(root, {
        title: 'Not on the volunteer list',
        body: `${err.message} Ask the organiser to add your Google account, or sign in with a different one.`,
        action: { label: 'Use a different account', run: () => auth.signOut({ switchAccount: true }) },
      });
      return;
    }
    // A reload, not boot() again in place: the fix for a wrong script address or sign-in ID is a new
    // build of the site, which this page, built with the old ones, would never run. The tab keeps its
    // sign-in across the reload (auth.ts), so it costs no extra tap.
    renderMessageScreen(root, { title: 'Could not load the tracker', body: messageOf(err), action: { label: 'Try again', run: () => window.location.reload() } });
  } finally {
    stopLoading();
  }
}

async function startDemo(root: HTMLElement) {
  // Dynamic import inside a DEV-only branch lets the bundler drop demo.ts from production builds.
  const { createDemoApi } = await import('./demo');
  const params = new URLSearchParams(window.location.search);
  // `?demo&big`: the Task 7 performance check's event-scale seed (1,500 pledges / 3,000 payments).
  const big = params.has('big');
  // `?demo&instant`: no simulated server delay, so `npm run perf` times the app's own work.
  const latencyMs = params.has('instant') ? 0 : undefined;
  const auth: Auth = {
    getToken: async () => 'demo-token',
    refreshIfStale: () => undefined,
    hasFreshToken: () => true,
    suppressPrompts: () => () => undefined,
    signOut(options) {
      if (options?.switchAccount) window.location.reload();
      else window.location.replace(signedOutUrl(window.location.href));
    },
  };
  await boot(root, createDemoApi(latencyMs, { big }), auth);
}

async function start() {
  const root = requireElement('app');
  if (isSignedOutUrl(window.location.href)) {
    renderSignedOut(root, () => window.location.replace(signInAgainUrl(window.location.href)));
    return;
  }
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')) {
    await startDemo(root);
    return;
  }
  const scriptUrl = import.meta.env.VITE_SCRIPT_URL;
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!scriptUrl || !clientId) {
    renderMessageScreen(root, { title: 'Not set up yet', body: 'This copy of the tracker has no Apps Script URL or Google client ID. Follow docs/SETUP.md, then rebuild.' });
    return;
  }
  const auth = createAuth(clientId, requireElement('auth'));
  await boot(root, createApi(scriptUrl, (force) => auth.getToken(force)), auth);
}

void start();
