import type { Env } from "./types";

interface SocketMeta {
  uid: string;
}

export class UserHub {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/notify") {
      const event = await request.text();
      this.broadcast(event);
      return new Response(null, { status: 204 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const uid = request.headers.get("X-User-Id");
    if (!uid) return new Response("Unauthorized", { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ uid } satisfies SocketMeta);
    this.state.acceptWebSocket(server);

    await this.env.DB.prepare("UPDATE users SET status = 'online', last_seen = ? WHERE uid = ?").bind(Date.now(), uid).run();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") ws.send("pong");
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const meta = ws.deserializeAttachment() as SocketMeta | undefined;
    if (!meta?.uid) return;

    const stillOnline = this.state
      .getWebSockets()
      .some((socket) => (socket.deserializeAttachment() as SocketMeta | undefined)?.uid === meta.uid);

    if (!stillOnline) {
      await this.env.DB.prepare("UPDATE users SET status = 'offline', last_seen = ? WHERE uid = ?").bind(Date.now(), meta.uid).run();
    }
  }

  webSocketError(): void {}

  private broadcast(serializedEvent: string): void {
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(serializedEvent);
      } catch {
        ws.close(1011, "Delivery failed");
      }
    }
  }
}
