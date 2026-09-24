/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../web/src/api';
import { createAuth, decodeJwtPayload, isFresh } from '../web/src/auth';

const encode = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

interface CredentialResponse {
  credential: string;
}

function stubGoogleAccounts() {
  let callback: ((response: CredentialResponse) => void) | undefined;
  const prompt = vi.fn();
  const renderButton = vi.fn((parent: HTMLElement) => {
    parent.appendChild(document.createElement('div'));
  });
  vi.stubGlobal('google', {
    accounts: {
      id: {
        initialize: vi.fn((config: { callback: (response: CredentialResponse) => void }) => {
          callback = config.callback;
        }),
        renderButton,
        prompt,
        disableAutoSelect: vi.fn(),
      },
    },
  });
  return { renderButton, prompt, emitCredential: (credential: string) => callback?.({ credential }) };
}

describe('decodeJwtPayload', () => {
  it('decodes base64url with UTF-8 characters', () => {
    expect(decodeJwtPayload(encode({ email: 'a@b.c', name: 'Zübeyde', exp: 100 }))).toEqual({ email: 'a@b.c', name: 'Zübeyde', exp: 100 });
  });
  it('rejects a malformed token', () => {
    expect(() => decodeJwtPayload('nope')).toThrow('Malformed');
  });
});

describe('isFresh', () => {
  it('treats a token as stale within a minute of expiry', () => {
    const token = encode({ exp: 1000 });
    expect(isFresh(token, 900)).toBe(true);
    expect(isFresh(token, 941)).toBe(false);
    expect(isFresh(null, 0)).toBe(false);
  });
  it('accepts a wider margin for early refreshes', () => {
    const token = encode({ exp: 1000 });
    expect(isFresh(token, 600, 300)).toBe(true);
    expect(isFresh(token, 701, 300)).toBe(false);
  });
});

