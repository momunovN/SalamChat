# Handoff — TooApp (too-app.ru)

**Дата:** 2026-09-27
**Ветка:** `main`
**Репо:** https://github.com/momunovN/tooApp
**Сайт / API:** https://too-app.ru
**Прод:** RelaxDev + Neon PostgreSQL
**Figma:** https://www.figma.com/design/1MlHF63Z8m006x2gD47zCQ
**Бренд:** Too (кыргызское «тоо» — гора). В коде ещё встречаются Samal / SAMAL / Bluepeak — старые имена, не плодить новые.

---

## Правило: после каждой готовой работы — сразу деплой

1. `git add` → `git commit` → `git push origin main`
2. RelaxDev: rootDir = `apps/web`, автодетект Next.js, `npm run build` → `npm start` (см. `HOSTING.md`)
3. Не коммитить `.env`, пароли, JWT, SMS-ключи
4. Не останавливаться на переименовании пакета `dev.samal.app`, пока не закрыт текущий баг

---

## Стек

```
apps/ios       SwiftUI + GRDB
apps/android   Compose + Room   пакет пока dev.samal.app
apps/web       Next.js UI + REST/WS /v1
server         Go API + WebSocket
openapi        контракт
```

Клиент не ходит в Postgres напрямую. Source of truth — сервер. Скорость UI — локальный SQLite/Room + optimistic outbox (`client_id`).

---

## Что уже сделано

### Инфраструктура
- Neon PostgreSQL (`TOOAPP_DATABASE_URL` / `DATABASE_URL`, **direct host без `-pooler`**)
- RelaxDev: папка `apps/web`, без Dockerfile
- Valkey/Redis опционально (`REDIS_URL` / `TOOAPP_VALKEY_URL`). Нет адреса — сообщения сразу в Postgres
- MinIO / S3 опционально
- OTP в dev: `TOOAPP_OTP_DEV=true` → `dev_code`. SMS stub без ключа

### Клиенты

| Область | Статус |
| --- | --- |
| Телефон + OTP | готово |
| Онбординг профиля | готово |
| Список чатов | готово |
| Чат текст | готово |
| Контакты | готово |
| i18n ru + ky | каркас |
| Голос / файлы / фото | частично |
| WebRTC звонки | каркас LiveKit |
| E2EE | phase 2 |

### Дизайн
- Dark `#0B0D10` / `#14181E` / accent `#2B6BFF`
- Анимация только opacity/transform ≤ 160ms
- NEVER glassmorphism и blur на ленте

### Android Gradle
- JDK: Temurin 21. Не 25/27 и не `jbr-17 [Invalid]`

## Следующие шаги
- Attach + voice на клиентах
- LiveKit SFU
- Rename `dev.samal.app` → `dev.too.app` одним PR
- Боевой SMS

## Команды
```bash
cd server && go run ./cmd/api
cd apps/web && npm run dev
git push origin main
```
