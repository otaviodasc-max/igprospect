// IGProspect SaaS — configuração
// Chaves públicas do Supabase (a proteção real é o RLS no banco).
window.IGP_CONFIG = {
  SUPABASE_URL:      'https://guuecwrhwuzbwfetehix.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1dWVjd3Jod3V6YndmZXRlaGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NzA2NjAsImV4cCI6MjA5NzE0NjY2MH0.GISYZrdloR5GGezNwMUMKsdVG5E5VstnXeeAxsNqtOY',
  // Notificações push (Web Push). Chave PÚBLICA VAPID — pode ficar exposta.
  // A chave PRIVADA correspondente vai como secret na Edge Function "notify" (NÃO colocar aqui).
  VAPID_PUBLIC_KEY:  'BA1Oos8-GIpl3JxcOD5yRJt5uf9H_1LaOt7BekaTYvoIZUehfrUt5lEGZmUkxUG3KDCUB3LotlIWEg27KDQrIQQ',
  // URL do Cloudflare Worker que faz proxy da API do CRM (contorna CORS — o
  // Worker manda access-control-allow-origin:* pra qualquer origem, então
  // funciona no GitHub Pages, que é onde o sistema roda de verdade).
  //
  // O Worker aponta pro HUB DO CORRETOR (https://hubcorretorconsorcio.com.br
  // /api/agendor/v3), que expõe uma API no dialeto do Agendor. Fonte do Worker
  // versionada em worker/hub-proxy.js — republicar lá depois de editar.
  //
  // Por que manter o proxy em vez de chamar o Hub direto: o Hub libera CORS só
  // pra *.netlify.app, e o deploy oficial é otaviodasc-max.github.io. O Hub é
  // de terceiro (não mexemos nele), então o Worker é o ponto de controle nosso.
  //
  // O token configurado em Configurações é o TOKEN PESSOAL DO HUB
  // (Hub → CRM → Configurações → aba "Token da API" → Mostrar/Copiar).
  // Não é mais o token da API do Agendor.
  AGENDOR_PROXY_URL: 'https://sweet-butterfly-7f2b.otaviodasc.workers.dev',
  // Fallback usado só se o Worker estiver vazio/fora do ar.
  HUB_API_BASE: 'https://hubcorretorconsorcio.com.br/api/agendor/v3',
};
