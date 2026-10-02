import { mkdir, readFile, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { query, queryOne } from "./db";
import { envFirst, publicBase } from "./env";
import { HttpError } from "./http";
import { openBytes, sealBytes } from "./seal";

const MAX_BYTES = 20 * 1024 * 1024;
// Postgres backup copy of an upload. Was 12 KB hex text per row: ~430 sequential INSERTs
// for a 5 MB photo. Now 1 MB binary rows. Reading concatenates by idx, so old rows still work.
const CHUNK = 1024 * 1024;

// Opened media kept in memory. Safari plays audio/video through many Range requests and
// every one of them used to re-read the whole file from disk, Postgres or remote storage.
const CACHE_LIMIT = 128 * 1024 * 1024;
const CACHE_ITEM_MAX = 24 * 1024 * 1024;
type Cached = { buf: Buffer; mime: string };
const mediaCache = new Map<string, Cached>();
let cacheBytes = 0;

function recall(key: string) {
  const hit = mediaCache.get(key);
  if (!hit) return null;
  mediaCache.delete(key);
  mediaCache.set(key, hit);
  return hit;
}

function remember(key: string, value: Cached) {
  if (value.buf.length > CACHE_ITEM_MAX) return value;
  const prev = mediaCache.get(key);
  if (prev) {
    cacheBytes -= prev.buf.length;
    mediaCache.delete(key);
  }
  mediaCache.set(key, value);
  cacheBytes += value.buf.length;
  for (const [k, v] of mediaCache) {
    if (cacheBytes <= CACHE_LIMIT) break;
    mediaCache.delete(k);
    cacheBytes -= v.buf.length;
  }
  return value;
}

function uploadRoots() {
  const preferred = envFirst("", "SALAM_UPLOAD_DIR", "TOOAPP_UPLOAD_DIR") || path.join(process.cwd(), "data", "uploads");
  const tmp = path.join(os.tmpdir(), "salam-uploads");
  return preferred === tmp ? [preferred] : [preferred, tmp];
}

function denied(err: unknown) {
  const code = (err as { code?: string }).code;
  return code === "EACCES" || code === "EPERM" || code === "EROFS" || code === "ENOTDIR";
}

function uploadExt(mime: string) {
  const sub = (mime.split("/")[1] || "bin").split(";")[0].trim().toLowerCase();
  if (sub === "mpeg") return "mp3";
  if (sub === "mp4" || sub === "m4a" || sub === "x-m4a") return "m4a";
  const clean = sub.replace(/[^a-z0-9]/g, "").slice(0, 8);
  return clean || "bin";
}

export async function createIntent(
  userId: string,
  mime: string,
  kind: string,
  sizeBytes: number,
  req: Request,
) {
  if (!["photo", "video", "file", "voice"].includes(kind)) {
    throw new HttpError(400, "bad_request", "bad kind");
  }
  const id = crypto.randomUUID();
  const objectKey = `${userId}/${id}.${uploadExt(mime)}`;
  await query(
    `INSERT INTO uploads (id, user_id, object_key, mime, size_bytes, kind, status)
     VALUES ($1,$2,$3,$4,$5,$6,'pending')
     ON CONFLICT (id) DO UPDATE SET mime = EXCLUDED.mime, size_bytes = EXCLUDED.size_bytes`,
    [id, userId, objectKey, mime || "application/octet-stream", sizeBytes || 0, kind],
  );
  const base = publicBase(req);
  return {
    id,
    object_key: objectKey,
    put_url: `${base}/v1/uploads/${id}`,
    mime,
    kind,
  };
}

export async function putUpload(userId: string, id: string, req: Request) {
  const row = await queryOne<{ object_key: string; user_id: string; status: string; kind: string; mime: string }>(
    `SELECT object_key, user_id, status, kind, mime FROM uploads WHERE id=$1`,
    [id],
  );
  if (!row || row.user_id !== userId) throw new HttpError(404, "not_found", "upload not found");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) throw new HttpError(400, "bad_request", "empty upload");
  if (buf.length > MAX_BYTES) throw new HttpError(413, "too_large", "file too large");
  const sealed = sealBytes(buf);
  const remote = await storeRemote(sealed, "application/octet-stream", "file", `${row.object_key.split("/").pop() || "file"}.bin`);
  if (remote) {
    await query(
      `UPDATE uploads SET object_key=$2, status='ready', size_bytes=$3, sealed=true, completed_at=now() WHERE id=$1`,
      [id, remote, buf.length],
    );
    return { id, url: `${publicBase(req)}/media/id/${id}`, object_key: remote };
  }
  let onDisk = false;
  try {
    await writeAnywhere(row.object_key, sealed);
    onDisk = true;
  } catch (err) {
    if (!denied(err)) throw err;
  }
  await query(`UPDATE uploads SET status='ready', size_bytes=$2, sealed=true, completed_at=now() WHERE id=$1`, [id, buf.length]);
  const persist = persistChunks(id, sealed);
  if (!onDisk) await persist;
  else persist.catch((err) => console.error("upload persist", err instanceof Error ? err.message : err));
  return { id, url: `${publicBase(req)}/media/${row.object_key}`, object_key: row.object_key };
}

