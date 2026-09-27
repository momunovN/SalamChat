import { envFirst } from "./env";

export type FanoutEnvelope = {
  type: string;
  ts: string;
  body: unknown;
};

export type PersistJob = {
  id: string;
  chatId: string;
  userId: string;
  type: string;
  payload: unknown;
  clientId: string;
  replyToId: string | null;
  createdAt: string;
  uploadIds: string[];
  voiceMs: number | null;
};

type Fanout = { origin: string; userId: string; env: FanoutEnvelope };

const CHANNEL = "tooapp:fanout";
const OUTBOX = "tooapp:outbox";
const WORK = "tooapp:outbox:work";
const TAIL = "tooapp:tail";
const origin = crypto.randomUUID();

const claimScript = `
local v = redis.call('LPOP', KEYS[1])
if v then redis.call('RPUSH', KEYS[2], v) end
return v
`;

type Redis = import("redis").RedisClientType;

let pub: Redis | null = null;
let opening: Promise<void> | null = null;
let nextTry = 0;
let remote: (userId: string, env: FanoutEnvelope) => void = () => {};
let persist: (job: PersistJob) => Promise<void> = async () => {};
let draining = false;

export function bindFanout(fn: (userId: string, env: FanoutEnvelope) => void) {
  remote = fn;
}

export function onPersist(fn: (job: PersistJob) => Promise<void>) {
  persist = fn;
}

export function valkeyURL() {
  const set = envFirst("", "TOOAPP_VALKEY_URL", "VALKEY_URL", "REDIS_URL");
  if (set) return set;
  if (process.env.NODE_ENV === "production") return "";
  return "redis://127.0.0.1:6379";
}

export function valkeyReady() {
  return !!pub?.isOpen;
}

function memKey(chatId: string) {
  return `tooapp:members:${chatId}`;
}

export async function connectValkey() {
  if (pub?.isOpen) return;
  if (opening) return opening;
  if (Date.now() < nextTry) return;
  opening = open().finally(() => {
    opening = null;
  });
  return opening;
}

async function open() {
  const url = valkeyURL();
  if (!url) {
    console.log("valkey off (set REDIS_URL or TOOAPP_VALKEY_URL)");
    nextTry = Date.now() + 60_000;
    return;
  }
  try {
    const { createClient } = await import("redis");
    const client = createClient({
      url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 1500,
        reconnectStrategy: (retries) => Math.min(100 * 2 ** retries, 3000),
      },
    }) as Redis;
    client.on("error", (err: Error) => {
      console.error("valkey", err.message);
    });
    await client.connect();
    const sub = client.duplicate();
    sub.on("error", (err: Error) => {
      console.error("valkey sub", err.message);
    });
    await sub.connect();
    await sub.subscribe(CHANNEL, (message) => {
      try {
        const parsed = JSON.parse(message) as Fanout;
        if (!parsed || parsed.origin === origin || !parsed.userId || !parsed.env) return;
        remote(parsed.userId, parsed.env);
      } catch {
        /* ignore malformed fanout */
      }
    });
    pub = client;
    nextTry = 0;
    console.log("valkey ready");
    await recoverWork();
    void drain();
  } catch (err) {
    pub = null;
    nextTry = Date.now() + 5000;
    console.error("valkey down", err instanceof Error ? err.message : err);
  }
}

async function recoverWork() {
  if (!pub?.isOpen) return;
  const stuck = await pub.lRange(WORK, 0, -1);
  if (stuck.length === 0) return;
  for (const item of stuck) await pub.rPush(OUTBOX, item);
  await pub.del(WORK);
}

export function publishRemote(userId: string, env: FanoutEnvelope) {
  const client = pub;
  if (!client?.isOpen) return;
  void client.publish(CHANNEL, JSON.stringify({ origin, userId, env })).catch((err: unknown) => {
    console.error("valkey publish", err instanceof Error ? err.message : err);
  });
}

export async function cachedName(userId: string, load: () => Promise<string>) {
  if (!pub?.isOpen) return load();
  const key = `tooapp:name:${userId}`;
  try {
    const hit = await pub.get(key);
    if (hit) return hit;
    const name = await load();
    if (name) await pub.set(key, name, { EX: 600 });
    return name;
  } catch {
    return load();
  }
}

export async function forgetName(userId: string) {
  if (!pub?.isOpen) return;
  await pub.del(`tooapp:name:${userId}`).catch(() => undefined);
}

export async function membersCached(chatId: string, load: () => Promise<string[]>) {
  if (!pub?.isOpen) return load();
  try {
    const hit = await pub.sMembers(memKey(chatId));
    if (hit.length > 0) return hit;
    const ids = await load();
    if (ids.length > 0) await rememberMembers(chatId, ids);
    return ids;
  } catch {
    return load();
  }
}

