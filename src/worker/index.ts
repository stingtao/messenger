import { makeChatId, parseChatId, isChatParticipant } from "../shared/chat";
import {
  clearCookie,
  createOAuthStateCookie,
  createSessionCookie,
  getSessionUser,
  oauthStateClearCookie,
  publicUser,
  requireSameOrigin,
  verifyOAuthState,
} from "./auth";
import { ChatRoom } from "./chatRoom";
import { callFromRow, messageFromRow } from "./format";
import { getTurnIceServerConfig } from "./turn";
import type { CallRow, Env, MessageRow, SessionUser, UserRow } from "./types";
import { UserHub } from "./userHub";

export { ChatRoom, UserHub };

interface GoogleTokenResponse {
  access_token: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' https://pagead2.googlesyndication.com https://www.googletagservices.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://lh3.googleusercontent.com https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://www.google.com https://www.gstatic.com",
    "connect-src 'self' ws: wss: stun: turn: turns: https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net",
    "frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, { ...init, headers: { ...jsonHeaders, ...init.headers } });
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function redirect(location: string, headers?: HeadersInit): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...headers } });
}

async function requireUser(request: Request, env: Env): Promise<SessionUser | Response> {
  const user = await getSessionUser(request, env);
  return user ?? json({ error: "Unauthorized" }, { status: 401 });
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

async function isFriend(env: Env, userId: string, friendId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS ok FROM friends WHERE user_id = ? AND friend_id = ?").bind(userId, friendId).first<{ ok: number }>();
  return Boolean(row?.ok);
}

async function ensureCanChat(env: Env, user: SessionUser, chatId: string): Promise<Response | null> {
  const participants = parseChatId(chatId);
  if (!participants || !isChatParticipant(chatId, user.uid) || makeChatId(participants[0], participants[1]) !== chatId) {
    return json({ error: "Invalid chat" }, { status: 400 });
  }

  const otherId = participants[0] === user.uid ? participants[1] : participants[0];
  if (!(await isFriend(env, user.uid, otherId))) {
    return json({ error: "You can only chat with friends" }, { status: 403 });
  }

  return null;
}

async function handleAuthStart(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET) {
    return json({ error: "Google OAuth secrets are not configured" }, { status: 500 });
  }

  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, {
    "Set-Cookie": await createOAuthStateCookie(state, env),
  });
}

async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !(await verifyOAuthState(request, env, state))) {
    return redirect("/?auth=failed", { "Set-Cookie": oauthStateClearCookie() });
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${url.origin}/api/auth/google/callback`,
    }),
  });

  if (!tokenResponse.ok) {
    return redirect("/?auth=failed", { "Set-Cookie": oauthStateClearCookie() });
  }

  const token = (await tokenResponse.json()) as GoogleTokenResponse;
  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  if (!profileResponse.ok) {
    return redirect("/?auth=failed", { "Set-Cookie": oauthStateClearCookie() });
  }

  const profile = (await profileResponse.json()) as GoogleUserInfo;
  const now = Date.now();
  const uid = `g-${profile.sub}`;
  const row = await env.DB.prepare(
    `INSERT INTO users (uid, google_sub, email, display_name, photo_url, status, created_at, last_seen)
     VALUES (?, ?, ?, ?, ?, 'online', ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET
       email = excluded.email,
       display_name = excluded.display_name,
       photo_url = excluded.photo_url,
       status = 'online',
       last_seen = excluded.last_seen
     RETURNING *`,
  )
    .bind(uid, profile.sub, profile.email, profile.name ?? profile.email, profile.picture ?? "", now, now)
    .first<UserRow>();

  if (!row) return redirect("/?auth=failed", { "Set-Cookie": oauthStateClearCookie() });

  const user = {
    uid: row.uid,
    email: row.email,
    displayName: row.display_name,
    photoURL: row.photo_url ?? "",
  };

  const headers = new Headers({ Location: "/" });
  headers.append("Set-Cookie", await createSessionCookie(user, env));
  headers.append("Set-Cookie", oauthStateClearCookie());
  return new Response(null, { status: 302, headers });
}

async function handleLogout(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;

  await env.DB.prepare("UPDATE users SET status = 'offline', last_seen = ? WHERE uid = ?").bind(Date.now(), user.uid).run();
  return json({ ok: true }, { headers: { "Set-Cookie": clearCookie("messenger_session") } });
}

async function handleUsers(env: Env, user: SessionUser): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM users
     WHERE uid != ?
     ORDER BY display_name COLLATE NOCASE
     LIMIT 200`,
  )
    .bind(user.uid)
    .all<UserRow>();
  return json({ users: results.map(publicUser) });
}

