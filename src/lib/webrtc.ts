import { api } from './api';

export const browserFallbackIceServers: RTCIceServer[] = [
  {
    urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
  },
];

export function isRelayOnlyEnabled(search = window.location.search, storageValue = window.localStorage.getItem('messenger:relay-only')): boolean {
  return new URLSearchParams(search).get('relay') === '1' || storageValue === '1';
}

export function buildRtcConfiguration(iceServers: RTCIceServer[] | undefined, relayOnly: boolean): RTCConfiguration {
  return {
    iceServers: iceServers?.length ? iceServers : browserFallbackIceServers,
    iceCandidatePoolSize: 10,
    ...(relayOnly ? { iceTransportPolicy: 'relay' as RTCIceTransportPolicy } : {}),
  };
}

export async function loadRtcConfiguration(
  loadIceServers = api.turnIceServers,
  relayOnly = isRelayOnlyEnabled(),
): Promise<RTCConfiguration> {
  try {
    const config = await loadIceServers();
    return buildRtcConfiguration(config.iceServers, relayOnly);
  } catch (error) {
    console.warn('TURN ICE server configuration could not be loaded; falling back to STUN only:', error);
    return buildRtcConfiguration(browserFallbackIceServers, relayOnly);
  }
}
