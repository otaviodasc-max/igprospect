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
        // r.ok=false aqui quase sempre é a função org_by_join_code não existir
        // ainda no banco (SQL não rodado) — diferente de "código não encontrado"
        // (a função roda, só não acha nenhuma equipe com esse código).
        if (!r.ok) {
          const msg = (data && (data.message || data.hint)) || `HTTP ${r.status}`;
          sendResponse({ ok: false, error: msg, notFound: false });
          return;
        }
        const org = Array.isArray(data) && data[0] ? data[0] : null;
        sendResponse({ ok: !!org, org, notFound: !org });
      })
      .catch(err => sendResponse({ ok: false, error: err.message, notFound: false }));

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
    const { code, extId, status, phone, name, notes, agendorPersonId, agendorDealId, agendorFunnel } = msg;
    callRpc('extension_update_lead', {
      p_code: code, p_ext_id: String(extId || ''), p_status: status || null, p_phone: phone || null, p_name: name || null,
      p_notes: notes || null,
      p_agendor_person_id: agendorPersonId ? String(agendorPersonId) : null,
      p_agendor_deal_id: agendorDealId ? String(agendorDealId) : null,
      p_agendor_funnel: agendorFunnel || null,
    })
      .then(async r => { sendResponse({ ok: r.ok, error: r.ok ? null : await r.text().catch(()=>'') }); })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // Apagar na extensão apaga no sistema também (mão dupla — ver pullLeads em
  // content.js pro caminho contrário: apagar no sistema soma no próximo pull).
  if (msg.type === 'delete_lead_direct') {
    const { code, extId } = msg;
    callRpc('extension_delete_lead', { p_code: code, p_ext_id: String(extId || '') })
      .then(async r => { sendResponse({ ok: r.ok, error: r.ok ? null : await r.text().catch(()=>'') }); })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // Etapas DE VERDADE do funil da equipe (Configurações → Personalização),
  // pra extensão parar de usar Novo Lead/Chamado/Respondeu/Enviou Contato fixos.
  if (msg.type === 'pull_org_pipeline') {
    const code = String(msg.code || '').trim();
    callRpc('org_pipeline_by_join_code', { p_code: code })
      .then(async r => {
        const data = await r.json().catch(() => null);
        const pipeline = Array.isArray(data) && data[0] ? data[0] : null;
        // r.ok=true com pipeline=null é uma equipe sem nenhum funil salvo em
        // org_pipelines ainda (não é erro de rede/RPC) — mensagem própria
        // pra não aparecer só "null" no console.
        const error = !r.ok ? ((data && data.message) || `HTTP ${r.status}`) : (!pipeline ? 'Equipe sem funil configurado em org_pipelines' : null);
        sendResponse({ ok: r.ok && !!pipeline, pipeline, error });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // Traz os leads que já existem no sistema pra dentro da extensão ao
  // conectar a equipe — pagina pra não depender do limite padrão de linhas
  // da API (não confia que uma equipe com milhares de leads volta tudo de
  // uma vez só).
  if (msg.type === 'pull_org_leads') {
    const code = String(msg.code || '').trim();
    (async () => {
      // 500 (não 2000): a API do Supabase tem um teto padrão de linhas por
      // resposta (1000) que corta silenciosamente qualquer p_limit maior —
      // pedir 2000 e receber 1000 de volta parecia "acabou" e a paginação
      // parava cedo. Pedindo um valor abaixo do teto, uma página cheia
      // sempre vem completa de verdade, e dá pra confiar no page.length
      // pra saber quando parar.
      const all = []; const pageSize = 500; let offset = 0; let guard = 0;
      try {
        while (guard++ < 200) { // trava de segurança: até 100.000 leads
          const r = await callRpc('org_leads_by_join_code', { p_code: code, p_limit: pageSize, p_offset: offset });
          const data = await r.json().catch(() => null);
          if (!r.ok) { sendResponse({ ok: false, error: (data && data.message) || `HTTP ${r.status}` }); return; }
          const page = Array.isArray(data) ? data : [];
          all.push(...page);
          if (page.length < pageSize) break;
          offset += page.length;
        }
        sendResponse({ ok: true, leads: all });
      } catch (err) { sendResponse({ ok: false, error: err.message }); }
    })();
    return true;
  }

  // Cria a pessoa e, se um destino de etapa foi mapeado (msg.deal), cria
  // também o negócio já na etapa certa — antes só criava a pessoa, o
  // negócio/etapa sempre dependia do painel estar aberto depois.
  if (msg.type === 'agendor_create_person') {
    const { token, person, deal } = msg;
    const headers = { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' };

    (async () => {
      try {
        const pr = await fetch('https://api.agendor.com.br/v3/people', {
          method: 'POST', headers,
          body: JSON.stringify({
            name: person.name,
            contact: { mobile: person.phone || '', instagram: person.instagram || '' },
            description: [
              person.niche    ? `Nicho: ${person.niche}`          : '',
              person.mutual   ? `Amigos em comum: ${person.mutual}`: '',
              person.notes    ? `Obs: ${person.notes}`             : '',
              person.profileUrl ? `Perfil: ${person.profileUrl}`  : '',
              'Origem: Redes sociais',
            ].filter(Boolean).join('\n'),
          }),
        });
        const pdata = await pr.json().catch(() => ({}));
        if (!pr.ok) { sendResponse({ ok: false, status: pr.status, data: pdata }); return; }
        const personId = (pdata && pdata.data && pdata.data.id) || (pdata && pdata.id);

        let dealId = null;
        if (personId && deal && deal.dealStage && deal.funnel) {
          const dr = await fetch(`https://api.agendor.com.br/v3/people/${personId}/deals`, {
            method: 'POST', headers,
            body: JSON.stringify({ title: deal.title, dealStage: deal.dealStage, funnel: deal.funnel, description: deal.description || '' }),
          });
          const ddata = await dr.json().catch(() => ({}));
          dealId = (ddata && ddata.data && ddata.data.id) || (ddata && ddata.id) || null;
          // Reforço: o Agendor às vezes não respeita dealStage já no POST de
          // criação — um PUT logo depois garante que o negócio nasça na
          // etapa certa (mesma lógica do painel, ver app.js sendLeadToAgendor).
          if (dealId) {
            try {
              await fetch(`https://api.agendor.com.br/v3/deals/${dealId}`, {
                method: 'PUT', headers,
                body: JSON.stringify({ dealStage: deal.dealStage, funnel: deal.funnel }),
              });
            } catch (e) { /* pessoa+negócio já existem; falha aqui só deixa a etapa por conferir */ }
          }
        }
        sendResponse({ ok: true, status: pr.status, data: pdata, dealId });
      } catch (err) { sendResponse({ ok: false, error: err.message }); }
    })();

    return true; // keep message channel open for async response
  }

});
