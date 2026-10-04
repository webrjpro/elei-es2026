/**
 * Apuração 2026 — proxy/cache opcional (Cloudflare Workers, plano gratuito).
 *
 * Por quê: com milhares de visitantes, o TSE recebe 1 requisição a cada ~10 s por arquivo
 * (vinda do cache da borda), e não 1 por visitante. Também serve de rota alternativa se
 * o acesso direto ao TSE falhar no navegador de algum visitante.
 *
 * Deploy (5 min):
 *   1. https://dash.cloudflare.com → Workers & Pages → Create → "Hello World" Worker
 *   2. Cole este arquivo, clique em Deploy
 *   3. Em js/config.js: proxy: 'https://SEU-WORKER.workers.dev/?url='
 */
const ALLOWED_HOST = 'resultados.tse.jus.br';
const EDGE_TTL = 10; // segundos

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors() });

    const target = new URL(request.url).searchParams.get('url');
    let url;
    try { url = new URL(target); } catch (_) { return new Response('Parâmetro url inválido', { status: 400, headers: cors() }); }

    // Só repassa arquivos oficiais do TSE (impede uso do proxy para outros fins).
    if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST || !url.pathname.startsWith('/oficial/') || !/\.json$/.test(url.pathname)) {
      return new Response('Destino não permitido', { status: 403, headers: cors() });
    }

    const cache = caches.default;
    const key = new Request(url.toString(), { method: 'GET' });
    let res = await cache.match(key);
    if (!res) {
      const upstream = await fetch(url.toString(), { headers: { 'User-Agent': 'Apuracao2026-Proxy' } });
      res = new Response(upstream.body, upstream);
      res.headers.set('Cache-Control', `public, max-age=${EDGE_TTL}`);
      if (upstream.ok) ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors())) out.headers.set(k, v);
    return out;
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Expose-Headers': 'ETag, Last-Modified'
  };
}
