import type { Env } from "./types";

const TURN_CREDENTIALS_ENDPOINT = "https://rtc.live.cloudflare.com/v1/turn/keys";
const DEFAULT_TTL_SECONDS = 6 * 60 * 60;
const MIN_TTL_SECONDS = 5 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;

export const fallbackIceServers: RTCIceServer[] = [
  {
    urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
  },
];

export interface IceServerResponse {
  iceServers: RTCIceServer[];
  relayAvailable: boolean;
  source: "cloudflare-turn" | "fallback-stun";
  ttlSeconds: number | null;
}

interface TurnCredentialsResponse {
  iceServers?: unknown;
}

type TurnEnv = Pick<Env, "CLOUDFLARE_TURN_KEY_ID" | "CLOUDFLARE_TURN_API_TOKEN" | "TURN_CREDENTIAL_TTL_SECONDS">;

export function normalizeTurnTtl(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.max(parsed, MIN_TTL_SECONDS), MAX_TTL_SECONDS);
}

export function usesBlockedBrowserPort(url: string): boolean {
  return /^(?:stun|turns?):[^?]*:53(?:[/?#]|$)/.test(url);
}

function normalizeUrls(urls: unknown): string[] {
  const rawUrls = typeof urls === "string" ? [urls] : Array.isArray(urls) ? urls : [];
  return rawUrls.filter((url): url is string => typeof url === "string" && !usesBlockedBrowserPort(url));
}

export function normalizeIceServers(input: unknown): RTCIceServer[] {
  if (!Array.isArray(input)) return [];

  return input.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    const urls = normalizeUrls(raw.urls);
    if (!urls.length) return [];

    const iceServer: RTCIceServer = { urls };
    if (typeof raw.username === "string") iceServer.username = raw.username;
    if (typeof raw.credential === "string") iceServer.credential = raw.credential;
    return [iceServer];
  });
}

function fallbackResponse(): IceServerResponse {
  return {
    iceServers: fallbackIceServers,
    relayAvailable: false,
    source: "fallback-stun",
    ttlSeconds: null,
  };
}

export async function getTurnIceServerConfig(env: TurnEnv, fetcher: typeof fetch = fetch): Promise<IceServerResponse> {
  if (!env.CLOUDFLARE_TURN_KEY_ID || !env.CLOUDFLARE_TURN_API_TOKEN) {
    return fallbackResponse();
  }

  const ttlSeconds = normalizeTurnTtl(env.TURN_CREDENTIAL_TTL_SECONDS);
  let response: Response;
  try {
    response = await fetcher(`${TURN_CREDENTIALS_ENDPOINT}/${encodeURIComponent(env.CLOUDFLARE_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_TURN_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: ttlSeconds }),
    });
  } catch (error) {
    console.warn("Cloudflare TURN credential generation could not be reached:", error);
    return fallbackResponse();
  }

  if (!response.ok) {
    console.warn("Cloudflare TURN credential generation failed:", response.status);
    return fallbackResponse();
  }

  let body: TurnCredentialsResponse;
  try {
    body = (await response.json()) as TurnCredentialsResponse;
  } catch (error) {
    console.warn("Cloudflare TURN response could not be parsed:", error);
    return fallbackResponse();
  }

  const iceServers = normalizeIceServers(body.iceServers);
  if (!iceServers.some((server) => normalizeUrls(server.urls).some((url) => url.startsWith("turn:") || url.startsWith("turns:")))) {
    console.warn("Cloudflare TURN response did not include usable relay URLs.");
    return fallbackResponse();
  }

  return {
    iceServers,
    relayAvailable: true,
    source: "cloudflare-turn",
    ttlSeconds,
  };
}
