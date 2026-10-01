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
