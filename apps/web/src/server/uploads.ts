import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { query, queryOne } from "./db";
import { publicBase } from "./env";
import { HttpError } from "./http";

const root = path.join(process.cwd(), "data", "uploads");

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
  const ext = (mime.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8);
  const objectKey = `${userId}/${id}.${ext || "bin"}`;
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
  const dest = path.join(root, row.object_key);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  await query(`UPDATE uploads SET status='ready', size_bytes=$2, completed_at=now() WHERE id=$1`, [id, buf.length]);
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

export async function readMedia(objectKey: string) {
  const safe = objectKey.replace(/\\/g, "/");
  if (safe.includes("..") || safe.startsWith("/")) throw new HttpError(400, "bad_request", "bad key");
  try {
    const buf = await readFile(path.join(root, safe));
    return buf;
  } catch {
    throw new HttpError(404, "not_found", "not found");
  }
}
