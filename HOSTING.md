# Деплой Salam (salam-chat) на RelaxDev

Прод: **https://salam-chat.ru** (сайт и `/v1` на одном домене). Health: `GET https://salam-chat.ru/healthz`.

Сайт и API живут вместе. После деплоя:

- UI: `https://<имя>.relaxdev.ru`
- API: `https://<имя>.relaxdev.ru/v1/...`
- Health: `https://<имя>.relaxdev.ru/healthz`

## 1. GitHub

Репозиторий: https://github.com/momunovN/tooApp

## 2. RelaxDev

1. relaxdev.ru → **Добавить проект**
2. Репозиторий `momunovN/tooApp`, ветка `main`
3. **Папка проекта (rootDir):** `apps/web`
4. Стек: автоопределение (Next.js / Node). Docker не нужен
5. Сборка: `npm install` / `npm run build`. Старт: `npm start`
6. Автодеплой включить

Приложение слушает **PORT** из окружения (RelaxDev ставит `8080`).

## 3. Переменные окружения

Имена теперь начинаются с `SALAM_`. Старые `TOOAPP_*` продолжают работать, поэтому менять их в панели можно не спеша; если заданы оба, берётся `SALAM_*`.

Скопируйте ключи из `apps/web/.env.relaxdev.example` во вкладку **Переменные**.

Обязательно:

| Ключ | Значение |
|---|---|
| `SALAM_PUBLIC_URL` | `https://salam-chat.ru` |
| `SALAM_JWT_SECRET` | длинный случайный секрет |
| `SALAM_OTP_DEV` | `false` в проде |
| `DATABASE_URL` | строка Postgres |
| `SALAM_DATABASE_URL` | та же строка |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | Яндекс, иначе код на почту не уйдёт |
| `SMS_PROVIDER` `SMS_API_KEY` | `p1sms` и ключ кабинета, иначе вход только по почте |
| `LIVEKIT_URL` `LIVEKIT_API_KEY` `LIVEKIT_API_SECRET` | звонки. Пустые ключи дают токен-заглушку |
| `TURN_URL` `TURN_USERNAME` `TURN_CREDENTIAL` | необязательно. Пусто: TURN отдаёт LiveKit Cloud |

База: либо **База данных** в RelaxDev (тогда `DATABASE_URL` появится сам), либо ваш Neon.

После смены переменных — редеплой.

Быстрые сообщения идут через Valkey. Docker в репозитории не нужен: в панели проекта откройте **Redis** и подключите его. RelaxDev сам добавит `REDIS_URL`. Приложение читает `SALAM_VALKEY_URL`, затем `VALKEY_URL`, затем `REDIS_URL`. Локально без Docker Valkey слушает `127.0.0.1:6379`. Если адреса нет, сообщения пишутся сразу в Postgres.

## 4. Проверка

```
GET https://<имя>.relaxdev.ru/healthz
→ {"ok":true,"name":"salam","valkey":"up"}
```

`valkey` равен `down`, пока в панели не подключён Redis. Один процесс при этом чат ведёт, второй инстанс сообщения соседу не разнесёт.

Приложения: база API = `https://<имя>.relaxdev.ru`.

## 5. Пуш-уведомления на Android (Firebase)

Без этого Android получает сообщения и звонки, только пока приложение работает. С Firebase
телефон будит пуш, даже если приложение закрыто. Пока ключей нет, всё работает как раньше.

1. https://console.firebase.google.com → создать проект (Analytics не нужна).
2. Добавить Android-приложение с пакетом `dev.samal.app`. Скачать `google-services.json`
   и положить в `apps/android/app/google-services.json`, пересобрать APK.
   Плагин google-services не нужен: сборка сама читает этот файл.
3. Project settings → Service accounts → Generate new private key. Скачанный JSON целиком
   (или в base64) положить в переменную RelaxDev `FCM_SERVICE_ACCOUNT` и сделать редеплой.
   Это секрет: в репозиторий не коммитить.

Проверка: войти в приложение на телефоне, закрыть его, написать с сайта — должно прийти
уведомление. Звонок на закрытое приложение показывает экран входящего звонка.

## 6. Сервер звонков (LiveKit) — свой, в Москве

LiveKit Cloud (Франкфурт) из России без VPN не работает: фильтры трафика замораживают
сигнальное соединение после первых килобайт — звонок «соединяется», но нет звука и собеседника.
Поэтому звонки идут через свой LiveKit на VPS в России.

- VPS: Timeweb Cloud, Москва, Ubuntu 24.04, IP `72.56.232.83` (вход `ssh root@72.56.232.83` по ключу).
- DNS в reg.ru: A-записи `livekit` и `turn` → `72.56.232.83`. В RelaxDev эти домены НЕ добавлять.
- LiveKit 1.13 — служба `livekit` (`/etc/livekit/livekit.yaml`, ключи в `/etc/livekit/keys.env`).
- Caddy выдаёт HTTPS для `livekit.salam-chat.ru` (wss) и сертификат для TURN `turn.salam-chat.ru`;
  LiveKit перезапускается по понедельникам (`livekit-reload.timer`), чтобы подхватить продлённый сертификат.
- Порты (ufw): TCP 22, 80, 443, 7881, 5349; UDP 3478, 30000–40000 (TURN), 50000–60000 (медиа).
- В RelaxDev: `LIVEKIT_URL=wss://livekit.salam-chat.ru`, `LIVEKIT_API_KEY` и `LIVEKIT_API_SECRET` — из `keys.env`.
  Приложения берут адрес и токен у сервера сайта, их обновлять не нужно.

Проверка: `systemctl status livekit caddy`; звонок с телефона без VPN.
