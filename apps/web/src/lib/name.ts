/** Placeholder names assigned at signup: "• 0001", digits-only, empty. */

export function needsDisplayName(name: string | null | undefined): boolean {
  const n = (name || "").trim();
  if (!n) return true;
  if (n === "TooApp") return true;
  if (/^[•·●.\-\s]*\d{2,8}$/.test(n)) return true;
  if (!/\p{L}/u.test(n)) return true;
  return false;
}

export function sanitizeDisplayName(raw: string): string | null {
  const n = raw.trim().replace(/\s+/g, " ");
  const len = [...n].length;
  if (len < 2 || len > 40) return null;
  if (needsDisplayName(n)) return null;
  return n;
}
