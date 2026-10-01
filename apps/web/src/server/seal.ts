import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { envFirst, jwtSecret } from "./env";

const MAGIC = Buffer.from("SALAM1");

function key() {
  const raw = envFirst("", "TOOAPP_DATA_KEY");
  const material = raw || `tooapp-seal-v1:${jwtSecret()}`;
  return createHash("sha256").update(material).digest();
}

export function sealText(plain: string) {
  if (!plain || plain.startsWith("salam:1:")) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `salam:1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

export function openText(value: string) {
  if (!value.startsWith("salam:1:")) return value;
  const parts = value.split(":");
  if (parts.length !== 5) return value;
  try {
    const iv = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    const data = Buffer.from(parts[4], "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return value;
  }
}

export function sealBytes(buf: Buffer) {
  if (buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC)) return buf;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, enc]);
}

export function openBytes(buf: Buffer) {
  if (buf.length < MAGIC.length + 12 + 16 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) return buf;
  try {
    const iv = buf.subarray(MAGIC.length, MAGIC.length + 12);
    const tag = buf.subarray(MAGIC.length + 12, MAGIC.length + 28);
    const data = buf.subarray(MAGIC.length + 28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    return buf;
  }
}

export function sealPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return payload;
  const src = payload as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  if (typeof src.text === "string") out.text = sealText(src.text);
  if (typeof src.caption === "string") out.caption = sealText(src.caption);
  return out;
}

export function openPayload(payload: Record<string, unknown>) {
  const out = { ...payload };
  if (typeof out.text === "string") out.text = openText(out.text);
  if (typeof out.caption === "string") out.caption = openText(out.caption);
  return out;
}
