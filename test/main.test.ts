// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS } from './support/factories';

const encode = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((candidate) => candidate.textContent === label);

// main.ts starts the tracker as soon as it is imported, so each test imports a fresh copy.
async function openTracker() {
  vi.resetModules();
  await import('../web/src/main');
}

describe('opening the tracker', () => {
  beforeEach(() => {
    const auth = document.createElement('div');
    auth.id = 'auth';
    auth.hidden = true;
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(auth, app);
    vi.stubEnv('VITE_SCRIPT_URL', 'https://script.example/exec');
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    document.body.replaceChildren();
  });

  it('loads on the sign-in this tab kept, and Try again loads again in place on that same sign-in', async () => {
    const kept = encode({ aud: 'client-id', exp: Math.floor(Date.now() / 1000) + 3600 });
    sessionStorage.setItem('icg-id-token', kept);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong on the server. Try again.' } }))
      .mockResolvedValueOnce(json({ ok: true, data: { pledges: [], payments: [], settings: SETTINGS, me: 'me@example.com' } }));
    vi.stubGlobal('fetch', fetchMock);

    await openTracker();
    await vi.waitFor(() => expect(button('Try again')).toBeDefined());
    button('Try again')?.click();

    await vi.waitFor(() => expect(document.querySelector('nav.tabs')).not.toBeNull());
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).idToken)).toEqual([kept, kept]);
  });

  it('reloads the page on Try again when Google sign-in never arrived, since only a reload fetches it again', async () => {
    vi.useFakeTimers();
    // jsdom cannot navigate, and its own location cannot be spied on.
    const location = { href: 'https://example.org/tracker/', search: '', replace: vi.fn(), reload: vi.fn() };
    vi.stubGlobal('location', location);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>());

    await openTracker();
    await vi.advanceTimersByTimeAsync(16_000);

    expect(document.getElementById('app')?.textContent).toContain('Google sign-in did not load.');
    button('Try again')?.click();
    expect(location.reload).toHaveBeenCalledTimes(1);
  });
});
