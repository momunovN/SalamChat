/** A phone-book entry to send to /v1/contacts/sync. */
export type BookEntry = { phone: string; name?: string };

type PickedContact = { name?: string[]; tel?: string[] };
type ContactsManager = {
  select(props: string[], opts?: { multiple?: boolean }): Promise<PickedContact[]>;
};

/** Chrome on Android lets a page pick entries from the phone book. Safari and desktops do not. */
export function canPickContacts() {
  return typeof navigator !== "undefined" && "contacts" in navigator && typeof window !== "undefined" && "ContactsManager" in window;
}

export async function pickContacts(): Promise<BookEntry[]> {
  const manager = (navigator as Navigator & { contacts: ContactsManager }).contacts;
  const picked = await manager.select(["name", "tel"], { multiple: true });
  const out: BookEntry[] = [];
  for (const c of picked) {
    const name = c.name?.[0]?.trim() || undefined;
    for (const tel of c.tel || []) if (tel.trim()) out.push({ phone: tel.trim(), name });
  }
  return out;
}

/** Undo vCard line folding and quoted-printable soft breaks. */
function unfold(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/=\n/g, "").replace(/\n[ \t]/g, "");
}

function decodeValue(params: string, value: string) {
  let v = value;
  if (/ENCODING=QUOTED-PRINTABLE/i.test(params)) {
    try {
      const bytes: number[] = [];
      for (let i = 0; i < v.length; i++) {
        const hex = v[i] === "=" ? /^[0-9A-F]{2}/i.exec(v.slice(i + 1, i + 3)) : null;
        if (hex) {
          bytes.push(parseInt(hex[0], 16));
          i += 2;
        } else bytes.push(v.charCodeAt(i) & 0xff);
      }
      v = new TextDecoder().decode(new Uint8Array(bytes));
    } catch {
      /* keep as is */
    }
  }
  return v.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, " ").trim();
}

/**
 * Phones and names from a .vcf export (iPhone Contacts → a list → Export, or Google Contacts).
 * Only FN/N and TEL are read; everything else in the card is ignored.
 */
export function parseVCard(text: string): BookEntry[] {
  const out: BookEntry[] = [];
  for (const card of unfold(text).split(/BEGIN:VCARD/i).slice(1)) {
    let name = "";
    let structured = "";
    const tels: string[] = [];
    for (const line of card.split("\n")) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const head = line.slice(0, colon);
      const key = head.split(";")[0].replace(/^item\d+\./i, "").toUpperCase();
      const value = decodeValue(head, line.slice(colon + 1));
      if (key === "FN") name = value;
      else if (key === "N") structured = value.split(";").slice(0, 2).reverse().filter(Boolean).join(" ");
      else if (key === "TEL" && value) tels.push(value.replace(/^tel:/i, ""));
    }
    const label = (name || structured).slice(0, 80) || undefined;
    for (const phone of tels) out.push({ phone, name: label });
  }
  return out;
}

/** iPhone and iPad: Safari offers no phone-book access, only a .vcf exported from Contacts. */
export function isApple() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
