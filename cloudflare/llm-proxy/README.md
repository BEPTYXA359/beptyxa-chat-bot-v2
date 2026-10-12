# llm-proxy

Cloudflare Worker — реверс-прокси для LLM API, заблокированных по IP/региону.
Основная задача: бот ходит в Groq через воркер (Groq блокирует IP датацентров
и РФ на edge, до проверки API-ключа). Заодно даёт личный доступ к другим
заблокированным API из РФ.

## Роуты

| Префикс      | Upstream                                  |
| ------------ | ----------------------------------------- |
| `/groq/`     | `https://api.groq.com`                    |
| `/gemini/`   | `https://generativelanguage.googleapis.com` |
| `/openai/`   | `https://api.openai.com`                  |
| `/anthropic/`| `https://api.anthropic.com`               |
| `/xai/`      | `https://api.x.ai`                        |

Корень мапится в корень, поэтому базовый URL SDK указывается с полным префиксом.
Новый провайдер = одна строка в `ROUTES` (`src/index.ts`).

Все запросы требуют заголовок `X-Proxy-Token` со значением воркер-секрета
`PROXY_TOKEN`. OpenRouter и HuggingFace из РФ работают напрямую — в прокси не нужны.

## Деплой

Автоматический: push в `main` с изменениями в `cloudflare/llm-proxy/**`
(workflow `.github/workflows/deploy-worker.yml`). Секреты воркера берутся из
GitHub Secrets: `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `PROXY_TOKEN`.

Воркер — npm-workspace корневого репозитория: свой `package.json`, но общий
`node_modules` и lockfile в корне (зависимости ставятся `npm ci` из корня).
Wrangler в прод-образ бота не попадает (в Dockerfile `npm ci --omit=dev`).

Ручной вариант (нужен разовый `wrangler login`):

```bash
npm ci                      # из корня репо (workspaces)
cd cloudflare/llm-proxy
npx wrangler login
npx wrangler deploy
echo "<PROXY_TOKEN>" | npx wrangler secret put PROXY_TOKEN
```

Для локальной отладки: положить `.dev.vars` рядом с `wrangler.toml`
(`PROXY_TOKEN=dev-token`) и запустить `npm run dev` из папки. Если новый npm
блокирует postinstall-скрипты (`allow-scripts` warning), выполнить
`npm approve-scripts workerd` — без бинарника workerd локальный `wrangler dev`
не запустится (на деплой не влияет).

## Использование

Реальный URL воркера нигде в репо не хранится — он в GitHub Secrets (`GROQ_BASE_URL`)
и в серверном/локальном `.env`. Ниже `<subdomain>` — плейсхолдер.

Бот (Groq) — в `.env` (именно `/groq`, без `/openai/v1` — groq-sdk допишет `/openai/v1/...` сам):

```
GROQ_BASE_URL=https://llm-proxy.<subdomain>.workers.dev/groq
GROQ_PROXY_TOKEN=<PROXY_TOKEN>
```

Curl из РФ (без VPN):

```bash
# Groq
curl -H "X-Proxy-Token: $PROXY_TOKEN" \
     -H "Authorization: Bearer $GROQ_API_KEY" \
     https://llm-proxy.<subdomain>.workers.dev/groq/openai/v1/models

# Gemini
curl -H "X-Proxy-Token: $PROXY_TOKEN" \
     -H "x-goog-api-key: $GEMINI_API_KEY" \
     https://llm-proxy.<subdomain>.workers.dev/gemini/v1beta/models
```

SDK: groq-sdk — `new Groq({ baseURL: '<worker>/groq' })` (как и в .env — без `/openai/v1`,
SDK допишет сам); openai — `baseURL: '<worker>/openai/v1'`; @google/genai — `httpOptions: { baseUrl: '<worker>/gemini' }`;
Anthropic — `baseURL: '<worker>/anthropic'`; xAI — `baseURL: '<worker>/xai/v1'`.

## Ротация PROXY_TOKEN

```bash
echo "<новый>" | npx wrangler secret put PROXY_TOKEN   # или через CI: gh secret set PROXY_TOKEN + повторный деплой
# затем обновить GROQ_PROXY_TOKEN в GitHub Secrets и локальном .env
```
