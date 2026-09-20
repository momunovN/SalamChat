import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { parse } from "url";
import next from "next";
import { loadEnv } from "./src/server/env";
import { migrate, warmup } from "./src/server/db";
import { handleRequest } from "./src/server/router";
import { attachWs } from "./src/server/ws";

loadEnv();

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || process.env.WEB_PORT || "3000", 10) || 3000;

async function main() {
  const app = next({ dev });
  const handle = app.getRequestHandler();

  function toFetch(req: IncomingMessage, body: Buffer) {
    const host = req.headers.host || `localhost:${port}`;
    const proto = (req.headers["x-forwarded-proto"] as string) || "http";
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (!v) continue;
      headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    }
    const method = req.method || "GET";
    const init: RequestInit = { method, headers };
    if (method !== "GET" && method !== "HEAD") init.body = new Uint8Array(body);
    return new Request(`${proto}://${host}${req.url}`, init);
  }

  async function pipeApi(req: IncomingMessage, res: ServerResponse) {
    const method = req.method || "GET";
    const chunks: Buffer[] = [];
    if (method !== "GET" && method !== "HEAD") {
      for await (const c of req) chunks.push(c as Buffer);
    }
    const response = await handleRequest(toFetch(req, Buffer.concat(chunks)));
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") {
      (res as { flushHeaders: () => void }).flushHeaders();
    }
    if (!response.body) {
      res.end();
      return;
    }
    const reader = response.body.getReader();
    req.on("close", () => {
      void reader.cancel();
    });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  }

  await app.prepare();

  const server = createServer(async (req, res) => {
    const pathname = parse(req.url || "").pathname || "";
    if (pathname === "/healthz" || pathname.startsWith("/v1/") || pathname.startsWith("/media/")) {
      try {
        await pipeApi(req, res);
      } catch (err) {
        console.error(err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: { code: "internal", message: "internal error" } }));
        }
      }
      return;
    }
    handle(req, res);
  });

  const upgradeHandler = app.getUpgradeHandler();
  attachWs(server, (req, socket, head) => {
    void upgradeHandler(req, socket, head);
  });

  server.listen(port, () => {
    console.log(`SAMAL web+api http://localhost:${port}`);
    void migrate()
      .then(() => warmup())
      .catch((err) => console.error("db warmup", err));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
