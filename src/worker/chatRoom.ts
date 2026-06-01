import { getOtherParticipant, isChatParticipant } from "../shared/chat";
import { messageFromRow } from "./format";
import type { Env, MessageRow } from "./types";

interface SocketMeta {
  userId: string;
  chatId: string;
}

interface ClientEvent {
  type: string;
  text?: string;
  typing?: boolean;
  callId?: string;
  callType?: "audio" | "video";
  offer?: unknown;
  answer?: unknown;
  candidate?: unknown;
}

interface ActiveCallRow {
  id: string;
  caller_id: string;
  receiver_id: string;
  type: "audio" | "video";
  status: "calling" | "connected";
  offer: string | null;
  answer: string | null;
}

interface CandidateRow {
  from_user: string;
  candidate: string;
}

export class ChatRoom {
  constructor(private state: DurableObjectState, private env: Env) {
    this.state.blockConcurrencyWhile(async () => {
      this.state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS call_candidates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          call_id TEXT NOT NULL,
          from_user TEXT NOT NULL,
          candidate TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_call_candidates_call_id
          ON call_candidates (call_id, id);
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/broadcast") {
      const event = await request.text();
      this.broadcast(event);
      return new Response(null, { status: 204 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const userId = request.headers.get("X-User-Id");
    const chatId = url.searchParams.get("chatId") ?? request.headers.get("X-Chat-Id");

    if (!userId || !chatId || !isChatParticipant(chatId, userId)) {
      return new Response("Forbidden", { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ userId, chatId } satisfies SocketMeta);
    this.state.acceptWebSocket(server);
    await this.replayActiveCallState(server, userId, chatId);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    const meta = ws.deserializeAttachment() as SocketMeta | undefined;
    if (!meta) {
      ws.close(1008, "Missing session");
      return;
    }

    let event: ClientEvent;
    try {
      event = JSON.parse(message) as ClientEvent;
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    if (event.type === "send_message") {
      await this.handleSendMessage(meta, event);
      return;
    }

    if (event.type === "typing") {
      this.broadcast(JSON.stringify({ type: "typing", userId: meta.userId, typing: Boolean(event.typing) }), ws);
      return;
    }

    if (event.type === "call_start") {
      await this.handleCallStart(meta, event);
      return;
    }

    if (event.type === "call_answer") {
      await this.handleCallAnswer(meta, event, ws);
      return;
    }

    if (event.type === "ice_candidate") {
      await this.handleIceCandidate(meta, event, ws);
      return;
    }

    if (event.type === "call_hangup") {
      await this.handleCallHangup(meta, event);
    }
  }

  webSocketClose(): void {}

  webSocketError(): void {}

  private async handleSendMessage(meta: SocketMeta, event: ClientEvent): Promise<void> {
    const text = (event.text ?? "").trim();
    const receiverId = getOtherParticipant(meta.chatId, meta.userId);
    if (!receiverId || !text || text.length > 4000) {
      this.sendErrorTo(meta, "Message text is required and must be 4000 characters or less.");
      return;
    }

    const now = Date.now();
    const row = await this.env.DB.prepare(
      `INSERT INTO messages (id, chat_id, sender_id, receiver_id, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
      .bind(crypto.randomUUID(), meta.chatId, meta.userId, receiverId, text, now)
      .first<MessageRow>();

    if (!row) {
      this.sendErrorTo(meta, "Message could not be saved.");
      return;
    }

    const payload = JSON.stringify({ type: "message", message: messageFromRow(row) });
    this.broadcast(payload);
    await this.notifyUser(receiverId, { type: "message", chatId: meta.chatId, message: messageFromRow(row) });
  }

  private async handleCallStart(meta: SocketMeta, event: ClientEvent): Promise<void> {
    const receiverId = getOtherParticipant(meta.chatId, meta.userId);
    if (!receiverId || (event.callType !== "audio" && event.callType !== "video") || !event.offer) {
      this.sendErrorTo(meta, "Invalid call offer.");
      return;
    }

    const now = Date.now();
    const callId = crypto.randomUUID();
    await this.env.DB.prepare(
      `INSERT INTO calls (id, chat_id, caller_id, receiver_id, type, status, offer, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'calling', ?, ?, ?)`,
    )
      .bind(callId, meta.chatId, meta.userId, receiverId, event.callType, JSON.stringify(event.offer), now, now)
      .run();

    const payload = {
      type: "incoming_call",
      call: {
        id: callId,
        chatId: meta.chatId,
        callerId: meta.userId,
        receiverId,
        type: event.callType,
        status: "calling",
        offer: event.offer,
      },
    };

    this.broadcast(JSON.stringify(payload));
    await this.notifyUser(receiverId, payload);
  }

  private async handleCallAnswer(meta: SocketMeta, event: ClientEvent, ws: WebSocket): Promise<void> {
    if (!event.callId || !event.answer) {
      this.sendErrorTo(meta, "Invalid call answer.");
      return;
    }

    await this.env.DB.prepare(
      `UPDATE calls
       SET answer = ?, status = 'connected', updated_at = ?
       WHERE id = ? AND chat_id = ? AND receiver_id = ? AND status != 'ended'`,
    )
      .bind(JSON.stringify(event.answer), Date.now(), event.callId, meta.chatId, meta.userId)
      .run();

    this.broadcast(JSON.stringify({ type: "call_answer", callId: event.callId, from: meta.userId, answer: event.answer }), ws);
    await this.replayCandidatesForCall(event.callId, meta.userId, ws);
  }

  private async handleIceCandidate(meta: SocketMeta, event: ClientEvent, ws: WebSocket): Promise<void> {
    if (!event.callId || !event.candidate) {
      this.sendErrorTo(meta, "Invalid ICE candidate.");
      return;
    }

    const call = await this.env.DB.prepare(
      "SELECT 1 AS ok FROM calls WHERE id = ? AND chat_id = ? AND (caller_id = ? OR receiver_id = ?) AND status != 'ended'",
    )
      .bind(event.callId, meta.chatId, meta.userId, meta.userId)
      .first<{ ok: number }>();

    if (!call?.ok) {
      this.sendErrorTo(meta, "ICE candidate does not belong to an active call.");
      return;
    }

    this.state.storage.sql.exec(
      "INSERT INTO call_candidates (call_id, from_user, candidate, created_at) VALUES (?, ?, ?, ?)",
      event.callId,
      meta.userId,
      JSON.stringify(event.candidate),
      Date.now(),
    );

    this.broadcast(JSON.stringify({ type: "ice_candidate", callId: event.callId, from: meta.userId, candidate: event.candidate }), ws);
  }

  private async handleCallHangup(meta: SocketMeta, event: ClientEvent): Promise<void> {
    if (!event.callId) return;

    const call = await this.env.DB.prepare(
      "SELECT caller_id, receiver_id FROM calls WHERE id = ? AND chat_id = ? AND (caller_id = ? OR receiver_id = ?)",
    )
      .bind(event.callId, meta.chatId, meta.userId, meta.userId)
      .first<{ caller_id: string; receiver_id: string }>();

    await this.env.DB.prepare(
      `UPDATE calls
       SET status = 'ended', updated_at = ?
       WHERE id = ? AND chat_id = ? AND (caller_id = ? OR receiver_id = ?)`,
    )
      .bind(Date.now(), event.callId, meta.chatId, meta.userId, meta.userId)
      .run();

    const payload = { type: "call_hangup", callId: event.callId, from: meta.userId };
    this.broadcast(JSON.stringify(payload));
    this.state.storage.sql.exec("DELETE FROM call_candidates WHERE call_id = ?", event.callId);
    if (call?.caller_id) await this.notifyUser(call.caller_id, payload);
    if (call?.receiver_id) await this.notifyUser(call.receiver_id, payload);
  }

  private async replayActiveCallState(ws: WebSocket, userId: string, chatId: string): Promise<void> {
    const { results } = await this.env.DB.prepare(
      `SELECT id, caller_id, receiver_id, type, status, offer, answer
       FROM calls
       WHERE chat_id = ?
         AND status IN ('calling', 'connected')
         AND (caller_id = ? OR receiver_id = ?)
       ORDER BY updated_at DESC
       LIMIT 3`,
    )
      .bind(chatId, userId, userId)
      .all<ActiveCallRow>();

    for (const call of results) {
      this.safeSend(ws, JSON.stringify({
        type: "incoming_call",
        call: {
          id: call.id,
          chatId,
          callerId: call.caller_id,
          receiverId: call.receiver_id,
          type: call.type,
          status: call.status,
          offer: call.offer ? JSON.parse(call.offer) : undefined,
        },
      }));

      if (call.answer && userId === call.caller_id) {
        this.safeSend(ws, JSON.stringify({
          type: "call_answer",
          callId: call.id,
          from: call.receiver_id,
          answer: JSON.parse(call.answer),
        }));
      }

      await this.replayCandidatesForCall(call.id, userId, ws);
    }
  }

  private async replayCandidatesForCall(callId: string, userId: string, ws: WebSocket): Promise<void> {
    const rows = this.state.storage.sql
      .exec(
        "SELECT from_user, candidate FROM call_candidates WHERE call_id = ? AND from_user != ? ORDER BY id ASC",
        callId,
        userId,
      )
      .toArray() as unknown as CandidateRow[];

    for (const row of rows) {
      this.safeSend(ws, JSON.stringify({
        type: "ice_candidate",
        callId,
        from: row.from_user,
        candidate: JSON.parse(row.candidate),
      }));
    }
  }

  private broadcast(serializedEvent: string, except?: WebSocket): void {
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      this.safeSend(ws, serializedEvent);
    }
  }

  private sendErrorTo(meta: SocketMeta, message: string): void {
    for (const ws of this.state.getWebSockets()) {
      const socketMeta = ws.deserializeAttachment() as SocketMeta | undefined;
      if (socketMeta?.userId === meta.userId) {
        this.safeSend(ws, JSON.stringify({ type: "error", message }));
      }
    }
  }

  private safeSend(ws: WebSocket, serializedEvent: string): void {
    try {
      ws.send(serializedEvent);
    } catch {
      ws.close(1011, "Delivery failed");
    }
  }

  private async notifyUser(userId: string, event: unknown): Promise<void> {
    const stub = this.env.USER_HUB.getByName(userId);
    await stub.fetch("https://user-hub/notify", {
      method: "POST",
      body: JSON.stringify(event),
    });
  }
}
