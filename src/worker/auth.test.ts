import { describe, expect, it } from 'vitest';
import { createOAuthStateCookie, createSessionCookie, getSessionUser, requireSameOrigin, verifyOAuthState, verifySignedValue } from './auth';
import type { Env, SessionUser } from './types';

function env(): Env {
  return {
    SESSION_SECRET: 'test-secret',
    GOOGLE_CLIENT_ID: 'client',
    GOOGLE_CLIENT_SECRET: 'secret',
  } as Env;
}

describe('auth security helpers', () => {
  it('round-trips a signed session cookie', async () => {
    const user: SessionUser = {
      uid: 'g-123',
      email: 'person@example.com',
      displayName: 'Person',
      photoURL: 'https://example.com/avatar.png',
    };

    const setCookie = await createSessionCookie(user, env());
    const request = new Request('https://app.example.test/api/me', {
      headers: { Cookie: setCookie.split(';')[0] },
    });

    await expect(getSessionUser(request, env())).resolves.toEqual(user);
  });

  it('rejects tampered signed values', async () => {
    const setCookie = await createSessionCookie(
      {
        uid: 'g-123',
        email: 'person@example.com',
        displayName: 'Person',
        photoURL: '',
      },
      env(),
    );
    const tampered = `${setCookie.split(';')[0]}a`;

    const request = new Request('https://app.example.test/api/me', {
      headers: { Cookie: tampered },
    });

    await expect(getSessionUser(request, env())).resolves.toBeNull();
  });

  it('requires same-origin mutating requests when an origin is present', () => {
    expect(requireSameOrigin(new Request('https://app.example.test/api/friends', {
      method: 'POST',
      headers: { Origin: 'https://app.example.test' },
    }))).toBeNull();

    expect(requireSameOrigin(new Request('https://app.example.test/api/friends', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.test' },
    }))?.status).toBe(403);
  });

  it('verifies OAuth state against the signed cookie', async () => {
    const setCookie = await createOAuthStateCookie('state-1', env());
    const request = new Request('https://app.example.test/api/auth/google/callback?state=state-1', {
      headers: { Cookie: setCookie.split(';')[0] },
    });

    await expect(verifyOAuthState(request, env(), 'state-1')).resolves.toBe(true);
    await expect(verifyOAuthState(request, env(), 'state-2')).resolves.toBe(false);
    await expect(verifySignedValue('unsigned.value', env().SESSION_SECRET)).resolves.toBeNull();
  });
});