async function storeRemote(buf: Buffer, mime: string, kind: string, filename: string) {
  const key = envFirst("", "STORAGE_API_KEY", "SALAM_STORAGE_KEY", "TOOAPP_STORAGE_KEY");
  if (!key) return null;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: mime || "application/octet-stream" }), filename);
  form.append("path", `salam/${kind || "file"}`);
  if (kind !== "photo") form.append("webp", "false");
  const endpoint = envFirst("https://relaxdev.ru/api/v1/storage/upload", "STORAGE_UPLOAD_URL");
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    const text = await res.text();
    if (!res.ok) {
      console.error("storage upload", res.status, text.slice(0, 180));
      return null;
    }
    const data = JSON.parse(text) as { url?: string; file?: { url?: string }; data?: { url?: string } };
    return data.url || data.file?.url || data.data?.url || null;
  } catch (err) {
    console.error("storage upload", err instanceof Error ? err.message : err);
    return null;
  }
}

async function writeAnywhere(objectKey: string, buf: Buffer) {
  let last: unknown;
  for (const root of uploadRoots()) {
    try {
      const dest = path.join(root, objectKey);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      return;
    } catch (err) {
      last = err;
      if (!denied(err)) throw err;
    }
  }
  throw last instanceof Error ? last : new Error("upload dir not writable");
}

async function persistChunks(uploadId: string, buf: Buffer) {
  const parts: { idx: number; body: Buffer }[] = [];
  for (let i = 0, idx = 0; i < buf.length; i += CHUNK, idx++) {
    parts.push({ idx, body: buf.subarray(i, Math.min(buf.length, i + CHUNK)) });
  }
  // A few in flight at once; the pool keeps them on open connections.
  for (let i = 0; i < parts.length; i += 4) {
    await Promise.all(
      parts.slice(i, i + 4).map((part) =>
        query(
          `INSERT INTO upload_chunks (upload_id, idx, body) VALUES ($1,$2,$3)
           ON CONFLICT (upload_id, idx) DO UPDATE SET body = EXCLUDED.body`,
          [uploadId, part.idx, part.body],
        ),
      ),
    );
  }
}

export async function completeUpload(userId: string, id: string, req: Request) {
  const row = await queryOne<{ object_key: string; user_id: string; status: string }>(
    `SELECT object_key, user_id, status FROM uploads WHERE id=$1`,
    [id],
  );
  if (!row || row.user_id !== userId) throw new HttpError(404, "not_found", "upload not found");
  if (row.status !== "ready") throw new HttpError(400, "bad_request", "upload not ready");
  return { id, url: `${publicBase(req)}/media/${row.object_key}` };
}

export async function mediaType(objectKey: string) {
  const row = await queryOne<{ mime: string }>(`SELECT mime FROM uploads WHERE object_key=$1`, [objectKey]);
  const mime = (row?.mime || "").split(";")[0].trim().toLowerCase();
  if (mime) return mime;
  const ext = objectKey.split(".").pop()?.toLowerCase();
  if (ext === "webm") return "audio/webm";
  if (ext === "m4a" || ext === "mp4") return "audio/mp4";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

export async function readMedia(objectKey: string) {
  const safe = objectKey.replace(/\\/g, "/");
  if (safe.includes("..") || safe.startsWith("/")) throw new HttpError(400, "bad_request", "bad key");
  for (const root of uploadRoots()) {
    try {
      return await readFile(path.join(root, safe));
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "ENOENT" && !denied(err)) throw err;
    }
  }
  const row = await queryOne<{ id: string; body: Buffer | null }>(`SELECT id, body FROM uploads WHERE object_key=$1`, [safe]);
  if (!row) throw new HttpError(404, "not_found", "not found");
  let buf: Buffer;
  if (row.body?.length) {
    buf = Buffer.from(row.body);
  } else {
    const chunks = await query<{ body: Buffer }>(`SELECT body FROM upload_chunks WHERE upload_id=$1 ORDER BY idx`, [row.id]);
    if (!chunks.length) throw new HttpError(404, "not_found", "not found");
    buf = Buffer.concat(chunks.map((c) => Buffer.from(c.body)));
  }
  // The disk copy was lost (redeploy, new container): put it back so the next read skips Postgres.
  void writeAnywhere(safe, buf).catch(() => undefined);
  return buf;
}

/** /media/<key>: opened bytes plus type, cached for repeated and ranged reads. */
export async function readPublicMedia(objectKey: string): Promise<Cached> {
  const hit = recall(`key:${objectKey}`);
  if (hit) return hit;
  const [raw, mime] = await Promise.all([readMedia(objectKey), mediaType(objectKey)]);
  return remember(`key:${objectKey}`, { buf: openBytes(raw), mime });
}

export async function readSealedUpload(id: string): Promise<Cached> {
  const hit = recall(`id:${id}`);
  if (hit) return hit;
  const row = await queryOne<{ object_key: string; mime: string }>(
    `SELECT object_key, mime FROM uploads WHERE id=$1`,
    [id],
  );
  if (!row) throw new HttpError(404, "not_found", "not found");
  let buf: Buffer;
  if (/^https?:\/\//i.test(row.object_key)) {
    const res = await fetch(row.object_key);
    if (!res.ok) throw new HttpError(404, "not_found", "not found");
    buf = Buffer.from(await res.arrayBuffer());
  } else {
    buf = await readMedia(row.object_key);
  }
  const mime = (row.mime || "application/octet-stream").split(";")[0].trim() || "application/octet-stream";
  return remember(`id:${id}`, { buf: openBytes(buf), mime });
}
