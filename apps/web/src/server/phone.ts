const e164 = /^\+[1-9]\d{7,14}$/;

/** KG: +996 / 996 / 0XXXXXXXXX. RU: +7 / 7XXXXXXXXXX / 8XXXXXXXXXX / 9XXXXXXXXX. */
export function normalizePhone(raw: string): string | null {
  let s = "";
  for (const r of raw) {
    if (/\d/.test(r) || r === "+") s += r;
  }
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+8") && s.length === 12) s = "+7" + s.slice(2);
  else if (s.startsWith("+")) {
    /* already E.164-shaped */
  } else if (s.startsWith("996") && s.length >= 12) s = "+" + s;
  else if (s.startsWith("7") && s.length === 11) s = "+" + s;
  else if (s.startsWith("8") && s.length === 11) s = "+7" + s.slice(1);
  else if (s.startsWith("9") && s.length === 10) s = "+7" + s;
  else if (s.startsWith("0") && s.length === 10) s = "+996" + s.slice(1);
  else if (s.length > 0 && s[0] !== "+") s = "+" + s;
  if (!e164.test(s)) return null;
  return s;
}

/** Empty or a bare country prefix means the person skipped the phone. A longer invalid number is an error. */
export function optionalPhone(raw: string): { phone: string | null; invalid: boolean } {
  const digits = raw.replace(/\D/g, "");
  if (!digits || digits === "996" || digits === "7") return { phone: null, invalid: false };
  const phone = normalizePhone(raw);
  if (!phone) return { phone: null, invalid: true };
  return { phone, invalid: false };
}

export function normalizeEmail(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (s.length < 5 || s.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

export function defaultDisplayName(phone: string) {
  if (phone.length < 4) return "Salam";
  return "• " + phone.slice(-4);
}

export function phoneDigits(raw: string) {
  return raw.replace(/\D/g, "");
}

export function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, " ").replace(/\s+/g, " ").trim();
}
