import type { Server } from "http";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { parse } from "url";
import { WebSocket, WebSocketServer } from "ws";
import { parseAccess } from "./auth";
import { memberIds } from "./chats";
import { envelope, hub, presence } from "./hub";

export function attachWs(
  server: Server,
  fallback?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", async (req, socket, head) => {
    const url = parse(req.url || "", true);
    if (url.pathname !== "/v1/ws") {
      fallback?.(req, socket, head);
      return;
    }
    let token = "";
    const h = req.headers.authorization;
    if (h && h.toLowerCase().startsWith("bearer ")) token = h.slice(7).trim();
    if (!token) token = String(url.query.token || "");
    try {
      const { userId } = await parseAccess(token);
      wss.handleUpgrade(req, socket, head, (ws) => {
        presence.heartbeat(userId);
        const unsub = hub.subscribe(userId, (env) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(env));
        });
        const ping = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
            presence.heartbeat(userId);
          }
        }, 25_000);
        ws.on("message", async (raw) => {
          try {
            const msg = JSON.parse(String(raw)) as { type?: string; chat_id?: string };
            if (msg.type === "ping") {
              ws.send(JSON.stringify(envelope("pong", {})));
              presence.heartbeat(userId);
            }
            if (msg.type === "typing" && msg.chat_id) {
              const ids = await memberIds(msg.chat_id);
              hub.publishMany(
                ids.filter((id) => id !== userId),
                envelope("typing", { chat_id: msg.chat_id, user_id: userId }),
              );
            }
          } catch {
            /* ignore */
          }
        });
        ws.on("close", () => {
          clearInterval(ping);
          unsub();
        });
      });
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });
}
