"use client";

import { useEffect, useState } from "react";
import { api, saveSession } from "@/lib/api";
import type { Dict } from "@/lib/i18n";
import type { Session } from "@/lib/types";
import { BrandMark } from "./BrandMark";

export function PhoneAuth({
  t,
  onSession,
}: {
  t: Dict;
  onSession: (s: Session) => void;
}) {
  const [cc, setCc] = useState<"996" | "7">("996");
  const [phone, setPhone] = useState("+996");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<0 | 1>(0);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [otp, setOtp] = useState<string | null>(null);
  const [waited, setWaited] = useState(false);

  function pickCountry(next: "996" | "7") {
    setCc(next);
    const prefix = next === "996" ? "+996" : "+7";
    const rest = phone.replace(/^\+\d{1,3}/, "");
    setPhone(prefix + rest);
  }

  function mapErr(msg: string, name = "") {
    const blob = `${name} ${msg}`;
    if (msg.includes("wrong code")) return t.errWrongCode;
    if (msg.includes("otp expired")) return t.errExpired;
    if (msg.includes("no otp")) return t.errNoOtp;
    if (msg.includes("too many")) return t.errAttempts;
    if (msg.includes("invalid code") || msg.includes("invalid phone")) return t.errInvalid;
    if (/timed out|timeout|TimeoutError|AbortError|abort|unavailable|Failed to fetch|NetworkError|db timeout/i.test(blob)) {
      return t.dbWake;
    }
    if (msg === "internal error") return t.errLogin;
    return msg || t.errLogin;
  }

  async function go(typed?: string) {
    if (busy) return;
    setBusy(true);
    setWaited(false);
    setError(null);
    try {
      if (step === 0) {
        const r = await api.requestOTP(phone);
        if (r.dev_code) {
          setOtp(r.dev_code);
          setHint(`${t.yourCode}: ${r.dev_code}`);
        } else {
          setOtp(null);
          setHint(null);
        }
        setCode("");
        setStep(1);
      } else {
        const digits = (typed ?? code).replace(/\D/g, "");
        if (digits.length !== 6) {
          setError(t.errInvalid);
          return;
        }
        const s = await api.verifyOTP(phone, digits);
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

  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="mb-10">
          <BrandMark alt="" className="mb-5 h-16 w-16" />
          <p className="text-xs font-semibold tracking-[0.28em] text-accent">KG · RU</p>
          <h1 className="mt-2 text-[40px] font-bold tracking-tight text-ink">{t.app}</h1>
          <p className="mt-3 text-[17px] font-semibold text-ink">{step === 0 ? t.phoneTitle : t.otpTitle}</p>
          <p className="mt-1 text-sm text-muted">{step === 0 ? t.phoneSubtitle : t.otpSubtitle}</p>
        </div>
        {step === 0 ? (
          <div className="mb-3 flex gap-2">
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
        ) : null}
        <input
          value={step === 0 ? phone : code}
          onChange={(e) => {
            if (step === 0) {
              setPhone(e.target.value);
              return;
            }
            const next = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(next);
            if (next.length === 6 && !busy) void go(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void go();
          }}
          inputMode={step === 0 ? "tel" : "numeric"}
          autoFocus
          className="h-[52px] w-full rounded-[14px] bg-elevated px-3.5 text-base text-ink outline-none ring-accent/0 focus:ring-2 focus:ring-accent"
          placeholder={step === 0 ? (cc === "7" ? t.phonePlaceholderRu : t.phonePlaceholderKg) : "000000"}
        />
        {busy && waited ? <p className="mt-3 text-xs font-medium text-muted">{t.connecting}</p> : null}
        {hint ? <p className="mt-3 text-sm font-semibold tracking-[0.3em] text-success">{hint}</p> : null}
        {error ? <p className="mt-2 text-xs font-medium text-danger">{error}</p> : null}
        {step === 1 && otp ? (
          <button type="button" className="mt-2 text-xs text-muted underline" onClick={() => setCode(otp)}>
            {t.yourCode}: {otp}
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
