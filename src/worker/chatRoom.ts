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

export class ChatRoom {
  constructor(private state: DurableObjectState, private env: Env) {}

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
      this.broadcast(JSON.stringify({ type: "ice_candidate", callId: event.callId, from: meta.userId, candidate: event.candidate }), ws);
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
    if (call?.caller_id) await this.notifyUser(call.caller_id, payload);
    if (call?.receiver_id) await this.notifyUser(call.receiver_id, payload);
  }

  private broadcast(serializedEvent: string, except?: WebSocket): void {
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(serializedEvent);
      } catch {
        ws.close(1011, "Delivery failed");
      }
    }
  }

  private sendErrorTo(meta: SocketMeta, message: string): void {
    for (const ws of this.state.getWebSockets()) {
      const socketMeta = ws.deserializeAttachment() as SocketMeta | undefined;
      if (socketMeta?.userId === meta.userId) {
        ws.send(JSON.stringify({ type: "error", message }));
      }
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
