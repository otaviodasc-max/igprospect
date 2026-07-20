// background.js — IGProspect service worker
// Handles cross-origin API requests to avoid CORS issues from content script

// Chaves PÚBLICAS do Supabase (mesmas do config.js do painel) — a extensão
// não faz login; usa a chave anônima só pra resolver o código da equipe.
const SUPABASE_URL = 'https://guuecwrhwuzbwfetehix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1dWVjd3Jod3V6YndmZXRlaGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NzA2NjAsImV4cCI6MjA5NzE0NjY2MH0.GISYZrdloR5GGezNwMUMKsdVG5E5VstnXeeAxsNqtOY';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'resolve_org_code') {
    const code = String(msg.code || '').trim();
    if (!code) { sendResponse({ ok: false, error: 'Código vazio' }); return; }

    fetch(`${SUPABASE_URL}/rest/v1/rpc/org_by_join_code`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_code: code }),
    })
      .then(async r => {
        const data = await r.json().catch(() => null);
        const org = Array.isArray(data) && data[0] ? data[0] : null;
        sendResponse({ ok: r.ok && !!org, org });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));

    return true; // keep message channel open for async response
  }

  if (msg.type === 'agendor_create_person') {
    const { token, person } = msg;

    fetch('https://api.agendor.com.br/v3/people', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: person.name,
        contact: {
          mobile: person.phone || '',
          instagram: person.instagram || '',
        },
        description: [
          person.niche    ? `Nicho: ${person.niche}`          : '',
          person.mutual   ? `Amigos em comum: ${person.mutual}`: '',
          person.notes    ? `Obs: ${person.notes}`             : '',
          person.profileUrl ? `Perfil: ${person.profileUrl}`  : '',
        ].filter(Boolean).join('\n'),
      }),
    })
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        sendResponse({ ok: r.ok, status: r.status, data });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));

    return true; // keep message channel open for async response
  }

});
