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
});
