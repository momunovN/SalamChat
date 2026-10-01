import { api } from "./api";
import type { Lang } from "./i18n";

// Alert Tone (3), https://sound-pack.ru/download/Sound_11086.mp3
// The publisher offers this file as a free download for apps and programs.

const SRC = "/sounds/alert-tone.mp3";
const MESSAGE_SEC = 0.22;
const RING_EVERY_MS = 2500;
const PERM_KEY = "tooapp.perm.notify";

let ctx: AudioContext | null = null;
let buffer: AudioBuffer | null = null;
let loading: Promise<AudioBuffer | null> | null = null;
let ringTimer = 0;
let ringWanted = false;
let ringSource: AudioBufferSourceNode | null = null;
let callNotice: Notification | null = null;
let armed = false;

function context() {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

function loadBuffer() {
  if (buffer) return Promise.resolve(buffer);
  const audio = context();
  if (!loading) {
    loading = fetch(SRC)
      .then((res) => {
        if (!res.ok) throw new Error("sound");
        return res.arrayBuffer();
      })
      .then((raw) => audio.decodeAudioData(raw.slice(0)))
      .then((decoded) => {
        buffer = decoded;
        return decoded;
      })
      .catch(() => {
        loading = null;
        return null;
      });
  }
  return loading;
}

function playFromStart(seconds: number) {
  const audio = context();
  void audio.resume();
  return loadBuffer().then((decoded) => {
    if (!decoded) return null;
    const source = audio.createBufferSource();
    const gain = audio.createGain();
    source.buffer = decoded;
    source.connect(gain);
    gain.connect(audio.destination);
    const dur = Math.min(seconds, decoded.duration);
    const now = audio.currentTime;
    gain.gain.setValueAtTime(1, now);
    const fadeAt = now + Math.max(0, dur - 0.02);
    gain.gain.setValueAtTime(1, fadeAt);
    gain.gain.linearRampToValueAtTime(0.0001, now + dur);
    source.start(now, 0, dur);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    return source;
  });
}

export function unlockSounds() {
  if (typeof window === "undefined") return;
  const audio = context();
  void audio.resume().then(() => {
    void loadBuffer().then(() => {
      if (ringWanted) void ringOnce();
    });
  });
}

export function armSoundUnlock() {
  if (armed || typeof window === "undefined") return;
  armed = true;
  const unlock = () => {
    unlockSounds();
    if (context().state === "running") window.removeEventListener("pointerdown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  unlockSounds();
}

export function playMessageChime() {
  if (ringWanted || typeof window === "undefined") return;
  void playFromStart(MESSAGE_SEC);
}

function ringOnce() {
  try {
    ringSource?.stop();
  } catch {
    /* already stopped */
  }
  ringSource = null;
  void playFromStart(2.4).then((source) => {
    if (!ringWanted) {
      try {
        source?.stop();
      } catch {
        /* already stopped */
      }
      return;
    }
    ringSource = source;
  });
}

export function startRingtone() {
  if (typeof window === "undefined") return;
  ringWanted = true;
  if (ringTimer) return;
  ringOnce();
  ringTimer = window.setInterval(ringOnce, RING_EVERY_MS);
}

export function stopRingtone() {
  ringWanted = false;
  if (ringTimer) window.clearInterval(ringTimer);
  ringTimer = 0;
  try {
    ringSource?.stop();
  } catch {
    /* already stopped */
  }
  ringSource = null;
  callNotice?.close();
  callNotice = null;
}

export function shouldAskNotify() {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "default") return false;
  try {
    return !localStorage.getItem(PERM_KEY);
  } catch {
    return false;
  }
}

function keyBytes(value: string) {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function enableWebPush(lang: Lang) {
  void subscribePush(lang).catch(() => undefined);
}

async function subscribePush(lang: Lang) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const registration = await navigator.serviceWorker.register("/sw.js");
  const ready = await navigator.serviceWorker.ready;
  const keyRes = await fetch("/v1/push/vapid");
  if (!keyRes.ok) return;
  const body = (await keyRes.json()) as { public_key?: string };
  if (!body.public_key) return;
  let subscription = await ready.pushManager.getSubscription();
  if (!subscription) {
    subscription = await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(body.public_key),
    });
  }
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return;
  await api.subscribePush({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    lang,
  });
  void registration.update();
}

export function rememberNotify(choice: "granted" | "skip" | "denied") {
  try {
    localStorage.setItem(PERM_KEY, choice);
  } catch {
    /* private mode */
  }
}

export function notifyMessage(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const note = new Notification(title, { body, tag: "salam-message", silent: true });
    note.onclick = () => {
      window.focus();
      note.close();
    };
  } catch {
    /* the browser refused the notice */
  }
}

export function notifyCall(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || callNotice) return;
  try {
    callNotice = new Notification(title, { body, tag: "salam-call", silent: true });
    callNotice.onclick = () => {
      window.focus();
      callNotice?.close();
    };
  } catch {
    callNotice = null;
  }
}
