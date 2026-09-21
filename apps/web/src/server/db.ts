import { readdirSync, readFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { databaseURL, loadEnv } from "./env";

loadEnv();

const g = globalThis as typeof globalThis & {
  __samalPrisma?: PrismaClient;
  __samalMigrated?: Promise<void>;
};

function isNeon(url: string) {
  return /neon\.tech/i.test(url);
}

function pooledURL() {
  const url = databaseURL();
  if (!isNeon(url) || url.includes("-pooler")) return url;
  return url.replace(/(@)([^:/?]+)/, (_m, at: string, host: string) => {
    const name = host.split(".")[0];
    if (name.endsWith("-pooler")) return at + host;
    return at + host.replace(name, `${name}-pooler`);
  });
}

function createPrisma() {
  const url = pooledURL();
  process.env.DATABASE_URL = url;
  const adapter = new PrismaNeonHttp(url, { fetchOptions: { cache: "no-store" } });
  return new PrismaClient({ adapter });
}

export function prisma() {
  return (g.__samalPrisma ??= createPrisma());
}

function isRetryable(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return /terminat|ECONNRESET|ECONNREFUSED|fetch failed|network|socket|timeout|429|503|unavailable|control plane/i.test(
    msg,
  );
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetryable(err) || i === attempts - 1) throw err;
      g.__samalPrisma = undefined;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last;
}

function looksLikeRows(text: string) {
  const t = text.trim();
  return /^(select|with)\b/i.test(t) || /\breturning\b/i.test(t);
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return withRetry(async () => {
    try {
      const db = prisma();
      if (looksLikeRows(text)) {
        const rows = (await db.$queryRawUnsafe(text, ...params)) as T[];
        return Array.isArray(rows) ? rows : [];
      }
      await db.$executeRawUnsafe(text, ...params);
      return [];
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
    console.log("db ready (prisma)");
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

export async function migrate() {
  if (g.__samalMigrated) return g.__samalMigrated;
  g.__samalMigrated = (async () => {
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
  return g.__samalMigrated;
}
