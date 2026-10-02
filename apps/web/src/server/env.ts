/**
 * Environment names: SALAM_* first. The older TOOAPP_* and SAMAL_* names still work,
 * so a running deployment keeps its settings until they are renamed in the panel.
 */
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
  const secret = envFirst(DEV_JWT_SECRET, "SALAM_JWT_SECRET", "TOOAPP_JWT_SECRET", "SAMAL_JWT_SECRET");
  // The value also derives the at-rest data key and VAPID keys, so it is not replaced here:
  // changing it would make stored messages unreadable. Production must set its own.
  if (secret === DEV_JWT_SECRET && process.env.NODE_ENV === "production" && !warnedSecret) {
    warnedSecret = true;
    console.error(
      "SECURITY: SALAM_JWT_SECRET is not set (or uses the example value), so anyone can sign session tokens. " +
        "Before changing it, set SALAM_DATA_KEY=tooapp-seal-v1:<old secret> so stored messages stay readable.",
    );
  }
  return secret;
}

const DATABASE_KEYS = ["SALAM_DATABASE_URL", "TOOAPP_DATABASE_URL", "SAMAL_DATABASE_URL", "DATABASE_URL"];

function rawDatabaseURL() {
  return envFirst("postgres://salam:salam@localhost:5432/salam?sslmode=disable", ...DATABASE_KEYS);
}

/** Which variable the database address came from (for /healthz; the value itself stays secret). */
export function databaseSource() {
  loadEnv();
  return DATABASE_KEYS.find((key) => liveValue(key)) || "default";
}

/** Long-running Node API uses the DIRECT Neon host (same as Go). Pooler breaks pg prepared statements. */
export function databaseURL() {
  return rawDatabaseURL().replace("-pooler.", ".");
}

export function databaseURLDirect() {
  return databaseURL();
}

export function otpDev() {
  const v = envFirst("", "SALAM_OTP_DEV", "TOOAPP_OTP_DEV", "SAMAL_OTP_DEV");
  if (!v) return true;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

/**
 * Until an SMS key is set, a phone login shows its code on screen.
 * Numbers that already have a confirmed email get the code by email instead.
 * Set SALAM_PHONE_CODE_ON_SCREEN=false to turn this off.
 */
export function phoneCodeOnScreen() {
  const v = envFirst("", "SALAM_PHONE_CODE_ON_SCREEN", "TOOAPP_PHONE_CODE_ON_SCREEN").toLowerCase();
  if (!v) return true;
  return v === "1" || v === "true" || v === "yes";
}

export function publicBase(req?: Request) {
  const fromEnv = envFirst("", "SALAM_PUBLIC_URL", "TOOAPP_PUBLIC_URL", "SAMAL_PUBLIC_URL");
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (req) {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
    const local = /localhost|127\.0\.0\.1|\[::1\]/i.test(host);
    const proto = req.headers.get("x-forwarded-proto") || (local ? "http" : "https");
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}
