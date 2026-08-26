# Beptyxa Chat Bot V2

> [@BeptyxaChatBot](https://t.me/BeptyxaChatBot)

![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=nodedotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript)
![grammY](https://img.shields.io/badge/grammY-1.44-2DA1C0?style=flat-square&logo=telegram)
![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?style=flat-square&logo=mongodb)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?style=flat-square&logo=fastify)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker)

## Возможности

* **🤖 AI-чат** — общение через OpenAI (GPT) и Groq (Llama) с поддержкой streaming в приватных чатах
* **💱 Конвертация валют** — естественный язык (`конвертер 100 usd в тенге`), курсы с кэшированием и автообновлением
* **🎮 Цены Steam** — ссылка на игру → цены в KZT/RUB со всеми изданиями и DLC
* **🔍 Inline-режим** — `@BeptyxaChatBot <запрос>` из любого чата: сам определяет валюту, вопрос или Steam
* **⏰ Напоминания** — разовые, ежедневные, по дням недели, через день с учётом часового пояса и catch-up пропущенных
* **🚗 Номера машин** — сохранение автомобильных номеров и владельцев через Mini App: авто-нормализация латиницы-двойников, уникальность номера в рамках чата
* **⚙️ Telegram Mini App** — веб-приложение для управления API-ключами, системным промптом, напоминаниями и номерами машин
* **💬 Chatterbox** — случайные AI-ответы в группах с настраиваемой вероятностью

## Стек

* **Runtime:** Node.js 22+, TypeScript 5.9 (strict mode)
* **Bot Framework:** grammY (`auto-retry`, `stream`)
* **Web Server:** Fastify 5 (REST API для Mini App)
* **Database:** MongoDB 7
* **AI Providers:** OpenAI SDK, Groq SDK
* **Task Scheduling:** Agenda (Mongo-based), node-schedule
* **Validation & Security:** Zod, AES-256-CBC (шифрование API-ключей), HMAC-SHA-256 (Telegram initData)
* **Infrastructure:** Docker (multi-stage), Docker Compose, GitHub Actions (CI/CD → SSH deploy)

---

## Быстрый запуск

### 1. Клонирование и установка зависимостей

```bash
git clone https://github.com/BEPTYXA359/beptyxa-chat-bot-v2.git
cd beptyxa-chat-bot-v2
npm ci
```

### 2. Настройка переменных окружения

```bash
cp .env.example .env
```

Заполните все обязательные поля:

```env
BOT_TOKEN = your_telegram_bot_token
EXCHANGE_APP_ID = your_openexchangerates_app_id
MONGO_URI = mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority
MONGO_DB_NAME = test
ENCRYPTION_KEY = your_32_character_key_here
GROQ_API_KEY = your_groq_api_key
GROQ_MODEL = openai/gpt-oss-20b
PORT = 3000
APP_URL = https://your-ngrok-url.ngrok-free.dev
APP_SHORTNAME = app
```

### 3. Запуск в режиме разработки

```bash
npm run dev
```

---

## Сборка и проверка типов

```bash
# Проверка типов без генерации кода
npm run typecheck

# Продакшен-сборка
npm run build

# Запуск собранного приложения
npm start
```

## Docker

```bash
docker-compose up -d --build
```
