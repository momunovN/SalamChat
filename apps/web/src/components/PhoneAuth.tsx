"use client";

import { useEffect, useState } from "react";
import { api, saveSession } from "@/lib/api";
import type { Dict } from "@/lib/i18n";
import type { Session } from "@/lib/types";
import { BrandMark } from "./BrandMark";

function phoneSkipped(value: string) {
  const digits = value.replace(/\D/g, "");
  return !digits || digits === "996" || digits === "7";
}

function clock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PhoneAuth({
  t,
  onSession,
}: {
  t: Dict;
  onSession: (s: Session) => void;
}) {
  const [cc, setCc] = useState<"996" | "7">("996");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+996");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<0 | 1>(0);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waited, setWaited] = useState(false);
  const [left, setLeft] = useState(0);

  function pickCountry(next: "996" | "7") {
    setCc(next);
    const prefix = next === "996" ? "+996" : "+7";
    const rest = phone.replace(/^\+\d{1,3}/, "");
    setPhone(prefix + rest);
  }

  function mapErr(msg: string, name = "") {
    const blob = `${name} ${msg}`;
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

  async function sendCode() {
    const sentPhone = phoneSkipped(phone) ? "" : phone;
    await api.requestOTP(email.trim(), sentPhone);
    setHint(email.trim());
    setCode("");
    setLeft(60);
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
      setError(mapErr(e.message, e.name));
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
        if (!email.trim().includes("@")) {
          setError(t.errEmail);
          return;
        }
        await sendCode();
      } else {
        const digits = (typed ?? code).replace(/\D/g, "");
        if (digits.length !== 6) {
          setError(t.errInvalid);
          return;
        }
        const sentPhone = phoneSkipped(phone) ? "" : phone;
        const s = await api.verifyOTP(email.trim(), digits, sentPhone);
        saveSession(s);
        onSession(s);
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error("");
      setError(mapErr(e.message, e.name));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!busy) {
      setWaited(false);
      return;
    }
    const id = window.setTimeout(() => setWaited(true), 2500);
    return () => window.clearTimeout(id);
  }, [busy]);

  useEffect(() => {
    if (left <= 0) return;
    const id = window.setInterval(() => {
      setLeft((n) => (n <= 1 ? 0 : n - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [left > 0]);

  const fieldClass =
    "h-[52px] w-full rounded-[14px] bg-elevated px-3.5 text-base text-ink outline-none ring-accent/0 focus:ring-2 focus:ring-accent";

  return (
    <div className="min-h-dvh overflow-y-auto px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 sm:mb-10">
          <BrandMark alt="" className="mb-5 h-14 w-14 sm:h-16 sm:w-16" />
          <p className="text-xs font-semibold tracking-[0.28em] text-accent">KG · RU</p>
          <h1 className="mt-2 text-[32px] font-bold tracking-tight text-ink sm:text-[40px]">{t.app}</h1>
          <p className="mt-3 text-[17px] font-semibold text-ink">{step === 0 ? t.phoneTitle : t.otpTitle}</p>
          <p className="mt-1 text-sm text-muted">{step === 0 ? t.phoneSubtitle : t.otpSubtitle}</p>
        </div>
        {step === 0 ? (
          <div className="space-y-3">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void go();
              }}
              inputMode="email"
              autoComplete="email"
              autoFocus
              className={fieldClass}
              placeholder={t.emailPlaceholder}
            />
            <p className="text-xs font-medium text-muted">{t.phoneOptional}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => pickCountry("996")}
                className={`h-9 rounded-full px-3 text-sm font-semibold ${cc === "996" ? "bg-accent text-ink" : "bg-elevated text-muted"}`}
              >
                {t.countryKg} +996
              </button>
              <button
                type="button"
                onClick={() => pickCountry("7")}
                className={`h-9 rounded-full px-3 text-sm font-semibold ${cc === "7" ? "bg-accent text-ink" : "bg-elevated text-muted"}`}
              >
                {t.countryRu} +7
              </button>
            </div>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void go();
              }}
              inputMode="tel"
              autoComplete="tel"
              className={fieldClass}
              placeholder={cc === "7" ? t.phonePlaceholderRu : t.phonePlaceholderKg}
            />
          </div>
        ) : (
          <input
            value={code}
            onChange={(e) => {
              const next = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(next);
              if (next.length === 6 && !busy) void go(next);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void go();
            }}
            inputMode="numeric"
            autoFocus
            className={fieldClass}
            placeholder="000000"
          />
        )}
        {busy && waited ? <p className="mt-3 text-xs font-medium text-muted">{t.connecting}</p> : null}
        {hint ? <p className="mt-3 text-sm font-semibold tracking-[0.08em] text-success">{hint}</p> : null}
        {error ? <p className="mt-2 text-xs font-medium text-danger">{error}</p> : null}
        {step === 1 ? (
          <button
            type="button"
            disabled={busy || left > 0}
            onClick={() => void resend()}
            className="mt-3 text-sm font-semibold text-accent disabled:text-muted"
          >
            {left > 0 ? t.resendIn.replace("%s", clock(left)) : t.resend}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void go()}
          className="mt-4 h-[52px] w-full rounded-2xl bg-accent text-[17px] font-semibold text-white transition-opacity disabled:opacity-60"
        >
          {t.continue}
        </button>
        <p className="mt-8 text-center text-xs text-muted">{t.apiHint}</p>
      </div>
    </div>
  );
}
