import { env } from "./env";

function digits(phone: string) {
  return phone.replace(/\D/g, "");
}

function text(code: string) {
  return `Salam: ${code}`;
}

type P1Item = {
  id?: number | string;
  status?: string;
  errorDescription?: string | null;
  message?: string;
};

type P1Body = {
  status?: string;
  message?: string;
  data?: P1Item[] | { message?: string; error?: string };
};

const FAILED = new Set(["error", "rejected", "low_balance", "low_partner_balance"]);

function p1Message(body: P1Body, status: number) {
  if (body.data && !Array.isArray(body.data)) {
    return body.data.message || body.data.error || body.message || `p1sms ${body.status || status}`;
  }
  return body.message || `p1sms ${body.status || status}`;
}

// Digit is the advertising channel: P1SMS marks it promo and holds it in moderation,
// so the code never reaches the phone. OTP uses the shared sender VIRTA on char.
function senderName() {
  const from = env("SMS_SENDER", "").trim();
  if (!from || ["salam", "tooapp", "samal"].includes(from.toLowerCase())) return "VIRTA";
  return from;
}

async function sendP1(phone: string, code: string) {
  const key = env("SMS_API_KEY");
  const sms = {
    channel: "char",
    sender: senderName(),
    phone: digits(phone),
    text: text(code),
  };

  const res = await fetch("https://admin.p1sms.ru/apiSms/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ apiKey: key, sms: [sms] }),
  });
  const raw = await res.text();
  let body: P1Body = {};
  try {
    body = raw ? (JSON.parse(raw) as P1Body) : {};
  } catch {
    throw new Error(`p1sms ${res.status}: ${raw.slice(0, 180)}`);
  }
  if (!res.ok || body.status !== "success") {
    throw new Error(p1Message(body, res.status));
  }
  const first = Array.isArray(body.data) ? body.data[0] : undefined;
  const itemStatus = String(first?.status || "").toLowerCase();
  if (first && FAILED.has(itemStatus)) {
    throw new Error(first.errorDescription || first.message || `p1sms ${first.status}`);
  }
}

export async function sendOTP(phone: string, code: string) {
  let provider = env("SMS_PROVIDER", "stub").toLowerCase();
  const key = env("SMS_API_KEY");
  // Earlier cabinets were sms.ru / smsc.ru. Those names now send through P1SMS.
  if (provider === "smsru" || provider === "smsc") provider = "p1sms";
  if (key && (provider === "stub" || provider === "")) provider = "p1sms";
  if (provider === "p1sms") {
    if (!key) throw new Error("SMS_API_KEY required for p1sms");
    await sendP1(phone, code);
    return "p1sms";
  }
  console.log(`Salam OTP ${phone} ${code}`);
  return "stub";
}
