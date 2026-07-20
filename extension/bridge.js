// bridge.js — IGProspect
// Ponte entre a extensão (Instagram) e o Painel Privado (arquivo local).
// Roda APENAS na página do painel (igprospect-dashboard*.html).
// Lê os leads salvos pela extensão (chrome.storage.local -> igp_l) e os envia
// para a página via postMessage. O painel ouve e mescla automaticamente,
// então não é mais preciso exportar/importar o .json manualmente.

(function () {
  'use strict';

  function sendLeads(leads) {
    window.postMessage({ source: 'igp-extension', type: 'leads', leads: leads || [] }, '*');
  }

  function pushCurrent() {
    try {
      chrome.storage.local.get('igp_l', d => sendLeads((d && d.igp_l) || []));
    } catch (e) { /* extensão recarregando */ }
  }

  // 1) O painel pede os leads ao carregar/logar — e informa qual equipe está
  //    ativa agora, pra extensão marcar os PRÓXIMOS leads capturados com ela.
  //    Evita que um lead capturado com uma equipe aberta seja sincronizado,
  //    depois, para outra equipe que esteja aberta na hora do sync.
  window.addEventListener('message', ev => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (d && d.source === 'igp-dashboard' && d.type === 'request-leads') {
      if (d.orgId) chrome.storage.local.set({ igp_org: { id: d.orgId, name: d.orgName || '' } });
      pushCurrent();
    }
    // 1b) O painel confirma quais leads já gravou/conferiu — some da fila local
    //     pra não serem oferecidos de novo (e duplicados) pra outra equipe depois.
    if (d && d.source === 'igp-dashboard' && d.type === 'synced-ids' && Array.isArray(d.ids) && d.ids.length) {
      const done = new Set(d.ids.map(String));
      chrome.storage.local.get('igp_l', data => {
        const list = (data && data.igp_l) || [];
        const kept = list.filter(l => !done.has(String(l.id)));
        if (kept.length !== list.length) chrome.storage.local.set({ igp_l: kept });
      });
    }
  });

  // 2) Envia assim que a ponte sobe
  pushCurrent();

  // 3) Sincronização ao vivo: sempre que a extensão salvar leads novos,
  //    empurra para o painel (se estiver aberto na mesma janela)
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.igp_l) {
        sendLeads(changes.igp_l.newValue || []);
      }
    });
  } catch (e) { /* sem permissão de storage — ignora */ }

  // Sinaliza presença da extensão (o painel mostra "conectado")
  window.postMessage({ source: 'igp-extension', type: 'hello' }, '*');
})();
