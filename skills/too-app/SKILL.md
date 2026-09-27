---
name: too-app
description: Rules and handoff for TooApp messenger (too-app.ru, repo momunovN/tooApp). Use when building, fixing, deploying, or renaming Too / TooApp / Samal Android iOS web Go chat, OTP, WebSocket, RelaxDev, Neon, Gradle JDK.
---

# TooApp agent skill

Work as staff engineer on https://github.com/momunovN/tooApp. Read /HANDOFF.md before large changes.

## Product
- Name in UI: Too
- Market: Kyrgyzstan. UI languages: ru + ky
- Native apps + Next.js web on the same /v1 API
- Fast like Telegram. Optimistic send. No phone-to-Postgres

## Non-negotiable rules
- After a finished slice: commit + push main. RelaxDev deploys apps/web
- Never commit secrets
- Never add glassmorphism or blur on the chat list
- Animate only opacity/transform, max 160ms
- New messages need client_id for idempotency
- Media metadata in Postgres, blobs in object storage
- Do not invent a fourth brand name. Too is current. Samal/Bluepeak are legacy

## Where to edit
- Android: apps/android — package still dev.samal.app
- iOS: apps/ios/SAMAL
- Web + hosted API: apps/web
- Go API: server
- Contract: openapi

## Android Studio
Gradle JDK must be Temurin 21. Reject 25/27 and jbr-17 Invalid.

## Deploy
Root on RelaxDev is apps/web. Prod URL https://too-app.ru. Health GET /healthz.
