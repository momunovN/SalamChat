import { env } from "./env";

function digits(phone: string) {
  return phone.replace(/\D/g, "");
}

function text(code: string) {
  return `TooApp: ${code}`;
}

async function sendSmsRu(phone: string, code: string) {
  const key = env("SMS_API_KEY");
  const from = env("SMS_SENDER", "TooApp");
  const url = new URL("https://sms.ru/sms/send");
  url.searchParams.set("api_id", key);
  url.searchParams.set("to", digits(phone));
  url.searchParams.set("msg", text(code));
  url.searchParams.set("json", "1");
  if (from) url.searchParams.set("from", from);
  const res = await fetch(url, { method: "GET" });
  const body = (await res.json()) as { status?: string; status_text?: string };
  if (body.status !== "OK") {
    throw new Error(body.status_text || "sms.ru send failed");
  }
}

async function sendSmsc(phone: string, code: string) {
  const login = env("SMS_LOGIN");
  const psw = env("SMS_API_KEY");
  const from = env("SMS_SENDER", "TooApp");
  const url = new URL("https://smsc.ru/sys/send.php");
  url.searchParams.set("login", login);
  url.searchParams.set("psw", psw);
  url.searchParams.set("phones", digits(phone));
  url.searchParams.set("mes", text(code));
  url.searchParams.set("fmt", "3");
  if (from) url.searchParams.set("sender", from);
  const res = await fetch(url, { method: "GET" });
  const body = (await res.json()) as { error?: string; id?: number };
  if (body.error && !body.id) {
    throw new Error(body.error);
  }
}

export async function sendOTP(phone: string, code: string) {
  let provider = env("SMS_PROVIDER", "stub").toLowerCase();
  const key = env("SMS_API_KEY");
  if (key && (provider === "stub" || provider === "")) {
    provider = env("SMS_LOGIN") ? "smsc" : "smsru";
  }
  switch (provider) {
    case "smsru":
      if (!key) throw new Error("SMS_API_KEY required for sms.ru");
      await sendSmsRu(phone, code);
      return "smsru";
    case "smsc":
      if (!key || !env("SMS_LOGIN")) throw new Error("SMS_LOGIN and SMS_API_KEY required for smsc.ru");
      await sendSmsc(phone, code);
      return "smsc";
    default:
      console.log(`TooApp OTP ${phone} ${code}`);
      return "stub";
  }
}