export async function rememberMembers(chatId: string, ids: string[]) {
  if (!pub?.isOpen || ids.length === 0) return;
  await pub.del(memKey(chatId));
  await pub.sAdd(memKey(chatId), ids);
  await pub.expire(memKey(chatId), 120);
}

export async function bustMembers(chatId: string) {
  if (!pub?.isOpen) return;
  await pub.del(memKey(chatId)).catch(() => undefined);
}

export async function messageByClient(clientId: string) {
  if (!pub?.isOpen) return null;
  const id = await pub.get(`tooapp:cid:${clientId}`);
  if (!id) return null;
  return readHot(id);
}

export async function readHot(id: string) {
  if (!pub?.isOpen) return null;
  return pub.get(`tooapp:msg:${id}`);
}

export async function readRecent(chatId: string) {
  if (!pub?.isOpen) return [];
  return pub.lRange(`tooapp:recent:${chatId}`, 0, 199);
}

export async function hotTailMap(ids: string[]) {
  const out = new Map<string, string>();
  if (!pub?.isOpen || ids.length === 0) return out;
  const rows = await pub.hmGet(TAIL, ids);
  ids.forEach((id, i) => {
    const raw = rows[i];
    if (raw) out.set(id, raw);
  });
  return out;
}

export async function stageMessage(msgJson: string, msgId: string, clientId: string, chatId: string, job: PersistJob) {
  if (!pub?.isOpen) return "down" as const;
  const cid = `tooapp:cid:${clientId}`;
  const claimed = await pub.set(cid, msgId, { NX: true, EX: 60 * 60 * 48 });
  if (claimed !== "OK") return "dup" as const;
  try {
    await pub
      .multi()
      .set(`tooapp:msg:${msgId}`, msgJson, { EX: 60 * 60 * 24 })
      .lPush(`tooapp:recent:${chatId}`, msgJson)
      .lTrim(`tooapp:recent:${chatId}`, 0, 199)
      .hSet(TAIL, chatId, msgJson)
      .rPush(OUTBOX, JSON.stringify(job))
      .exec();
    void drain();
    return "ok" as const;
  } catch (err) {
    await pub.del(cid).catch(() => undefined);
    throw err;
  }
}

export async function rewriteHot(chatId: string, id: string, json: string, deleted: boolean) {
  if (!pub?.isOpen) return;
  await pub.set(`tooapp:msg:${id}`, json, { EX: 60 * 60 * 24 });
  const rows = await pub.lRange(`tooapp:recent:${chatId}`, 0, 199);
  for (let i = 0; i < rows.length; i++) {
    try {
      const item = JSON.parse(rows[i]) as { id?: string };
      if (item.id === id) {
        await pub.lSet(`tooapp:recent:${chatId}`, i, json);
        break;
      }
    } catch {
      /* skip */
    }
  }
  if (!deleted) {
    const tail = await pub.hGet(TAIL, chatId);
    if (tail) {
      try {
        const item = JSON.parse(tail) as { id?: string };
        if (item.id === id) await pub.hSet(TAIL, chatId, json);
      } catch {
        /* skip */
      }
    }
    return;
  }
  let replacement: string | null = null;
  for (const raw of rows) {
    try {
      const item = JSON.parse(raw) as { id?: string; deleted_at?: string | null };
      if (item.id !== id && !item.deleted_at) {
        replacement = raw;
        break;
      }
    } catch {
      /* skip */
    }
  }
  if (replacement) await pub.hSet(TAIL, chatId, replacement);
  else await pub.hDel(TAIL, chatId);
}

async function claim() {
  if (!pub?.isOpen) return null;
  const raw = await pub.eval(claimScript, { keys: [OUTBOX, WORK], arguments: [] });
  return typeof raw === "string" && raw ? raw : null;
}

async function drain() {
  if (draining || !pub?.isOpen) return;
  draining = true;
  let more = false;
  try {
    for (let i = 0; i < 8; i++) {
      const raw = await claim();
      if (!raw) return;
      try {
        await persist(JSON.parse(raw) as PersistJob);
        await pub.lRem(WORK, 1, raw);
      } catch (err) {
        console.error("valkey persist", err instanceof Error ? err.message : err);
        await pub.lRem(WORK, 1, raw).catch(() => undefined);
        await pub.rPush(OUTBOX, raw).catch(() => undefined);
        setTimeout(() => void drain(), 1000);
        return;
      }
    }
    more = (await pub.lLen(OUTBOX)) > 0;
  } finally {
    draining = false;
  }
  if (more) setTimeout(() => void drain(), 0);
}
