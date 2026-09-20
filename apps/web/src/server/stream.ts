import { envelope, hub, presence } from "./hub";

export function sseResponse(userId: string) {
  presence.heartbeat(userId);
  const encoder = new TextEncoder();
  let unsub: () => void = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (env: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(env)}\n\n`));
        } catch {
          /* closed */
        }
      };
      unsub = hub.subscribe(userId, send);
      send(envelope("pong", {}));
      ping = setInterval(() => {
        presence.heartbeat(userId);
        send(envelope("pong", {}));
      }, 20_000);
    },
    cancel() {
      unsub();
      if (ping) clearInterval(ping);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
