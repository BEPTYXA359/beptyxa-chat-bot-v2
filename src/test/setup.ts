// CI запускает тесты без .env, а shared/config парсит env на импорте —
// сеем дамми-значения только для отсутствующих ключей (??= не перекрывает
// ни локальный .env, ни секреты). Значения валидны по схеме config.
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_ENV = 'development';
}

const testEnv: Record<string, string> = {
  BOT_TOKEN: 'test-bot-token',
  EXCHANGE_APP_ID: 'test-exchange-app-id',
  MONGO_URI: 'mongodb://127.0.0.1:27017',
  MONGO_DB_NAME: 'beptyxa-bot-test',
  ENCRYPTION_KEY: 'a'.repeat(32),
  GROQ_API_KEY: 'test-groq-api-key',
  GROQ_MODEL: 'test-groq-model',
  APP_URL: 'https://t.me/beptyxa_bot',
};

for (const [key, value] of Object.entries(testEnv)) {
  process.env[key] ??= value;
}
