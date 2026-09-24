/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuth, decodeJwtPayload, isFresh } from '../web/src/auth';

const encode = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

interface CredentialResponse {
  credential: string;
}

function stubGoogleAccounts() {
  let callback: ((response: CredentialResponse) => void) | undefined;
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
        prompt: vi.fn(),
        disableAutoSelect: vi.fn(),
      },
    },
  });
  return { renderButton, emitCredential: (credential: string) => callback?.({ credential }) };
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
});
