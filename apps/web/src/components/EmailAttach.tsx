"use client";

import { useEffect, useState } from "react";
import { api, type OtpSent } from "@/lib/api";
import type { Dict } from "@/lib/i18n";
import type { User } from "@/lib/types";
import { authError, ScreenCode } from "./PhoneAuth";

/**
 * Ties a confirmed email to the signed-in account: address → 6-digit code from the letter → saved.
 * Used as the required step after a phone-only sign-up and as "change email" in settings.
 */
export function EmailAttach({
  t,
  initial = "",
  onDone,
  onCancel,
  autoFocus = true,
}: {
  t: Dict;
  initial?: string;
  onDone: (user: User) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [email, setEmail] = useState(initial);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<OtpSent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);

  const ticking = left > 0;
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  async function request() {
    const mail = email.trim();
    if (!mail.includes("@")) {
      setError(t.errEmail);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestEmailAttach(mail);
      setSent(r);
      setCode("");
      setLeft(r.retry_after_sec || 60);
    } catch (err) {
      setError(authError(t, err instanceof Error ? err.message : ""));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(typed?: string) {
    const digits = (typed ?? code).replace(/\D/g, "");
    if (digits.length !== 6) {
      setError(t.errInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await api.verifyEmailAttach(email.trim(), digits);
      onDone(user);
    } catch (err) {
      setError(authError(t, err instanceof Error ? err.message : ""));
    } finally {
      setBusy(false);
    }
  }

  const field =
    "h-[52px] w-full rounded-[14px] bg-elevated px-3.5 text-base text-ink outline-none placeholder:text-muted focus:ring-2 focus:ring-accent";

  return (
    <div>
      {!sent ? (
        <input
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) void request();
          }}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus={autoFocus}
          placeholder={t.emailPlaceholder}
          className={field}
        />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">
            {t.codeSentTo.split("%s")[0]}
            <span className="font-semibold text-success">{email.trim()}</span>
            {t.codeSentTo.split("%s")[1] || ""}
          </p>
          <input
            value={code}
            onChange={(e) => {
              const next = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(next);
              if (error) setError(null);
              if (next.length === 6 && !busy) void confirm(next);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void confirm();
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="000000"
            className={`${field} font-mono tracking-[0.3em]`}
          />
          {sent.dev_code ? (
            <ScreenCode
              t={t}
              code={sent.dev_code}
              onUse={(value) => {
                setCode(value);
                void confirm(value);
              }}
            />
          ) : null}
        </>
      )}

      {error ? <p className="mt-2 text-xs font-medium text-danger">{error}</p> : null}

      {sent ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setSent(null);
              setCode("");
              setError(null);
            }}
            className="text-sm font-semibold text-muted hover:text-ink"
          >
            {t.emailOther}
          </button>
          <button
            type="button"
            disabled={busy || left > 0}
            onClick={() => void request()}
            className="text-sm font-semibold text-accent disabled:text-muted"
          >
            {left > 0 ? t.resendIn.replace("%s", `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`) : t.resend}
          </button>
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="h-[52px] flex-1 rounded-2xl bg-elevated text-[17px] font-semibold text-ink"
          >
            {t.cancel}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void (sent ? confirm() : request())}
          className="h-[52px] flex-1 rounded-2xl bg-accent text-[17px] font-semibold text-white transition-opacity disabled:opacity-60"
        >
          {sent ? t.emailConfirm : t.continue}
        </button>
      </div>
    </div>
  );
}
