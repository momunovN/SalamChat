# SAMAL

Native messenger for Kyrgyzstan. UI: Russian + Kyrgyz. Dark-first.

```
apps/ios          SwiftUI + GRDB
apps/android      Compose + Room
apps/web          Next.js UI + REST/WS API (Tailwind, Lucide, Postgres)
server            Go API + WebSocket
openapi           REST + realtime contract
docker-compose    optional local Postgres 16, MinIO, LiveKit
```

## Run backend

```
copy .env.example .env
cd server
go mod tidy
go run ./cmd/api
```

Postgres: Neon (`SAMAL_DATABASE_URL`, direct host without `-pooler`). Redis is not used — presence/OTP live in the API process + Postgres. MinIO is optional (uploads skip if it is down). Docker is only needed if you want local Postgres/MinIO instead of Neon.

Health: `GET http://localhost:8080/healthz`

OTP in dev returns `dev_code` (`SAMAL_OTP_DEV=true`). SMS is stub until you set a key — then `sms.ru` or `smsc.ru` (RU + KG). See `.env.example`.

## Clients

- iOS: `cd apps/ios && xcodegen generate && open SAMAL.xcodeproj` (SPM: GRDB)
- Android: open `apps/android` in Android Studio

API default: iOS `127.0.0.1:8080`, Android emulator `10.0.2.2:8080`.

## Web + API (Next.js)

Один сайт: мессенджер в браузере и `/v1` для приложений.

```
cd apps/web
npm install
npm run dev
```

http://localhost:3000 — UI. Health: `GET http://localhost:3000/healthz`.  
Те же пути `/v1/auth/...`, `/v1/chats`, `/v1/ws`. Подробности: `apps/web/README.md`.

Хостинг RelaxDev: `HOSTING.md`. Репозиторий: https://github.com/momunovN/tooApp

## Speed rules

Optimistic UI → SQLite/Room outbox (`client_id` idempotent). Lists virtualized. Animation: opacity/transform ≤ 160ms. Media in S3, not Postgres.

E2EE is phase 2.
