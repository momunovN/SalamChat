"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, saveSession, type OtpSent } from "@/lib/api";
import type { Dict, Lang } from "@/lib/i18n";
import type { Session } from "@/lib/types";
import { BrandMark } from "./BrandMark";
import { LangSwitch } from "./LangSwitch";

type Mode = "phone" | "email";

function phoneSkipped(value: string) {
  const digits = value.replace(/\D/g, "");
  return !digits || digits === "996" || digits === "7";
}

function clock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Maps a server error text to a message in the current language. Shared with EmailAttach. */
export function authError(t: Dict, msg: string, name = "") {
  const blob = `${name} ${msg}`;
  if (msg.includes("Почта не настроена")) return t.errMailDown;
  if (msg.includes("отправить письмо")) return t.errMail;
  if (msg.includes("SMS не настроено")) return t.errSmsDown;
  if (msg.includes("отправить SMS")) return t.errSms;
  if (msg.includes("email taken")) return t.emailTaken;
  if (msg.includes("email or phone")) return t.errChannel;
  if (msg.includes("invalid email")) return t.errEmail;
  if (msg.includes("phone taken")) return t.errPhoneTaken;
  if (msg.includes("invalid phone")) return t.errPhone;
  if (msg.includes("wrong code")) return t.errWrongCode;
  if (msg.includes("otp expired")) return t.errExpired;
  if (msg.includes("no otp")) return t.errNoOtp;
  if (msg.includes("too many")) return t.errAttempts;
  if (msg.includes("invalid code")) return t.errInvalid;
  if (/timed out|timeout|TimeoutError|AbortError|abort|unavailable|Failed to fetch|NetworkError|db timeout/i.test(blob)) {
    return t.dbWake;
  }
  if (msg === "internal error") return t.errLogin;
  return msg || t.errLogin;
}

/** The code shown under the input while SMS is not connected. Tapping it fills the field. */
export function ScreenCode({ t, code, onUse }: { t: Dict; code: string; onUse: (code: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onUse(code)}
      className="mt-3 w-full rounded-[14px] border border-accent/40 bg-accent/10 px-3.5 py-3 text-left"
    >
      <span className="block text-xs font-medium text-muted">{t.codeOnScreen}</span>
      <span className="mt-0.5 block font-mono text-[26px] font-bold tracking-[0.3em] text-ink tabular-nums">
        {code.slice(0, 3)} {code.slice(3)}
      </span>
      <span className="mt-1 block text-xs leading-5 text-muted">{t.codeOnScreenHint}</span>
    </button>
  );
}

