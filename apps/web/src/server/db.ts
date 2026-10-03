import { readdirSync, readFileSync } from "fs";
import path from "path";
import { neon, types as neonTypes, type NeonQueryFunction } from "@neondatabase/serverless";
import pg from "pg";
import { databaseURL, loadEnv } from "./env";

loadEnv();

// DATE columns stay "YYYY-MM-DD" strings. As a JS Date they would land on local midnight
// and shift a day when the server is not on UTC.
pg.types.setTypeParser(1082, (v: string) => v);
neonTypes.setTypeParser(1082, (v: string) => v);

const g = globalThis as typeof globalThis & {
  __samalPool?: pg.Pool;
  __samalNeon?: NeonQueryFunction<false, false>;
  __samalMigrated?: Promise<void>;
};

function isNeon(url: string) {
  return /neon\.tech/i.test(url);
}

/** pg reads sslmode from the URL in its own way; strip it and set ssl explicitly. */
function poolConfig(): pg.PoolConfig {
  const raw = databaseURL();
  let connectionString = raw;
  let ssl: pg.PoolConfig["ssl"] = undefined;
  try {
    const u = new URL(raw);
    const mode = (u.searchParams.get("sslmode") || "").toLowerCase();
    u.searchParams.delete("sslmode");
    u.searchParams.delete("channel_binding");
    connectionString = u.toString();
    if (isNeon(raw) || (mode && mode !== "disable")) ssl = { rejectUnauthorized: mode !== "no-verify" };
  } catch {
    if (isNeon(raw)) ssl = { rejectUnauthorized: true };
  }
  return {
    connectionString,
    ssl,
    max: Number(process.env["SALAM_DB_POOL"] || 10) || 10,
    // Below Neon's idle suspend, so the pool drops sockets before the compute kills them.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    // OS default is 2 hours: a NAT that dropped an idle socket would hang the next query.
    keepAliveInitialDelayMillis: 10_000,
  };
}

/**
 * Neon is reached over its HTTPS driver, not raw Postgres TCP. From RelaxDev the TCP
 * connections to Neon (US) stalled and timed out ("db timeout" on every request), while
 * HTTPS, which the app used before, works. A database inside RelaxDev uses the pg pool.
 */
function neonSql() {
  return (g.__samalNeon ??= neon(databaseURL(), { fetchOptions: { cache: "no-store" } }));
}

export function usesNeonHttp() {
  return isNeon(databaseURL()) && process.env["SALAM_DB_DRIVER"] !== "pg";
}

/**
 * One long-lived pool for the whole process. Each query reuses an open TCP+TLS socket
 * instead of a fresh HTTPS round trip to Neon (the old PrismaNeonHttp path).
 */
export function pool() {
  if (g.__samalPool) return g.__samalPool;
  const p = new pg.Pool(poolConfig());
  // A socket killed while idle (Neon suspend, network blip) must not crash the process.
  p.on("error", (err) => console.error("db pool", err.message));
  g.__samalPool = p;
  return p;
}

function isRetryable(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string }).code || "";
  if (/^(57P01|57P02|57P03|08\w{3})$/.test(code)) return true;
  return /terminat|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|Connection terminated|timeout exceeded when trying to connect|socket|control plane|fetch failed|network|(429|502|503|504)/i.test(
    msg,
  );
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetryable(err) || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 300 * 2 ** i));
    }
  }
  throw last;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return withRetry(async () => {
    try {
      if (usesNeonHttp()) {
        const rows = await neonSql().query(text, params);
        return (Array.isArray(rows) ? rows : []) as T[];
      }
      const res = await pool().query(text, params);
      return (Array.isArray(res.rows) ? res.rows : []) as T[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("sql", text.slice(0, 100).replace(/\s+/g, " "), msg);
      throw err;
    }
  });
}

export async function queryOne<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
) {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function warmup() {
  try {
    await query("SELECT 1 AS ok");
    console.log(`db ready (${usesNeonHttp() ? "neon https" : "pg pool"})`);
  } catch (err) {
    console.error("db warmup", err instanceof Error ? err.message : err);
  }
}

function splitSQL(sqlText: string) {
  const out: string[] = [];
  let buf = "";
  let inDollar = false;
  for (let i = 0; i < sqlText.length; i++) {
    if (sqlText[i] === "$" && sqlText[i + 1] === "$") {
      inDollar = !inDollar;
      buf += "$$";
      i++;
      continue;
    }
    if (!inDollar && sqlText[i] === ";") {
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = "";
      continue;
    }
    buf += sqlText[i];
  }
  const last = buf.trim();
  if (last) out.push(last);
  return out;
}

let lastDbError: string | null = null;

/** Why the database is not usable right now, without the address or password; null when fine. */
export function dbError() {
  return lastDbError;
}

function describe(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/postgres(ql)?:\/\/\S+/gi, "postgres://…").slice(0, 300);
}

export async function migrate() {
  if (g.__samalMigrated) return g.__samalMigrated;
  const run = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const dir = path.join(process.cwd(), "sql");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".up.sql"))
      .sort();
    for (const version of files) {
      const exists = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1) AS exists`,
        [version],
      );
      if (exists?.exists) continue;
      const body = readFileSync(path.join(dir, version), "utf8");
      for (const stmt of splitSQL(body)) {
        await query(stmt);
      }
      await query(`INSERT INTO schema_migrations(version) VALUES ($1)`, [version]);
    }
  })();
  g.__samalMigrated = run;
  try {
    await run;
    lastDbError = null;
  } catch (err) {
    // Forget the failure so the next request tries again (database woke up, rights fixed),
    // instead of answering 500 to everything until a restart.
    if (g.__samalMigrated === run) g.__samalMigrated = undefined;
    lastDbError = describe(err);
    console.error("db migrate", lastDbError);
    throw err;
  }
}
