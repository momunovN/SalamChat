// Alert Tone (3), https://sound-pack.ru/download/Sound_11086.mp3
// The publisher offers this file as a free download for apps and programs.

const SRC = "/sounds/alert-tone.mp3";
const MESSAGE_MS = 220;
const RING_EVERY_MS = 2500;
const PERM_KEY = "tooapp.perm.notify";

let messageAudio: HTMLAudioElement | null = null;
let ringAudio: HTMLAudioElement | null = null;
let ringTimer = 0;
let messageTimer = 0;
let callNotice: Notification | null = null;

function audio(which: "message" | "ring") {
  const current = which === "message" ? messageAudio : ringAudio;
  if (current) return current;
  const created = new Audio(SRC);
  created.preload = "auto";
  if (which === "message") messageAudio = created;
  else ringAudio = created;
  return created;
}

export function unlockSounds() {
  if (typeof Audio === "undefined") return;
  for (const which of ["message", "ring"] as const) {
    const node = audio(which);
    const volume = node.volume;
    node.volume = 0;
    void node
      .play()
      .then(() => {
        node.pause();
        node.currentTime = 0;
        node.volume = volume || 1;
      })
      .catch(() => {
        node.volume = volume || 1;
      });
  }
}

export function playMessageChime() {
  if (ringTimer || typeof Audio === "undefined") return;
  const node = audio("message");
  if (messageTimer) window.clearTimeout(messageTimer);
  node.pause();
  node.currentTime = 0;
  node.volume = 1;
  void node.play().catch(() => undefined);
  messageTimer = window.setTimeout(() => {
    messageTimer = 0;
    node.pause();
    node.currentTime = 0;
  }, MESSAGE_MS);
}

function ringOnce() {
  const node = audio("ring");
  node.pause();
  node.currentTime = 0;
  node.volume = 1;
  void node.play().catch(() => undefined);
}

export function startRingtone() {
  if (typeof Audio === "undefined" || ringTimer) return;
  ringOnce();
  ringTimer = window.setInterval(ringOnce, RING_EVERY_MS);
}

export function stopRingtone() {
  if (ringTimer) window.clearInterval(ringTimer);
  ringTimer = 0;
  ringAudio?.pause();
  if (ringAudio) ringAudio.currentTime = 0;
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
