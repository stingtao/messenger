import { describe, expect, it, vi } from 'vitest';
import { getTurnIceServerConfig, normalizeIceServers, normalizeTurnTtl, usesBlockedBrowserPort } from './turn';
import type { Env } from './types';

function turnEnv(overrides: Partial<Env> = {}): Env {
  return {
    CLOUDFLARE_TURN_KEY_ID: 'turn-key',
    CLOUDFLARE_TURN_API_TOKEN: 'turn-token',
    ...overrides,
  } as Env;
}

describe('TURN ICE server configuration', () => {
  it('falls back to STUN when TURN secrets are not configured', async () => {
    const fetcher = vi.fn<typeof fetch>();

    const result = await getTurnIceServerConfig(turnEnv({ CLOUDFLARE_TURN_KEY_ID: undefined }), fetcher);

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.relayAvailable).toBe(false);
    expect(result.source).toBe('fallback-stun');
    expect(result.iceServers[0].urls).toContain('stun:stun1.l.google.com:19302');
  });

  it('generates short-lived Cloudflare TURN credentials without returning port 53 URLs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          iceServers: [
            {
              urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'],
            },
            {
              urls: [
                'turn:turn.cloudflare.com:3478?transport=udp',
                'turn:turn.cloudflare.com:53?transport=udp',
                'turns:turn.cloudflare.com:5349?transport=tcp',
              ],
              username: 'short-user',
              credential: 'short-password',
            },
          ],
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await getTurnIceServerConfig(turnEnv({ TURN_CREDENTIAL_TTL_SECONDS: '900' }), fetcher);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/turn-key/credentials/generate-ice-servers');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer turn-token' });
    expect(init.body).toBe(JSON.stringify({ ttl: 900 }));
    expect(result.relayAvailable).toBe(true);
    expect(result.source).toBe('cloudflare-turn');
    expect(result.iceServers.flatMap((server) => server.urls)).not.toContain('turn:turn.cloudflare.com:53?transport=udp');
    expect(result.iceServers.flatMap((server) => server.urls)).not.toContain('stun:stun.cloudflare.com:53');
    expect(result.iceServers.flatMap((server) => server.urls)).toContain('turns:turn.cloudflare.com:5349?transport=tcp');
  });

  it('normalizes TTL and ICE server inputs defensively', () => {
    expect(normalizeTurnTtl(undefined)).toBe(21600);
    expect(normalizeTurnTtl('10')).toBe(300);
    expect(normalizeTurnTtl('999999')).toBe(86400);
    expect(usesBlockedBrowserPort('turn:turn.cloudflare.com:53?transport=udp')).toBe(true);
    expect(usesBlockedBrowserPort('turns:turn.cloudflare.com:5349?transport=tcp')).toBe(false);
    expect(normalizeIceServers([{ urls: ['turn:turn.cloudflare.com:53?transport=udp'] }])).toEqual([]);
  });
});
