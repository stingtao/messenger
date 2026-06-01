import type { Env, SessionUser, UserRow } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SESSION_COOKIE = "messenger_session";
const OAUTH_STATE_COOKIE = "messenger_oauth_state";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signValue(value: string, secret: string): Promise<string> {
  const key = await signingKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return `${value}.${base64UrlEncode(signature)}`;
}

export async function verifySignedValue(signed: string | undefined, secret: string): Promise<string | null> {
  if (!signed) return null;
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const signature = signed.slice(dot + 1);
  const key = await signingKey(secret);
  try {
    const ok = await crypto.subtle.verify("HMAC", key, base64UrlDecode(signature), encoder.encode(value));
    return ok ? value : null;
  } catch {
    return null;
  }
}

export function getCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return rawValue.join("=");
  }
  return undefined;
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createSessionCookie(user: SessionUser, env: Env): Promise<string> {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })));
  return cookie(SESSION_COOKIE, await signValue(payload, env.SESSION_SECRET), SESSION_TTL_SECONDS);
}

export async function getSessionUser(request: Request, env: Env): Promise<SessionUser | null> {
  const payload = await verifySignedValue(getCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
  if (!payload) return null;
  try {
    const data = JSON.parse(decoder.decode(base64UrlDecode(payload))) as SessionUser & { exp: number };
    if (!data.uid || !data.email || Date.now() / 1000 > data.exp) return null;
    return {
      uid: data.uid,
      email: data.email,
      displayName: data.displayName,
      photoURL: data.photoURL,
    };
  } catch {
    return null;
  }
}

export async function createOAuthStateCookie(state: string, env: Env): Promise<string> {
  return cookie(OAUTH_STATE_COOKIE, await signValue(state, env.SESSION_SECRET), 600);
}

export async function verifyOAuthState(request: Request, env: Env, state: string | null): Promise<boolean> {
  if (!state) return false;
  const stored = await verifySignedValue(getCookie(request, OAUTH_STATE_COOKIE), env.SESSION_SECRET);
  return stored === state;
}

export function oauthStateClearCookie(): string {
  return clearCookie(OAUTH_STATE_COOKIE);
}

export function requireSameOrigin(request: Request): Response | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const url = new URL(request.url);
  if (origin !== url.origin) {
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}

export function publicUser(row: UserRow) {
  return {
    uid: row.uid,
    displayName: row.display_name,
    email: row.email,
    photoURL: row.photo_url ?? "",
    status: row.status,
    lastSeen: new Date(row.last_seen).toISOString(),
  };
}
