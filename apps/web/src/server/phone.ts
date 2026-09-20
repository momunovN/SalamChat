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

export function defaultDisplayName(phone: string) {
  if (phone.length < 4) return "TooApp";
  return "• " + phone.slice(-4);
}
