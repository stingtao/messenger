import { describe, expect, it, vi } from 'vitest';
import { browserFallbackIceServers, buildRtcConfiguration, isRelayOnlyEnabled, loadRtcConfiguration } from './webrtc';

describe('WebRTC ICE configuration', () => {
  it('builds a relay-only RTC configuration for TURN diagnostics', () => {
    const config = buildRtcConfiguration([{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'] }], true);

    expect(config.iceTransportPolicy).toBe('relay');
    expect(config.iceCandidatePoolSize).toBe(10);
    expect(config.iceServers).toEqual([{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'] }]);
  });

  it('detects relay-only mode from query string or local storage value', () => {
    expect(isRelayOnlyEnabled('?relay=1', null)).toBe(true);
    expect(isRelayOnlyEnabled('', '1')).toBe(true);
    expect(isRelayOnlyEnabled('?relay=0', null)).toBe(false);
  });

  it('falls back to browser STUN servers when the TURN endpoint is unavailable', async () => {
    const loadIceServers = vi.fn().mockRejectedValue(new Error('unavailable'));

    const config = await loadRtcConfiguration(loadIceServers, false);

    expect(config.iceServers).toEqual(browserFallbackIceServers);
    expect(config.iceTransportPolicy).toBeUndefined();
  });
});
