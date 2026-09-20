export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type",
  "Access-Control-Max-Age": "300",
};

export function json(status: number, body: unknown, extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return json(err.status, { error: { code: err.code, message: err.message } });
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error("api error", err);
  if (/terminat|timeout|ECONNRESET|connection|socket/i.test(msg)) {
    return json(503, { error: { code: "unavailable", message: "db timeout" } });
  }
  if (/prepared statement/i.test(msg)) {
    return json(503, { error: { code: "unavailable", message: "db timeout" } });
  }
  return json(500, { error: { code: "internal", message: msg || "internal error" } });
}

export async function readJSON<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "bad_json", "invalid json");
  }
}

export function iso(d: Date | string | null | undefined): string | undefined {
  if (d == null || d === "") return undefined;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return undefined;
  return t.toISOString();
}

export function bearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  const url = new URL(req.url);
  return url.searchParams.get("token") || "";
}