async function handleFriends(env: Env, user: SessionUser): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT u.*
     FROM friends f
     JOIN users u ON u.uid = f.friend_id
     WHERE f.user_id = ?
     ORDER BY u.display_name COLLATE NOCASE`,
  )
    .bind(user.uid)
    .all<UserRow>();
  return json({ friends: results.map(publicUser) });
}

async function handleAddFriend(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;

  const body = await readJson<{ friendId?: string }>(request);
  const friendId = body?.friendId;
  if (!friendId || friendId === user.uid) return json({ error: "Invalid friend" }, { status: 400 });

  const exists = await env.DB.prepare("SELECT uid FROM users WHERE uid = ?").bind(friendId).first<{ uid: string }>();
  if (!exists) return json({ error: "User not found" }, { status: 404 });

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, added_at) VALUES (?, ?, ?)").bind(user.uid, friendId, now),
    env.DB.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, added_at) VALUES (?, ?, ?)").bind(friendId, user.uid, now),
  ]);

  return json({ ok: true });
}

async function handleMessages(env: Env, user: SessionUser, chatId: string): Promise<Response> {
  const denied = await ensureCanChat(env, user, chatId);
  if (denied) return denied;

  const { results } = await env.DB.prepare(
    `SELECT * FROM messages
     WHERE chat_id = ?
     ORDER BY created_at ASC
     LIMIT 200`,
  )
    .bind(chatId)
    .all<MessageRow>();

  return json({ messages: results.map(messageFromRow) });
}

async function handleAttachmentUpload(request: Request, env: Env, user: SessionUser, chatId: string): Promise<Response> {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;

  const denied = await ensureCanChat(env, user, chatId);
  if (denied) return denied;

  const participants = parseChatId(chatId);
  const receiverId = participants?.[0] === user.uid ? participants[1] : participants?.[0];
  if (!receiverId) return json({ error: "Invalid chat" }, { status: 400 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Missing file" }, { status: 400 });
  if (!file.type.startsWith("image/")) return json({ error: "Only image uploads are supported" }, { status: 415 });
  if (file.size > 5 * 1024 * 1024) return json({ error: "Image must be smaller than 5MB" }, { status: 413 });

  const id = crypto.randomUUID();
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "bin";
  const key = `${chatId}/${id}.${extension}`;
  await env.ATTACHMENTS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { chatId, uploader: user.uid },
  });

  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO messages (id, chat_id, sender_id, receiver_id, text, attachment_key, attachment_content_type, attachment_size, created_at)
     VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(id, chatId, user.uid, receiverId, key, file.type, file.size, now)
    .first<MessageRow>();

  if (!row) return json({ error: "Message could not be saved" }, { status: 500 });

  const message = messageFromRow(row);
  await env.CHAT_ROOM.getByName(chatId).fetch("https://chat-room/broadcast", {
    method: "POST",
    body: JSON.stringify({ type: "message", message }),
  });
  await env.USER_HUB.getByName(receiverId).fetch("https://user-hub/notify", {
    method: "POST",
    body: JSON.stringify({ type: "message", chatId, message }),
  });

  return json({ message }, { status: 201 });
}

async function handleAttachmentDownload(env: Env, user: SessionUser, messageId: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM messages WHERE id = ?").bind(messageId).first<MessageRow>();
  if (!row || !row.attachment_key || !isChatParticipant(row.chat_id, user.uid)) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.ATTACHMENTS.get(row.attachment_key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}

async function handleChatWebSocket(request: Request, env: Env, user: SessionUser, chatId: string): Promise<Response> {
  const denied = await ensureCanChat(env, user, chatId);
  if (denied) return denied;

  const headers = new Headers(request.headers);
  headers.set("X-User-Id", user.uid);
  headers.set("X-Chat-Id", chatId);

  const stub = env.CHAT_ROOM.getByName(chatId);
  return stub.fetch(new Request(`https://chat-room/socket?chatId=${encodeURIComponent(chatId)}`, { headers }));
}

async function handleUserWebSocket(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set("X-User-Id", user.uid);
  const stub = env.USER_HUB.getByName(user.uid);
  return stub.fetch(new Request("https://user-hub/socket", { headers }));
}

async function handleIncomingCalls(env: Env, user: SessionUser): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM calls
     WHERE receiver_id = ? AND status IN ('calling', 'connected')
     ORDER BY updated_at DESC
     LIMIT 5`,
  )
    .bind(user.uid)
    .all<CallRow>();

  return json({ calls: results.map(callFromRow) });
}

async function handleTurnIceServers(env: Env): Promise<Response> {
  return json(await getTurnIceServerConfig(env));
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/auth/google/start") return handleAuthStart(request, env);
  if (request.method === "GET" && path === "/api/auth/google/callback") return handleAuthCallback(request, env);

  const userOrResponse = await requireUser(request, env);
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  if (request.method === "GET" && path === "/api/me") return json({ user });
  if (request.method === "POST" && path === "/api/auth/logout") return handleLogout(request, env, user);
  if (request.method === "GET" && path === "/api/users") return handleUsers(env, user);
  if (request.method === "GET" && path === "/api/friends") return handleFriends(env, user);
  if (request.method === "POST" && path === "/api/friends") return handleAddFriend(request, env, user);
  if (request.method === "GET" && path === "/api/ws/user") return handleUserWebSocket(request, env, user);
  if (request.method === "GET" && path === "/api/calls/incoming") return handleIncomingCalls(env, user);
  if (request.method === "GET" && path === "/api/turn/ice-servers") return handleTurnIceServers(env);

  const chatMessagesMatch = path.match(/^\/api\/chats\/([^/]+)\/messages$/);
  if (chatMessagesMatch && request.method === "GET") {
    return handleMessages(env, user, decodeURIComponent(chatMessagesMatch[1]));
  }

  const attachmentUploadMatch = path.match(/^\/api\/chats\/([^/]+)\/attachments$/);
  if (attachmentUploadMatch && request.method === "POST") {
    return handleAttachmentUpload(request, env, user, decodeURIComponent(attachmentUploadMatch[1]));
  }

  const chatWsMatch = path.match(/^\/api\/ws\/chat\/([^/]+)$/);
  if (chatWsMatch && request.method === "GET") {
    return handleChatWebSocket(request, env, user, decodeURIComponent(chatWsMatch[1]));
  }

  const attachmentMatch = path.match(/^\/api\/attachments\/([^/]+)$/);
  if (attachmentMatch && request.method === "GET") {
    return handleAttachmentDownload(env, user, decodeURIComponent(attachmentMatch[1]));
  }

  return json({ error: "Not found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const response = await handleApi(request, env);
      if (request.headers.get("Upgrade") === "websocket") return response;
      return withSecurityHeaders(response);
    }

    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response);
  },
};
