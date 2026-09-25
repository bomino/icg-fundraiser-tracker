import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from '../web/src/api';

const URL = 'https://script.google.com/macros/s/abc/exec';
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const loadOk = () => json({ ok: true, data: { pledges: [], payments: [], settings: { goal: 1, paymentMethods: [] }, me: 'a@b.c' } });
const draft = { phone: '1', name: 'A', datePledged: '', amountPledged: 5, notes: '' };
const OFFLINE_MESSAGE = 'Could not reach the tracker. Check your connection and try again.';

describe('createApi', () => {
  it('posts text/plain JSON so the browser skips the CORS preflight', async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true, data: { pledges: [], payments: [], settings: { goal: 1, paymentMethods: [] }, me: 'a@b.c' } }));
    const api = createApi(URL, async () => 'tok', fetchImpl);
    await api.load();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' });
    expect(JSON.parse(String(init.body))).toEqual({ idToken: 'tok', op: 'load', payload: {} });
  });

  it('sends no credentials, so it reuses the connections index.html opens to Apps Script during sign-in', async () => {
    const fetchImpl = vi.fn(async () => loadOk());
    await createApi(URL, async () => 'tok', fetchImpl).load();
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(['omit', 'same-origin']).toContain(init.credentials ?? 'same-origin');
    const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');
    for (const host of ['script.google.com', 'script.googleusercontent.com']) {
      expect(html).toContain(`<link rel="preconnect" href="https://${host}" crossorigin />`);
    }
  });

  it('sends id and version when editing, and only the client-chosen id when adding', async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true, data: {} }));
    const api = createApi(URL, async () => 'tok', fetchImpl);
    await api.savePledge(draft, { id: 'new-id' });
    await api.savePledge(draft, { id: 'p1', updatedAt: 'v1' });
    await api.savePayment({ phone: '1', dateReceived: '', amountReceived: 5, method: '', notes: '' }, { id: 'new-pay' });
    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect(bodies[0].payload).toEqual({ ...draft, id: 'new-id' });
    expect(bodies[0].payload).not.toHaveProperty('updatedAt');
    expect(bodies[1].payload).toEqual({ ...draft, id: 'p1', updatedAt: 'v1' });
    expect(bodies[2].payload).toEqual({ phone: '1', dateReceived: '', amountReceived: 5, method: '', notes: '', id: 'new-pay' });
  });

  it('turns an error body into an ApiError with its details', async () => {
    const api = createApi(URL, async () => 'tok', async () => json({ ok: false, error: { code: 'CONFLICT', message: 'changed', current: { id: 'p1' } } }));
    await expect(api.deletePledge({ id: 'p1', updatedAt: 'v0' })).rejects.toMatchObject({ code: 'CONFLICT', message: 'changed', current: { id: 'p1' } });
  });

  it('refreshes an expired token once and retries', async () => {
    const getToken = vi.fn(async (force: boolean) => (force ? 'fresh' : 'stale'));
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      JSON.parse(String(init?.body)).idToken === 'stale'
        ? json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'expired' } })
        : json({ ok: true, data: { goal: 5, paymentMethods: [] } }),
    );
    const api = createApi(URL, getToken, fetchImpl);
    await expect(api.setGoal(5)).resolves.toEqual({ goal: 5, paymentMethods: [] });
    expect(getToken.mock.calls).toEqual([[false], [true]]);
  });

  it('does not reopen sign-in when the volunteer dismissed it', async () => {
    const getToken = vi.fn(async () => {
      throw new ApiError('UNAUTHENTICATED', 'Sign-in was cancelled.');
    });
    const fetchImpl = vi.fn(async () => json({ ok: true, data: {} }));
    const api = createApi(URL, getToken, fetchImpl);
    await expect(api.load()).rejects.toMatchObject({ code: 'UNAUTHENTICATED', message: 'Sign-in was cancelled.' });
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  describe('when fetch itself fails', () => {
    const sleep = vi.fn(async (_ms: number) => {});
    beforeEach(() => {
      sleep.mockClear();
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });
    const failing = () => createApi(URL, async () => 'tok', async () => { throw new TypeError('Failed to fetch'); }, sleep);

    it('blames the connection when the device is offline', async () => {
      vi.stubGlobal('window', new EventTarget());
      vi.stubGlobal('navigator', { onLine: false });
      await expect(failing().load()).rejects.toMatchObject({ code: 'NETWORK', message: OFFLINE_MESSAGE });
    });

    it('also points at the deployment access setting when the device is online, after only the short pauses', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      await expect(failing().load()).rejects.toMatchObject({
        code: 'NETWORK',
        message: `${OFFLINE_MESSAGE} If this keeps happening, the Apps Script deployment may not allow access to "Anyone".`,
      });
      expect(sleep.mock.calls).toEqual([[600], [1500]]);
    });
  });

  describe('waiting for a dropped connection to come back', () => {
    let events: EventTarget;
    beforeEach(() => {
      events = new EventTarget();
      vi.stubGlobal('window', events);
      vi.stubGlobal('navigator', { onLine: false });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });
    // Saves that fail while offline must not pile up listeners, whichever way their wait ended.
    const watchListeners = () => {
      const added = vi.spyOn(events, 'addEventListener');
      const removed = vi.spyOn(events, 'removeEventListener');
      return () => {
        expect(added.mock.calls.map(([type]) => type)).toEqual(['online']);
        expect(removed.mock.calls).toEqual(added.mock.calls);
      };
    };

    it('holds the next try until the device is back online', async () => {
      const expectListenerRemoved = watchListeners();
      const sleep = vi.fn((_ms: number) => new Promise<void>(() => {}));
      let calls = 0;
      const fetchImpl = vi.fn(async () => {
        calls++;
        if (calls === 1) throw new TypeError('Failed to fetch');
        return loadOk();
      });
      const loaded = createApi(URL, async () => 'tok', fetchImpl, sleep).load();
      await vi.waitFor(() => expect(sleep).toHaveBeenCalledWith(20_000));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      vi.stubGlobal('navigator', { onLine: true });
      events.dispatchEvent(new Event('online'));
      await expect(loaded).resolves.toMatchObject({ me: 'a@b.c' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expectListenerRemoved();
    });

    it('gives up once the connection has stayed away for 20 seconds', async () => {
      const expectListenerRemoved = watchListeners();
      const sleep = vi.fn(async (_ms: number) => {});
      const fetchImpl = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      await expect(createApi(URL, async () => 'tok', fetchImpl, sleep).load()).rejects.toMatchObject({ code: 'NETWORK', message: OFFLINE_MESSAGE });
      expect(sleep.mock.calls).toEqual([[20_000]]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expectListenerRemoved();
    });
  });

  it('explains an HTML answer, which means the deployment is misconfigured', async () => {
    const api = createApi(URL, async () => 'tok', async () => new Response('<html>Sign in</html>', { status: 200 }));
    const error = await api.load().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'INTERNAL' });
    expect((error as ApiError).message).toContain('Anyone');
  });

  describe("retrying Google's transient echo failures", () => {
    it('retries a 404 once and returns the eventual success', async () => {
      const sleep = vi.fn(async () => {});
      const responses = [new Response('', { status: 404 }), loadOk()];
      const fetchImpl = vi.fn(async () => responses.shift() as Response);
      const api = createApi(URL, async () => 'tok', fetchImpl, sleep);
      await expect(api.load()).resolves.toMatchObject({ me: 'a@b.c' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(sleep.mock.calls).toEqual([[600]]);
    });

    it('retries 502, 503 and 504 the same way', async () => {
      for (const status of [502, 503, 504]) {
        const sleep = vi.fn(async () => {});
        const responses = [new Response('', { status }), loadOk()];
        const fetchImpl = vi.fn(async () => responses.shift() as Response);
        const api = createApi(URL, async () => 'tok', fetchImpl, sleep);
        await expect(api.load()).resolves.toMatchObject({ me: 'a@b.c' });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
      }
    });

    it('surfaces the error after exhausting retries on repeated 404s', async () => {
      const sleep = vi.fn(async () => {});
      const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
      const api = createApi(URL, async () => 'tok', fetchImpl, sleep);
      await expect(api.load()).rejects.toMatchObject({ code: 'NETWORK', message: 'The tracker answered with an error (404). Try again.' });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls).toEqual([[600], [1500]]);
    });

    it('retries a network rejection and returns the eventual success', async () => {
      const sleep = vi.fn(async () => {});
      let calls = 0;
      const fetchImpl = vi.fn(async () => {
        calls++;
        if (calls === 1) throw new TypeError('Failed to fetch');
        return loadOk();
      });
      const api = createApi(URL, async () => 'tok', fetchImpl, sleep);
      await expect(api.load()).resolves.toMatchObject({ me: 'a@b.c' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(sleep.mock.calls).toEqual([[600]]);
    });

    it('does not retry a plain 500', async () => {
      const sleep = vi.fn(async () => {});
      const fetchImpl = vi.fn(async () => new Response('', { status: 500 }));
      const api = createApi(URL, async () => 'tok', fetchImpl, sleep);
      await expect(api.load()).rejects.toMatchObject({ code: 'NETWORK', message: 'The tracker answered with an error (500). Try again.' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it('still refreshes an expired token once when no transient error is involved', async () => {
      const getToken = vi.fn(async (force: boolean) => (force ? 'fresh' : 'stale'));
      const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        JSON.parse(String(init?.body)).idToken === 'stale'
          ? json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'expired' } })
          : json({ ok: true, data: { goal: 5, paymentMethods: [] } }),
      );
      const api = createApi(URL, getToken, fetchImpl, vi.fn(async () => {}));
      await expect(api.setGoal(5)).resolves.toEqual({ goal: 5, paymentMethods: [] });
      expect(getToken.mock.calls).toEqual([[false], [true]]);
    });
  });

  describe('retrying a BUSY answer, which means nothing was written', () => {
    const busy = () => json({ ok: false, error: { code: 'BUSY', message: 'The tracker is busy. Try again in a moment.' } });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('tries again after a pause of 1 to 3 seconds and returns the eventual success', async () => {
      const sleep = vi.fn(async (_ms: number) => {});
      const responses = [busy(), loadOk()];
      const fetchImpl = vi.fn(async () => responses.shift() as Response);
      await expect(createApi(URL, async () => 'tok', fetchImpl, sleep).load()).resolves.toMatchObject({ me: 'a@b.c' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(1000);
      expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(3000);
    });

    it('varies each pause so volunteers who collided do not collide again, and gives up after two more tries', async () => {
      vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5);
      const sleep = vi.fn(async (_ms: number) => {});
      const fetchImpl = vi.fn(async () => busy());
      await expect(createApi(URL, async () => 'tok', fetchImpl, sleep).load()).rejects.toMatchObject({ code: 'BUSY', message: 'The tracker is busy. Try again in a moment.' });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls).toEqual([[1000], [2000]]);
    });

    it('does not retry any other error answer', async () => {
      const sleep = vi.fn(async (_ms: number) => {});
      const fetchImpl = vi.fn(async () => json({ ok: false, error: { code: 'BAD_REQUEST', message: 'bad', field: 'phone' } }));
      await expect(createApi(URL, async () => 'tok', fetchImpl, sleep).savePledge(draft, { id: 'new-id' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });
  });

  describe('giving up on a stalled request', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });
    const aborted = () => new DOMException('This operation was aborted', 'AbortError');
    // Real fetch rejects, and a real body read errors, when the request's signal aborts.
    const stalled = (_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(aborted())));
    const stalledBody = async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Response(new ReadableStream({ start: (stream) => init?.signal?.addEventListener('abort', () => stream.error(aborted())) }), { status: 200 });
    const noPause = async () => {};

    it('abandons an attempt after 45 seconds and tries once more', async () => {
      const fetchImpl = vi.fn(stalled).mockImplementationOnce(stalled).mockImplementationOnce(async () => loadOk());
      const loaded = createApi(URL, async () => 'tok', fetchImpl, noPause).load();
      await vi.advanceTimersByTimeAsync(44_999);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(loaded).resolves.toMatchObject({ me: 'a@b.c' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('reports a request that stalls twice as a lost connection, not as a deployment problem', async () => {
      vi.stubGlobal('navigator', { onLine: true });
      const fetchImpl = vi.fn(stalled);
      const failed = createApi(URL, async () => 'tok', fetchImpl, noPause).load().catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(90_000);
      expect(await failed).toMatchObject({ code: 'NETWORK', message: OFFLINE_MESSAGE });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('keeps the clock running while the answer is read, and does not mistake a stalled answer for an unexpected page', async () => {
      const fetchImpl = vi.fn(stalledBody);
      const failed = createApi(URL, async () => 'tok', fetchImpl, noPause).load().catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(90_000);
      expect(await failed).toMatchObject({ code: 'NETWORK', message: OFFLINE_MESSAGE });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });

  describe('recovering an update whose response Google lost', () => {
    const pledgeDraft = { phone: '1', name: 'A', datePledged: '', amountPledged: 5, notes: '' };
    const currentPledge = { id: 'p1', phone: '1', name: 'A', datePledged: '', amountPledged: 5, notes: '', updatedAt: 'v2', updatedBy: 'x@y.z' };
    const paymentDraft = { phone: '1', dateReceived: '', amountReceived: 5, method: '', notes: '' };
    const currentPayment = { id: 'pay1', phone: '1', dateReceived: '', amountReceived: 5, method: '', notes: '', updatedAt: 'v2', updatedBy: 'x@y.z' };
    const conflictOn = (current: unknown) => async () => json({ ok: false, error: { code: 'CONFLICT', message: 'changed', current } });

    it('treats a CONFLICT as success when the saved pledge already matches the draft', async () => {
      const api = createApi(URL, async () => 'tok', conflictOn(currentPledge));
      await expect(api.savePledge(pledgeDraft, { id: 'p1', updatedAt: 'v1' })).resolves.toEqual(currentPledge);
    });

    it('treats a CONFLICT as success when the saved payment already matches the draft', async () => {
      const api = createApi(URL, async () => 'tok', conflictOn(currentPayment));
      await expect(api.savePayment(paymentDraft, { id: 'pay1', updatedAt: 'v1' })).resolves.toEqual(currentPayment);
    });

    it('rounds amounts to cents when comparing, same as the server', async () => {
      const almostEqual = { ...currentPledge, amountPledged: 5.0000001 };
      const api = createApi(URL, async () => 'tok', conflictOn(almostEqual));
      await expect(api.savePledge(pledgeDraft, { id: 'p1', updatedAt: 'v1' })).resolves.toEqual(almostEqual);
    });

    it('still throws when the saved row differs from the draft', async () => {
      const differing = { ...currentPledge, name: 'Someone Else' };
      const api = createApi(URL, async () => 'tok', conflictOn(differing));
      await expect(api.savePledge(pledgeDraft, { id: 'p1', updatedAt: 'v1' })).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('does not recover a CONFLICT on the create path', async () => {
      const api = createApi(URL, async () => 'tok', conflictOn(currentPledge));
      await expect(api.savePledge(pledgeDraft, { id: 'new-id' })).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });
});