describe('createAuth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears the sign-in button before re-rendering it on a token refresh', async () => {
    const { renderButton, emitCredential } = stubGoogleAccounts();
    const host = document.createElement('div');
    const auth = createAuth('client-id', host);

    const firstToken = auth.getToken(false);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    emitCredential(encode({ exp: Math.floor(Date.now() / 1000) + 3600 }));
    await firstToken;

    void auth.getToken(true);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(2));

    const buttonSlot = host.querySelector<HTMLElement>('.signin-button');
    expect(buttonSlot?.children.length).toBe(1);
  });

  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const signInDialog = (host: HTMLElement) => host.querySelector('dialog') as HTMLDialogElement;

  it('shows the sign-in panel in its own modal dialog so it stacks above an open form', async () => {
    const { renderButton } = stubGoogleAccounts();
    const host = document.createElement('div');
    document.body.append(host);
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const auth = createAuth('client-id', host);

    void auth.getToken(false);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));

    const dialog = signInDialog(host);
    expect(dialog).not.toBeNull();
    expect(dialog.open).toBe(true);
    expect(showModal.mock.contexts).toContain(dialog);
    expect(dialog.querySelector('.signin-button')).not.toBeNull();
    showModal.mockRestore();
    host.remove();
  });

  it('resolves every waiting caller with the credential and closes the dialog', async () => {
    const { renderButton, emitCredential } = stubGoogleAccounts();
    const host = document.createElement('div');
    document.body.append(host);
    const auth = createAuth('client-id', host);

    const first = auth.getToken(false);
    const second = auth.getToken(true);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    const credential = encode({ exp: nowSeconds() + 3600 });
    emitCredential(credential);

    await expect(first).resolves.toBe(credential);
    await expect(second).resolves.toBe(credential);
    expect(signInDialog(host).open).toBe(false);
    host.remove();
  });

  it('rejects waiting callers when the sign-in dialog is dismissed, so a pending save can re-enable', async () => {
    const { renderButton } = stubGoogleAccounts();
    const host = document.createElement('div');
    document.body.append(host);
    const auth = createAuth('client-id', host);

    const first = auth.getToken(false);
    const second = auth.getToken(false);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    const dialog = signInDialog(host);
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    dialog.close();

    for (const pending of [first, second]) {
      const error = await pending.catch((err: unknown) => err);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'UNAUTHENTICATED', message: 'Sign-in was cancelled.' });
    }
    host.remove();
  });

  it('refreshIfStale asks for a new token only when the current one is close to expiry', async () => {
    const { renderButton, emitCredential } = stubGoogleAccounts();
    const host = document.createElement('div');
    document.body.append(host);
    const auth = createAuth('client-id', host);

    auth.refreshIfStale();
    expect(renderButton).not.toHaveBeenCalled();

    const first = auth.getToken(false);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    emitCredential(encode({ exp: nowSeconds() + 3600 }));
    await first;
    auth.refreshIfStale();
    await Promise.resolve();
    expect(renderButton).toHaveBeenCalledTimes(1);

    const second = auth.getToken(true);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(2));
    emitCredential(encode({ exp: nowSeconds() + 240 }));
    await second;
    auth.refreshIfStale();
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(3));
    expect(signInDialog(host).open).toBe(true);
    host.remove();
  });

  it('has a Cancel button that dismisses the sign-in and rejects waiting callers', async () => {
    const { renderButton } = stubGoogleAccounts();
    const host = document.createElement('div');
    document.body.append(host);
    const auth = createAuth('client-id', host);

    const pending = auth.getToken(false);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    const cancel = Array.from(signInDialog(host).querySelectorAll('button')).find((button) => button.textContent === 'Cancel') as HTMLButtonElement;
    expect(cancel.type).toBe('button');
    cancel.click();

    await expect(pending).rejects.toMatchObject({ code: 'UNAUTHENTICATED', message: 'Sign-in was cancelled.' });
    expect(signInDialog(host).open).toBe(false);
    host.remove();
  });

  it('does not re-prompt from refreshIfStale for a minute after a dismissal, but a save still asks', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { renderButton, emitCredential } = stubGoogleAccounts();
    const host = document.createElement('div');
    document.body.append(host);
    const auth = createAuth('client-id', host);

    const first = auth.getToken(false);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    emitCredential(encode({ exp: nowSeconds() + 240 }));
    await first;

    auth.refreshIfStale();
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(2));
    signInDialog(host).close();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());

    vi.setSystemTime(new Date('2026-09-23T12:00:59Z'));
    auth.refreshIfStale();
    await Promise.resolve();
    await Promise.resolve();
    expect(renderButton).toHaveBeenCalledTimes(2);

    const save = auth.getToken(true);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(3));
    signInDialog(host).close();
    await expect(save).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    vi.setSystemTime(new Date('2026-09-23T12:02:01Z'));
    auth.refreshIfStale();
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(4));

    warn.mockRestore();
    vi.useRealTimers();
    host.remove();
  });

  it('hasFreshToken reports a token only while it will outlast a load, without ever prompting', async () => {
    const { renderButton, emitCredential } = stubGoogleAccounts();
    const host = document.createElement('div');
    document.body.append(host);
    const auth = createAuth('client-id', host);
    expect(auth.hasFreshToken()).toBe(false);

    const first = auth.getToken(false);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    emitCredential(encode({ exp: nowSeconds() + 3600 }));
    await first;
    expect(auth.hasFreshToken()).toBe(true);

    // Fresh enough for getToken's own margin, but not for a display refresh that is about to call it.
    const second = auth.getToken(true);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(2));
    emitCredential(encode({ exp: nowSeconds() + 90 }));
    await second;
    expect(isFresh(await auth.getToken(false), nowSeconds())).toBe(true);
    expect(auth.hasFreshToken()).toBe(false);
    expect(renderButton).toHaveBeenCalledTimes(2);
    expect(signInDialog(host).open).toBe(false);
    host.remove();
  });

  it('fails a token request instead of opening sign-in while prompts are suppressed, until released', async () => {
    const { renderButton, emitCredential } = stubGoogleAccounts();
    const host = document.createElement('div');
    document.body.append(host);
    const auth = createAuth('client-id', host);
    const first = auth.getToken(false);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    const credential = encode({ exp: nowSeconds() + 3600 });
    emitCredential(credential);
    await first;

    const release = auth.suppressPrompts();
    await expect(auth.getToken(false)).resolves.toBe(credential);
    // Neutral wording: a save still in flight when the display opens can surface this as a toast.
    await expect(auth.getToken(true)).rejects.toMatchObject({ code: 'UNAUTHENTICATED', message: 'Sign-in is needed. Tap to sign in again.' });
    expect(renderButton).toHaveBeenCalledTimes(1);
    expect(signInDialog(host).open).toBe(false);

    release();
    release();
    void auth.getToken(true);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(2));
    expect(signInDialog(host).open).toBe(true);
    host.remove();
  });

  it('settles every waiter present at dismissal, even if a new getToken arrives before the close event fires', async () => {
    const { renderButton } = stubGoogleAccounts();
    const host = document.createElement('div');
    document.body.append(host);
    const auth = createAuth('client-id', host);
    const dialog = signInDialog(host);
    // Browsers queue the close event as a task; simulate that gap so a getToken landing inside it
    // is exercised deterministically instead of racing the real (synchronous, in this jsdom) close.
    const lateClose = vi.spyOn(dialog, 'close').mockImplementation(function (this: HTMLDialogElement) {
      this.open = false;
      setTimeout(() => this.dispatchEvent(new Event('close')), 0);
    });

    const first = auth.getToken(false);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    const cancel = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Cancel') as HTMLButtonElement;
    cancel.click();

    // In the gap before the queued close event fires, a retried request asks for a token again.
    const second = auth.getToken(false);
    await expect(first).rejects.toMatchObject({ code: 'UNAUTHENTICATED', message: 'Sign-in was cancelled.' });

    let secondSettled = false;
    second.then(() => { secondSettled = true; }, () => { secondSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    // `second` belongs to the next prompt, not the dismissal already in flight when it was asked.
    expect(secondSettled).toBe(false);
    expect(dialog.open).toBe(true);

    lateClose.mockRestore();
    host.remove();
  });

  it('ignores a late close event from the previous sign-in when a new one has already opened', async () => {
    const { renderButton, emitCredential } = stubGoogleAccounts();
    const host = document.createElement('div');
    document.body.append(host);
    const auth = createAuth('client-id', host);
    const dialog = signInDialog(host);
    // Browsers queue the close event as a task; the jsdom shim fires it synchronously.
    const lateClose = vi.spyOn(dialog, 'close').mockImplementation(function (this: HTMLDialogElement) {
      this.open = false;
      setTimeout(() => this.dispatchEvent(new Event('close')), 0);
    });

    const first = auth.getToken(false);
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    emitCredential(encode({ exp: Math.floor(Date.now() / 1000) + 3600 }));
    await first;
    const next = auth.getToken(true);
    let settled = false;
    next.then(() => { settled = true; }, () => { settled = true; });
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(settled).toBe(false);
    expect(dialog.open).toBe(true);
    expect(host.hidden).toBe(false);
    lateClose.mockRestore();
    host.remove();
  });
});
