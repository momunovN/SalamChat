import { mkdir, readFile, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { query, queryOne } from "./db";
import { envFirst, publicBase } from "./env";
import { HttpError } from "./http";

const MAX_BYTES = 20 * 1024 * 1024;
const CHUNK = 12 * 1024;

function uploadRoots() {
  const preferred = envFirst("", "TOOAPP_UPLOAD_DIR") || path.join(process.cwd(), "data", "uploads");
  const tmp = path.join(os.tmpdir(), "tooapp-uploads");
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
  const remote = await storeRemote(buf, row.mime, row.kind, row.object_key.split("/").pop() || "file");
  if (remote) {
    await query(
      `UPDATE uploads SET object_key=$2, status='ready', size_bytes=$3, completed_at=now() WHERE id=$1`,
      [id, remote, buf.length],
    );
    return { id, url: remote, object_key: remote };
  }
  let onDisk = false;
  try {
    await writeAnywhere(row.object_key, buf);
    onDisk = true;
  } catch (err) {
    if (!denied(err)) throw err;
  }
  await query(`UPDATE uploads SET status='ready', size_bytes=$2, completed_at=now() WHERE id=$1`, [id, buf.length]);
  const persist = persistChunks(id, buf);
  if (!onDisk) await persist;
  else persist.catch((err) => console.error("upload persist", err instanceof Error ? err.message : err));
  return { id, url: `${publicBase(req)}/media/${row.object_key}`, object_key: row.object_key };
}

async function storeRemote(buf: Buffer, mime: string, kind: string, filename: string) {
  const key = envFirst("", "STORAGE_API_KEY", "TOOAPP_STORAGE_KEY");
  if (!key) return null;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: mime || "application/octet-stream" }), filename);
  form.append("path", `tooapp/${kind || "file"}`);
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
  let idx = 0;
  for (let i = 0; i < buf.length; i += CHUNK) {
    const part = buf.subarray(i, Math.min(buf.length, i + CHUNK));
    await query(
      `INSERT INTO upload_chunks (upload_id, idx, body) VALUES ($1,$2,decode($3,'hex'))
       ON CONFLICT (upload_id, idx) DO UPDATE SET body = EXCLUDED.body`,
      [uploadId, idx, Buffer.from(part).toString("hex")],
    );
    idx += 1;
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
  const row = await queryOne<{ id: string; body: string | null }>(
    `SELECT id, encode(body, 'hex') AS body FROM uploads WHERE object_key=$1`,
    [safe],
  );
  if (row?.body) return Buffer.from(String(row.body), "hex");
  if (!row) throw new HttpError(404, "not_found", "not found");
  const chunks = await query<{ body: string }>(
    `SELECT encode(body, 'hex') AS body FROM upload_chunks WHERE upload_id=$1 ORDER BY idx`,
    [row.id],
  );
  if (!chunks.length) throw new HttpError(404, "not_found", "not found");
  return Buffer.concat(chunks.map((c) => Buffer.from(String(c.body), "hex")));
}
