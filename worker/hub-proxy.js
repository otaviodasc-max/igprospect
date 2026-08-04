/* =====================================================================
   IGProspect — Cloudflare Worker de proxy pro CRM (Hub do Corretor)
   =====================================================================
   Publicado em: https://sweet-butterfly-7f2b.otaviodasc.workers.dev
   (é o valor de AGENDOR_PROXY_URL no config.js)

   POR QUE ESSE WORKER EXISTE
   O Hub do Corretor libera CORS apenas pra *.netlify.app, mas o IGProspect
   roda em https://otaviodasc-max.github.io (GitHub Pages). O Hub é sistema
   de terceiro — não mexemos nele. Então o Worker fica no meio: o browser
   fala com o Worker (que libera CORS pra qualquer origem) e o Worker fala
   com o Hub server-to-server, onde CORS não se aplica.

   Bônus: se o Hub mudar rota ou formato, dá pra consertar aqui sem depender
   de ninguém e sem republicar o painel.

   O QUE ELE FAZ
   - Repassa qualquer /caminho pra HUB_BASE/caminho, preservando querystring.
   - Repassa o header Authorization como veio (o painel manda o token pessoal
     do Hub; ele tenta "Token <t>" e cai pra "Bearer <t>" se tomar 401).
   - Responde ao preflight OPTIONS.

   COMO PUBLICAR
   Cole este arquivo no editor do Worker no painel da Cloudflare e faça Deploy.
===================================================================== */

const HUB_BASE = 'https://hubcorretorconsorcio.com.br/api/agendor/v3';

// Aberto de propósito: o Worker não guarda segredo nenhum. O token vai no
// header, vem do usuário e é validado pelo Hub — quem não tem token não
// consegue nada aqui. Fechar por origem só quebraria previews e o app local.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const target = HUB_BASE + url.pathname + url.search;

    const headers = new Headers();
    const auth = request.headers.get('Authorization');
    if (auth) headers.set('Authorization', auth);
    headers.set('Content-Type', 'application/json');
    headers.set('Accept', 'application/json');

    let upstream;
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers,
        // GET/HEAD não podem ter corpo — mandar undefined evita TypeError.
        body: (request.method === 'GET' || request.method === 'HEAD')
          ? undefined
          : await request.text(),
      });
    } catch (err) {
      // Sem isso o browser via só "Failed to fetch" e o painel culpava o CORS,
      // quando na verdade o Hub é que estava fora do ar.
      return new Response(
        JSON.stringify({ errors: ['Falha ao falar com o CRM: ' + err.message] }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // Repassa status e corpo crus — o painel já sabe ler {data:...} e {errors:...}.
    const out = new Headers(CORS);
    out.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