export function PhoneAuth({
  t,
  lang,
  onLang,
  onSession,
}: {
  t: Dict;
  lang: Lang;
  onLang: (lang: Lang) => void;
  onSession: (s: Session) => void;
}) {
  const [mode, setMode] = useState<Mode>("phone");
  const [cc, setCc] = useState<"996" | "7">("996");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+996");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<OtpSent | null>(null);
  const [step, setStep] = useState<0 | 1>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waited, setWaited] = useState(false);
  const [left, setLeft] = useState(0);

  function pickCountry(next: "996" | "7") {
    setCc(next);
    const prefix = next === "996" ? "+996" : "+7";
    const rest = phone.replace(/^\+\d{1,3}/, "");
    setPhone(prefix + rest);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  function destination() {
    if (mode === "email") {
      const mail = email.trim();
      if (!mail || !mail.includes("@")) return null;
      return { email: mail, phone: "" };
    }
    if (phoneSkipped(phone)) return null;
    return { email: "", phone };
  }

  async function sendCode() {
    const next = destination();
    if (!next) throw new Error(mode === "email" ? "invalid email" : "invalid phone");
    const r = await api.requestOTP(next.email, next.phone);
    setSent(r);
    setCode("");
    setLeft(r.retry_after_sec || 60);
    setStep(1);
  }

  async function resend() {
    if (busy || left > 0) return;
    setBusy(true);
    setWaited(false);
    setError(null);
    try {
      await sendCode();
    } catch (err) {
      const e = err instanceof Error ? err : new Error("");
      setError(authError(t, e.message, e.name));
    } finally {
      setBusy(false);
    }
  }

  async function go(typed?: string) {
    if (busy) return;
    setBusy(true);
    setWaited(false);
    setError(null);
    try {
      if (step === 0) {
        if (!destination()) {
          setError(mode === "email" ? t.errEmail : t.errPhone);
          return;
        }
        await sendCode();
      } else {
        const digits = (typed ?? code).replace(/\D/g, "");
        if (digits.length !== 6) {
          setError(t.errInvalid);
          return;
        }
        const s =
          mode === "email" ? await api.verifyOTP(email.trim(), digits, "") : await api.verifyOTP("", digits, phone);
        saveSession(s);
        onSession(s);
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error("");
      setError(authError(t, e.message, e.name));
    } finally {
      setBusy(false);
    }
  }

  function useCode(value: string) {
    setCode(value);
    void go(value);
  }

  useEffect(() => {
    if (!busy) {
      setWaited(false);
      return;
    }
    const id = window.setTimeout(() => setWaited(true), 2500);
    return () => window.clearTimeout(id);
  }, [busy]);

  const ticking = left > 0;
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => {
      setLeft((n) => (n <= 1 ? 0 : n - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  const byMail = sent?.via === "email";
  const title = step === 0 ? t.phoneTitle : byMail ? t.otpTitle : t.otpTitleSms;
  const subtitle =
    step === 0
      ? mode === "email"
        ? t.emailLoginSubtitle
        : t.phoneLoginSubtitle
      : sent?.via === "screen"
        ? t.otpSubtitleScreen
        : byMail
          ? t.otpSubtitle
          : t.otpSubtitleSms;
  const sentTo = byMail ? sent?.hint || email.trim() : sent?.via === "sms" ? phone : "";

  const fieldClass =
    "h-[52px] w-full rounded-[14px] bg-elevated px-3.5 text-base text-ink outline-none placeholder:text-muted focus:ring-2 focus:ring-accent";

  return (
    <div className="min-h-dvh overflow-y-auto px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 sm:mb-10">
          <BrandMark alt="" className="mb-5 h-14 w-14 sm:h-16 sm:w-16" />
          <LangSwitch lang={lang} onLang={onLang} />
          <h1 className="mt-2 text-[32px] font-bold tracking-tight text-ink sm:text-[40px]">{t.app}</h1>
          <p className="mt-1 text-sm text-muted">{t.tagline}</p>
          <p className="mt-3 text-[17px] font-semibold text-ink">{title}</p>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>

        {step === 0 ? (
          mode === "phone" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(["996", "7"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => pickCountry(id)}
                    aria-pressed={cc === id}
                    className={`h-9 rounded-full px-3 text-sm font-semibold ${
                      cc === id ? "bg-accent text-white" : "bg-elevated text-muted hover:text-ink"
                    }`}
                  >
                    {id === "996" ? t.countryKg : t.countryRu} +{id}
                  </button>
                ))}
              </div>
              <input
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void go();
                }}
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                className={fieldClass}
                placeholder={cc === "7" ? t.phonePlaceholderRu : t.phonePlaceholderKg}
              />
            </div>
          ) : (
            <input
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void go();
              }}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              className={fieldClass}
              placeholder={t.emailPlaceholder}
            />
          )
        ) : (
          <>
            <input
              value={code}
              onChange={(e) => {
                const next = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(next);
                if (error) setError(null);
                if (next.length === 6 && !busy) void go(next);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void go();
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              className={`${fieldClass} font-mono tracking-[0.3em]`}
              placeholder="000000"
            />
            {sent?.dev_code ? <ScreenCode t={t} code={sent.dev_code} onUse={useCode} /> : null}
            {sentTo ? (
              <p className="mt-3 text-sm text-muted">
                {t.codeSentTo.split("%s")[0]}
                <span className="font-semibold text-success">{sentTo}</span>
                {t.codeSentTo.split("%s")[1] || ""}
              </p>
            ) : null}
          </>
        )}

        {busy && waited ? <p className="mt-3 text-xs font-medium text-muted">{t.connecting}</p> : null}
        {error ? <p className="mt-2 text-xs font-medium text-danger">{error}</p> : null}

        {step === 1 ? (
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setStep(0);
                setSent(null);
                setCode("");
                setError(null);
              }}
              className="text-sm font-semibold text-muted hover:text-ink"
            >
              {t.back}
            </button>
            <button
              type="button"
              disabled={busy || left > 0}
              onClick={() => void resend()}
              className="text-sm font-semibold text-accent disabled:text-muted"
            >
              {left > 0 ? t.resendIn.replace("%s", clock(left)) : t.resend}
            </button>
          </div>
        ) : null}

        <button
          type="button"
          disabled={busy}
          onClick={() => void go()}
          className="mt-4 h-[52px] w-full rounded-2xl bg-accent text-[17px] font-semibold text-white transition-opacity disabled:opacity-60"
        >
          {t.continue}
        </button>

        {step === 0 ? (
          <button
            type="button"
            onClick={() => switchMode(mode === "phone" ? "email" : "phone")}
            className="mt-3 h-11 w-full rounded-2xl text-sm font-semibold text-accent hover:bg-elevated"
          >
            {mode === "phone" ? t.loginByEmail : t.loginByPhone}
          </button>
        ) : null}

        <p className="mt-8 flex justify-center gap-4 text-center text-xs text-muted">
          <Link className="underline decoration-white/20 underline-offset-2" href="/about">
            {t.about}
          </Link>
          <Link className="underline decoration-white/20 underline-offset-2" href="/privacy">
            {t.privacy}
          </Link>
          <Link className="underline decoration-white/20 underline-offset-2" href="/download">
            {t.downloadAndroid}
          </Link>
        </p>
      </div>
    </div>
  );
}
