import nodemailer from "nodemailer";
import { env, envBool } from "./env";

function boxes(code: string) {
  return code
    .split("")
    .map(
      (d) =>
        `<td style="width:44px;height:56px;background:#141820;border-radius:12px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:28px;font-weight:700;color:#f4f6fb;letter-spacing:0;">${d}</td>`,
    )
    .join(`<td style="width:8px;font-size:0;">&nbsp;</td>`);
}

function html(code: string) {
  return `<!doctype html>
<html lang="ru">
<body style="margin:0;padding:0;background:#07080c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07080c;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#10131a;border-radius:24px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:44px;height:44px;background:#0055E3;border-radius:14px;text-align:center;font-family:Georgia,serif;font-size:24px;font-weight:700;color:#ffffff;">S</td>
                  <td style="padding-left:12px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;color:#f4f6fb;">Salam</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 0;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:700;color:#f4f6fb;">Код для входа</td>
          </tr>
          <tr>
            <td style="padding:8px 28px 0;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#9aa3b5;">Введите эти 6 цифр в Salam. Код действует 5 минут.</td>
          </tr>
          <tr>
            <td style="padding:22px 28px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>${boxes(code)}</tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:20px;letter-spacing:0.35em;color:#7eb0ff;">${code}</td>
          </tr>
          <tr>
            <td style="padding:18px 28px 0;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#6d7688;">Если вы не входили в Salam, просто удалите это письмо. Никому не пересылайте код.</td>
          </tr>
          <tr>
            <td style="padding:14px 28px 28px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#6d7688;">Кирүү коду — 5 мүнөткө жарактуу.</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Sends the login code. Without SMTP settings the code stays in the server log. */
export async function sendLoginCode(to: string, code: string) {
  const host = env("SMTP_HOST");
  if (!host) {
    console.log(`Salam OTP email ${to} ${code}`);
    return "stub" as const;
  }
  const port = Number(env("SMTP_PORT", "587")) || 587;
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  const from = env("SMTP_FROM", user ? `Salam <${user}>` : "Salam <noreply@salam-chat.ru>");
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: envBool("SMTP_SECURE", port === 465),
    auth: user ? { user, pass } : undefined,
  });
  await transport.sendMail({
    from,
    to,
    subject: "Код для входа в Salam",
    text: `Код для входа в Salam: ${code}\nОн действует 5 минут. Если вы не запрашивали код, проигнорируйте письмо.`,
    html: html(code),
  });
  return "email" as const;
}
