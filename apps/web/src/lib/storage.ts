/**
 * Browser storage used to live under "tooapp." (and the language under "samal.lang").
 * The first page load after the rename copies those values to "salam." and drops the old
 * keys, so nobody is signed out and no cached chats or settings are lost.
 */
let done = false;

export function migrateLegacyStorage() {
  if (done || typeof window === "undefined") return;
  done = true;
  try {
    const moves: [string, string][] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith("tooapp.")) moves.push([key, `salam.${key.slice("tooapp.".length)}`]);
      else if (key === "samal.lang") moves.push([key, "salam.lang"]);
    }
    for (const [from, to] of moves) {
      const value = localStorage.getItem(from);
      if (value != null && localStorage.getItem(to) == null) localStorage.setItem(to, value);
      localStorage.removeItem(from);
    }
  } catch {
    /* private mode or storage full: old keys stay, the app starts signed out */
  }
}
