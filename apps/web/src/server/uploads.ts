import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { query, queryOne } from "./db";
import { env, publicBase } from "./env";
import { HttpError } from "./http";

const MAX_BYTES = 20 * 1024 * 1024;

function uploadRoot() {
  return env("TOOAPP_UPLOAD_DIR", "") || path.join(process.cwd(), "data", "uploads");
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
  const row = await queryOne<{ object_key: string; user_id: string; status: string }>(
    `SELECT object_key, user_id, status FROM uploads WHERE id=$1`,
    [id],
  );
  if (!row || row.user_id !== userId) throw new HttpError(404, "not_found", "upload not found");
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) throw new HttpError(400, "bad_request", "empty upload");
  if (buf.length > MAX_BYTES) throw new HttpError(413, "too_large", "file too large");
  const dest = path.join(uploadRoot(), row.object_key);
  let onDisk = false;
  try {
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    onDisk = true;
  } catch (err) {
    if (!denied(err)) throw err;
  }
  if (onDisk) {
    await query(`UPDATE uploads SET status='ready', size_bytes=$2, completed_at=now(), body=NULL WHERE id=$1`, [
      id,
      buf.length,
    ]);
  } else {
    await query(
      `UPDATE uploads SET status='ready', size_bytes=$2, completed_at=now(), body=decode($3,'hex') WHERE id=$1`,
      [id, buf.length, buf.toString("hex")],
    );
  }
  return { id, url: `${publicBase(req)}/media/${row.object_key}`, object_key: row.object_key };
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
  try {
    return await readFile(path.join(uploadRoot(), safe));
  } catch (err) {
    if (!denied(err) && (err as { code?: string }).code !== "ENOENT") throw err;
  }
  const row = await queryOne<{ body: string | null }>(
    `SELECT encode(body, 'hex') AS body FROM uploads WHERE object_key=$1 AND body IS NOT NULL`,
    [safe],
  );
  if (!row?.body) throw new HttpError(404, "not_found", "not found");
  return Buffer.from(String(row.body), "hex");
}
