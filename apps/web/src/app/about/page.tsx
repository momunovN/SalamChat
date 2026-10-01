import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Как это работает — Salam",
  description: "Salam — мессенджер. Вход по почте или SMS, чаты, голосовые и звонки.",
};

export default function AboutPage() {
  return (
    <main className="min-h-dvh bg-bg px-4 py-10 text-ink">
      <article className="mx-auto max-w-md">
        <Link href="/" className="text-sm font-semibold text-accent">
          Salam
        </Link>
        <h1 className="mt-6 text-3xl font-bold">Как это работает</h1>
        <div className="mt-4 space-y-3 text-sm leading-6 text-muted">
          <p>Salam — мессенджер. Войти можно по почте или по номеру Кыргызстана и России. Код приходит письмом или SMS.</p>
          <p>Дальше — чаты, голосовые, фото, файлы, группы и звонки.</p>
          <p>Звонок идёт в браузере: нужны микрофон и камера. Если на сервере не задан сервис звонков, соединение не установится.</p>
          <p>Сайт открывается в браузере, его можно добавить на экран телефона. Приложений в App Store и Google Play пока нет.</p>
          <p>
            Сообщения на сервере хранятся в зашифрованном виде. Это не секретный чат: после входа сервер открывает историю вашей
            учётной записи.
          </p>
        </div>
        <h2 className="mt-10 text-3xl font-bold">Кантип иштейт</h2>
        <div className="mt-4 space-y-3 text-sm leading-6 text-muted">
          <p>Salam — мессенджер. Почта же Кыргызстан менен Россиянын номери менен кирсе болот. Код кат же SMS менен келет.</p>
          <p>Андан кийин чат, үн билдирүү, сүрөт, файл, топ жана чалуу.</p>
          <p>Чалуу браузер аркылуу жүрөт: микрофон жана камера керек. Серверде чалуу кызматы өчүк болсо, байланыш түзүлбөйт.</p>
          <p>Сайт браузерде ачылат, аны телефондун экранына кошууга болот. App Store менен Google Playде азырынча колдонмо жок.</p>
          <p>Билдирүүлөр серверде шифрленип сакталат. Бул жашыруун чат эмес: киргенден кийин сервер сиздин таржымалды ачат.</p>
        </div>
        <p className="mt-8 text-sm">
          <Link className="text-accent" href="/privacy">
            Политика
          </Link>
        </p>
      </article>
    </main>
  );
}
