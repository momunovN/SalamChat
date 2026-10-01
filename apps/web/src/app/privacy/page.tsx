import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Политика — Salam",
  description: "Какие данные хранит мессенджер Salam и зачем.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-bg px-4 py-10 text-ink">
      <article className="mx-auto max-w-md">
        <Link href="/" className="text-sm font-semibold text-accent">
          Salam
        </Link>
        <h1 className="mt-6 text-3xl font-bold">Политика</h1>
        <div className="mt-4 space-y-3 text-sm leading-6 text-muted">
          <p>
            Salam хранит то, без чего мессенджер не работает: почту и номер, если вы его указали, имя, ник, текст «о себе», дату
            рождения и адрес, если вы их заполнили. Ещё — сообщения, файлы и сведения о звонках, чтобы доставить их участникам чата.
          </p>
          <p>Код для входа живёт 5 минут и нужен только чтобы открыть сессию. Его просят при входе по почте или SMS и при звонке — на микрофон и камеру.</p>
          <p>Данные не продаются. История открывается вам после входа. Вопрос по данным можно оставить на salam-chat.ru.</p>
        </div>
        <h2 className="mt-10 text-3xl font-bold">Эрежелер</h2>
        <div className="mt-4 space-y-3 text-sm leading-6 text-muted">
          <p>
            Salam мессенджер иштеши үчүн керектүү нерсени сактайт: почтаны жана номерди, эгер жазсаңыз, атты, ник, өзүңүз жөнүндө
            текст, туулган күн жана даректи. Ошондой эле билдирүүлөрдү, файлдарды жана чалуу тууралуу маалыматты — аларды чаттын
            катышуучуларына жеткирүү үчүн.
          </p>
          <p>Кирүү коду 5 мүнөт жашайт жана сессияны ачуу үчүн гана керек. Аны почта же SMS менен киргенде сурайт, чалууда — микрофон менен камераны.</p>
          <p>Маалымат сатылбайт. Таржымал киргенден кийин сизге ачылат. Суроону salam-chat.ru аркылуу калтырсаңыз болот.</p>
        </div>
        <p className="mt-8 text-sm">
          <Link className="text-accent" href="/about">
            Как это работает
          </Link>
        </p>
      </article>
    </main>
  );
}
