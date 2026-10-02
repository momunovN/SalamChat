import type { Metadata } from "next";
import Link from "next/link";
import { Download, Smartphone } from "lucide-react";
import { ANDROID_APK_URL, ANDROID_RELEASES_URL } from "@/lib/download";

export const metadata: Metadata = {
  title: "Скачать Salam для Android",
  description: "Установочный файл мессенджера Salam для Android-телефонов.",
};

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-muted">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ol>
  );
}

export default function DownloadPage() {
  return (
    <main className="min-h-dvh bg-bg px-4 py-10 text-ink">
      <article className="mx-auto max-w-md">
        <Link href="/" className="text-sm font-semibold text-accent">
          Salam
        </Link>

        <div className="mt-6 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-white">
            <Smartphone size={24} />
          </span>
          <div>
            <h1 className="text-2xl font-bold">Salam для Android</h1>
            <p className="text-sm text-muted">Тестовая версия · ~70 МБ</p>
          </div>
        </div>

        <a
          href={ANDROID_APK_URL}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent font-semibold text-white hover:opacity-90"
        >
          <Download size={18} /> Скачать APK
        </a>
        <p className="mt-2 text-center text-xs text-muted">Android 8.0 и новее</p>

        <h2 className="mt-8 text-lg font-semibold">Как установить</h2>
        <Steps
          items={[
            "Нажмите «Скачать APK» и дождитесь загрузки.",
            "Откройте скачанный файл salam.apk.",
            "Если телефон спросит — разрешите установку из этого источника.",
            "Откройте Salam и войдите по почте или номеру.",
          ]}
        />
        <p className="mt-3 text-sm leading-6 text-muted">
          Обновление — так же: скачайте новый файл и установите поверх. Если установка не идёт из‑за подписи, удалите старую
          версию и поставьте заново.
        </p>

        <h2 className="mt-10 text-lg font-semibold">Android үчүн Salam</h2>
        <Steps
          items={[
            "«Скачать APK» баскычын басып, жүктөлүп бүтүшүн күтүңүз.",
            "Жүктөлгөн salam.apk файлын ачыңыз.",
            "Телефон сураса — ушул булактан орнотууга уруксат бериңиз.",
            "Salam'ды ачып, почта же номер менен кириңиз.",
          ]}
        />

        <p className="mt-10 text-sm leading-6 text-muted">
          iPhone: пока пользуйтесь сайтом{" "}
          <Link className="text-accent" href="/">
            salam-chat.ru
          </Link>{" "}
          в Safari. Все версии:{" "}
          <a className="text-accent" href={ANDROID_RELEASES_URL}>
            список выпусков
          </a>
          .
        </p>
      </article>
    </main>
  );
}
