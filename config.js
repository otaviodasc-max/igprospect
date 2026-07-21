// IGProspect SaaS — configuração
// Chaves públicas do Supabase (a proteção real é o RLS no banco).
window.IGP_CONFIG = {
  SUPABASE_URL:      'https://guuecwrhwuzbwfetehix.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1dWVjd3Jod3V6YndmZXRlaGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NzA2NjAsImV4cCI6MjA5NzE0NjY2MH0.GISYZrdloR5GGezNwMUMKsdVG5E5VstnXeeAxsNqtOY',
  // Notificações push (Web Push). Chave PÚBLICA VAPID — pode ficar exposta.
  // A chave PRIVADA correspondente vai como secret na Edge Function "notify" (NÃO colocar aqui).
  VAPID_PUBLIC_KEY:  'BA1Oos8-GIpl3JxcOD5yRJt5uf9H_1LaOt7BekaTYvoIZUehfrUt5lEGZmUkxUG3KDCUB3LotlIWEg27KDQrIQQ',
  // URL do Cloudflare Worker que faz proxy DIRETO da API real do Agendor
  // (contorna CORS — o Worker manda access-control-allow-origin:* pra
  // qualquer origem, então funciona tanto no GitHub Pages quanto no Netlify).
  // Nada passa pelo Hub do Corretor aqui — é só Worker -> api.agendor.com.br.
  // O token configurado em Configurações precisa ser o token real da API do
  // Agendor (Configurações do Agendor → Integrações/API), não o do Hub do Corretor.
  AGENDOR_PROXY_URL: 'https://sweet-butterfly-7f2b.otaviodasc.workers.dev',
};
