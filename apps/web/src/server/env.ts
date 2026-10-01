import { existsSync } from "fs";
import path from "path";
import { config } from "dotenv";

let loaded = false;

export function loadEnv() {
  if (loaded) return;
  loaded = true;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, ".env");
    if (existsSync(p)) {
      config({ path: p });
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

function liveValue(key: string) {
  const v = process.env[key];
  if (!v || v === "auto-generated-stub-for-build") return "";
  return v;
}

export function env(key: string, fallback = "") {
  loadEnv();
  return liveValue(key) || fallback;
}

export function envFirst(fallback: string, ...keys: string[]) {
  loadEnv();
  for (const key of keys) {
    const v = liveValue(key);
    if (v) return v;
  }
  return fallback;
}

export function envBool(key: string, fallback: boolean) {
  const v = env(key, "");
  if (!v) return fallback;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

const DEV_JWT_SECRET = "dev-change-me-32-bytes-minimum-secret";
let warnedSecret = false;

export function jwtSecret() {
  const secret = envFirst(DEV_JWT_SECRET, "TOOAPP_JWT_SECRET", "SAMAL_JWT_SECRET");
  // The value also derives the at-rest data key and VAPID keys, so it is not replaced here:
  // changing it would make stored messages unreadable. Production must set its own.
  if (secret === DEV_JWT_SECRET && process.env.NODE_ENV === "production" && !warnedSecret) {
    warnedSecret = true;
    console.error(
      "SECURITY: TOOAPP_JWT_SECRET is not set (or uses the example value), so anyone can sign session tokens. " +
        "Before changing it, set TOOAPP_DATA_KEY=tooapp-seal-v1:<old secret> so stored messages stay readable.",
    );
  }
  return secret;
}

function rawDatabaseURL() {
  return envFirst(
    "postgres://tooapp:tooapp@localhost:5432/tooapp?sslmode=disable",
    "TOOAPP_DATABASE_URL",
    "SAMAL_DATABASE_URL",
    "DATABASE_URL",
  );
}

/** Long-running Node API uses the DIRECT Neon host (same as Go). Pooler breaks pg prepared statements. */
export function databaseURL() {
  return rawDatabaseURL().replace("-pooler.", ".");
}

export function databaseURLDirect() {
  return databaseURL();
}

export function otpDev() {
  const v = envFirst("", "TOOAPP_OTP_DEV", "SAMAL_OTP_DEV");
  if (!v) return true;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

export function publicBase(req?: Request) {
  const fromEnv = envFirst("", "TOOAPP_PUBLIC_URL", "SAMAL_PUBLIC_URL");
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (req) {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
    const local = /localhost|127\.0\.0\.1|\[::1\]/i.test(host);
    const proto = req.headers.get("x-forwarded-proto") || (local ? "http" : "https");
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}
