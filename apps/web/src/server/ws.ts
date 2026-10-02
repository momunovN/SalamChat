import type { Server } from "http";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { parse } from "url";
import { WebSocket, WebSocketServer } from "ws";
import { parseAccess } from "./auth";
import { memberIds, peerUserIds } from "./chats";
import { envelope, hub, presence } from "./hub";
import { beatSocket, clearOnline, dropSocket, markTyping, membersCached, noteSocket } from "./valkey";

export async function announcePresence(userId: string, online: boolean) {
  const peers = await peerUserIds(userId).catch(() => [] as string[]);
  if (peers.length === 0) return;
  hub.publishMany(peers, envelope("presence", { user_id: userId, online }));
}

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
        const connId = crypto.randomUUID();
        const first = presence.enter(userId);
        void noteSocket(userId, connId);
        if (first) void announcePresence(userId, true);
        const unsub = hub.subscribe(userId, (env) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(env));
        });
        const ping = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
            presence.heartbeat(userId);
            void beatSocket(userId, connId);
          }
        }, 25_000);
        ws.on("message", async (raw) => {
          try {
            const msg = JSON.parse(String(raw)) as { type?: string; chat_id?: string };
            if (msg.type === "ping") {
              ws.send(JSON.stringify(envelope("pong", {})));
              presence.heartbeat(userId);
              void beatSocket(userId, connId);
            }
            if (msg.type === "typing" && msg.chat_id) {
              const chatId = msg.chat_id;
              const ids = await membersCached(chatId, () => memberIds(chatId));
              if (!ids.includes(userId)) return;
              markTyping(chatId, userId);
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
          const last = presence.exit(userId);
          void dropSocket(userId, connId).then((empty) => {
            if (last && empty) void announcePresence(userId, false);
            else if (last) void clearOnline(userId);
          });
        });
      });
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });
}
