# Деплой TooApp на RelaxDev

Прод: **https://too-app.ru** (сайт и `/v1` на одном домене). Health: `GET https://too-app.ru/healthz`.

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

Скопируйте ключи из `apps/web/.env.relaxdev.example` во вкладку **Переменные**.

Обязательно:

| Ключ | Значение |
|---|---|
| `TOOAPP_PUBLIC_URL` | `https://<имя>.relaxdev.ru` |
| `TOOAPP_JWT_SECRET` | длинный случайный секрет |
| `TOOAPP_OTP_DEV` | `false` в проде |
| `DATABASE_URL` | строка Postgres |
| `TOOAPP_DATABASE_URL` | та же строка |

База: либо **База данных** в RelaxDev (тогда `DATABASE_URL` появится сам), либо ваш Neon.

После смены переменных — редеплой.

## 4. Проверка

```
GET https://<имя>.relaxdev.ru/healthz
→ {"ok":true,"name":"tooapp"}
```

Приложения: база API = `https://<имя>.relaxdev.ru`.
