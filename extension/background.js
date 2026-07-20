// background.js — IGProspect service worker
// Handles cross-origin API requests to avoid CORS issues from content script

// Chaves PÚBLICAS do Supabase (mesmas do config.js do painel) — a extensão
// não faz login; usa a chave anônima só pra resolver o código da equipe.
const SUPABASE_URL = 'https://guuecwrhwuzbwfetehix.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1dWVjd3Jod3V6YndmZXRlaGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NzA2NjAsImV4cCI6MjA5NzE0NjY2MH0.GISYZrdloR5GGezNwMUMKsdVG5E5VstnXeeAxsNqtOY';

// Chama uma função RPC do Supabase com a chave pública (sem login).
function callRpc(name, body) {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'resolve_org_code') {
    const code = String(msg.code || '').trim();
    if (!code) { sendResponse({ ok: false, error: 'Código vazio' }); return; }

    callRpc('org_by_join_code', { p_code: code })
      .then(async r => {
        const data = await r.json().catch(() => null);
        const org = Array.isArray(data) && data[0] ? data[0] : null;
        sendResponse({ ok: r.ok && !!org, org });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));

    return true; // keep message channel open for async response
  }

  // Lista os membros ATIVOS da equipe (pra extensão perguntar "quem é
  // você" na hora de conectar — sem isso, "prospectado por" fica em branco).
  if (msg.type === 'resolve_org_members') {
    const code = String(msg.code || '').trim();
    if (!code) { sendResponse({ ok: false, error: 'Código vazio' }); return; }

    callRpc('org_members_by_join_code', { p_code: code })
      .then(async r => {
        const data = await r.json().catch(() => null);
        sendResponse({ ok: r.ok && Array.isArray(data), members: Array.isArray(data) ? data : [] });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));

    return true;
  }

  // Grava o lead direto no banco, na hora — não depende do painel estar
  // aberto (nem em qual equipe ele está). Reconfirma o código por dentro
  // da função (ver org_by_join_code/extension_add_lead no Supabase).
  if (msg.type === 'add_lead_direct') {
    const { code, lead, userId } = msg;
    callRpc('extension_add_lead', {
      p_code: code, p_ext_id: String(lead.id || ''), p_name: lead.name || '',
      p_username: lead.username || '', p_phone: lead.phone || '', p_niche: lead.niche || '',
      p_notes: lead.notes || '', p_status: lead.status || 'novo', p_added_at: lead.addedAt || null,
      p_created_by: userId || null,
    })
      .then(async r => { sendResponse({ ok: r.ok, error: r.ok ? null : await r.text().catch(()=>'') }); })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'update_lead_direct') {
    const { code, extId, status, phone, name } = msg;
    callRpc('extension_update_lead', { p_code: code, p_ext_id: String(extId || ''), p_status: status || null, p_phone: phone || null, p_name: name || null })
      .then(async r => { sendResponse({ ok: r.ok, error: r.ok ? null : await r.text().catch(()=>'') }); })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
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
