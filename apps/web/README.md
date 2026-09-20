# SAMAL Web + API

Веб-мессенджер и тот же REST/realtime API, что и у iOS/Android.

- Next.js + Tailwind + Lucide
- Prisma + Postgres (Neon, тот же SQL, что у Go-сервера)
- Auth: телефон + OTP
- UI: ru / ky, тёмная тема

## Запуск

Из корня репозитория уже должен быть `.env` с `SAMAL_DATABASE_URL` (Neon, direct host без `-pooler`).

```
cd apps/web
npm install
npm run dev
```

Откройте http://localhost:3000

- `GET /healthz` → `{"ok":true,"name":"samal"}`
- REST: `/v1/...` (контракт как в `openapi/samal.yaml`)
- Realtime: `GET /v1/ws?token=...` (WebSocket) или `GET /v1/stream?token=...` (SSE)

OTP в dev приходит в ответе (`dev_code`). SMS никуда не уходит, ключ не нужен.

Реальная SMS на РФ и Кыргызстан: `SMS_PROVIDER=smsru` и `SMS_API_KEY` с [sms.ru](https://sms.ru/?panel=api), либо `SMS_PROVIDER=smsc` + `SMS_LOGIN` + `SMS_API_KEY` с [smsc.ru](https://smsc.ru/api/). В проде `SAMAL_OTP_DEV=false`.

## Приложения

iOS и Android могут бить в этот же origin вместо `:8080`:

- iOS: `http://127.0.0.1:3000`
- Android emulator: `http://10.0.2.2:3000`

Не запускайте Go API и этот процесс на одном порту. База одна и та же.

## Сборка

```
npm run build
npm start
```
