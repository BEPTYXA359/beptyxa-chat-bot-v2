/**
 * Реверс-прокси для LLM API, заблокированных по IP/региону на их edge
 * (Groq блокирует IP датацентров и РФ до аутентификации, Gemini/OpenAI/
 * Anthropic/xAI — регион РФ). Роуты вида /<prefix>/<путь> → <UPSTREAM>/<путь>,
 * корень мапится в корень, поэтому SDK-базовые URL ложатся один в один.
 *
 * Авторизация: заголовок X-Proxy-Token со значением секрета PROXY_TOKEN.
 */

interface Env {
  PROXY_TOKEN?: string;
}

const ROUTES: Record<string, string> = {
  groq: 'https://api.groq.com',
  gemini: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  xai: 'https://api.x.ai',
};

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
]);

/**
 * Собираем чистый набор заголовков: авторизация и content-type клиента идут
 * наверх как есть, а всё, что выдаёт клиента или ломает подмену хоста
 * (cf-*, x-forwarded-*, cookie и hop-by-hop), наверх не передаём.
 */
const buildUpstreamHeaders = (request: Request): Headers => {
  const headers = new Headers();
  for (const [name, value] of request.headers.entries()) {
    const lower = name.toLowerCase();
    const stripped =
      lower === 'host' ||
      lower === 'cookie' ||
      lower === 'x-proxy-token' ||
      lower === 'x-real-ip' ||
      lower === 'forwarded' ||
      lower === 'cdn-loop' ||
      lower === 'accept-encoding' ||
      lower.startsWith('cf-') ||
      lower.startsWith('x-forwarded-') ||
      HOP_BY_HOP_HEADERS.has(lower);

    if (!stripped) {
      headers.set(name, value);
    }
  }
  return headers;
};

const jsonResponse = (body: Record<string, string>, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const prefix = url.pathname.split('/')[1]?.toLowerCase();

    if (!prefix || !ROUTES[prefix]) {
      return jsonResponse(
        {
          error: `Неизвестный роут. Доступны: ${Object.keys(ROUTES).join(', ')}`,
        },
        404,
      );
    }

    if (!env.PROXY_TOKEN) {
      return jsonResponse({ error: 'Секрет PROXY_TOKEN не задан на воркере' }, 503);
    }

    if (request.headers.get('x-proxy-token') !== env.PROXY_TOKEN) {
      return jsonResponse({ error: 'Отсутствует или неверный заголовок X-Proxy-Token' }, 401);
    }

    // slice(+1) отрезает сам префикс, остальной путь и query сохраняют регистр
    const upstreamUrl = ROUTES[prefix] + url.pathname.slice(prefix.length + 1) + url.search;

    const upstreamRequest = new Request(upstreamUrl, {
      method: request.method,
      headers: buildUpstreamHeaders(request),
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    });

    // Ответ возвращаем как есть, не буферизуя — SSE-стриминг проходит насквозь
    return fetch(upstreamRequest);
  },
} satisfies ExportedHandler<Env>;
