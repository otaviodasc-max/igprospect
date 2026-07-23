(function () {
  'use strict';
  if (document.getElementById('igp-host')) return;

  // ═══════════════════════════════════════════════
  // CSS  — must come before any DOM setup that uses it
  // ═══════════════════════════════════════════════
  const CSS = `
    *{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
    #igp-toggle{position:fixed;bottom:22px;right:22px;width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045);border:none;cursor:pointer;font-size:21px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(131,58,180,0.5);pointer-events:all;transition:transform .2s;color:#fff;z-index:1}
    #igp-toggle:hover{transform:scale(1.08)}
    #igp-badge{position:absolute;top:-3px;right:-3px;width:14px;height:14px;border-radius:50%;background:#f472b6;border:2px solid #0f0f0f;display:none}
    #igp-badge.on{display:block}
    #igp-panel{position:fixed;top:0;right:0;bottom:0;width:360px;max-width:90vw;background:#0f0f0f;display:flex;flex-direction:column;pointer-events:all;border-left:1px solid #1e1e1e;transform:translateX(100%);transition:transform .3s ease}
    #igp-panel.open{transform:translateX(0)}
    #igp-header{background:#111;border-bottom:1px solid #1e1e1e;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
    #igp-logo{font-weight:700;font-size:15px;background:linear-gradient(90deg,#c084fc,#f472b6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .igp-close{background:transparent;border:none;color:#555;cursor:pointer;font-size:17px;line-height:1;padding:2px 4px}
    .igp-close:hover{color:#fff}
    #igp-nav{background:#111;display:flex;padding:6px 10px;gap:3px;flex-shrink:0;border-bottom:1px solid #1e1e1e;overflow-x:auto}
    #igp-nav::-webkit-scrollbar{height:0}
    .nav-btn{background:transparent;border:1px solid transparent;border-radius:7px;padding:5px 10px;color:#555;cursor:pointer;font-size:12px;white-space:nowrap;transition:all .15s}
    .nav-btn.active{background:rgba(192,132,252,0.12);border-color:rgba(192,132,252,0.35);color:#c084fc;font-weight:600}
    .nav-btn em{font-style:normal;background:rgba(244,114,182,0.2);color:#f472b6;border-radius:20px;padding:1px 6px;font-size:10px;font-weight:700;margin-left:3px}
    /* Profile detection banner */
    #igp-profile-bar{background:rgba(99,102,241,0.08);border-bottom:1px solid rgba(99,102,241,0.2);padding:10px 14px;flex-shrink:0;display:none}
    #igp-profile-bar.visible{display:block}
    .pbar-name{font-weight:600;font-size:13px;color:#fff}
    .pbar-user{font-size:12px;color:#818cf8;margin-top:1px}
    .pbar-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}
    /* Direct (DM) phone detection banner */
    #igp-direct-bar{background:rgba(244,114,182,0.07);border-bottom:1px solid rgba(244,114,182,0.25);padding:10px 14px;flex-shrink:0;display:none}
    #igp-direct-bar.visible{display:block}
    /* Body */
    #igp-body{flex:1;overflow-y:auto;padding:14px;scrollbar-width:thin;scrollbar-color:#333 transparent}
    #igp-body::-webkit-scrollbar{width:4px}
    #igp-body::-webkit-scrollbar-thumb{background:#333;border-radius:2px}
    /* Cards */
    .card{background:#1a1a1a;border:1px solid #252525;border-radius:12px;padding:14px}
    .lead-card{background:#1a1a1a;border:1px solid #222;border-radius:12px;padding:13px;margin-bottom:8px}
    .lead-card.cv{border-color:rgba(244,114,182,0.3)}
    /* Inputs */
    .inp{background:#141414;border:1px solid #2a2a2a;border-radius:8px;padding:8px 11px;color:#fff;font-size:13px;outline:none;width:100%}
    .inp:focus{border-color:#555}
    textarea.inp{resize:vertical}
    /* Buttons */
    .btn-grad{background:linear-gradient(135deg,#833ab4,#fd1d1d);border:none;border-radius:8px;padding:8px 16px;color:#fff;font-weight:600;cursor:pointer;font-size:13px}
    .btn-ghost{background:#1e1e1e;border:1px solid #2a2a2a;border-radius:8px;padding:8px 14px;color:#888;cursor:pointer;font-size:13px}
    .btn-phone{background:linear-gradient(135deg,#9333ea,#f472b6);border:none;border-radius:8px;padding:8px 12px;color:#fff;font-weight:600;cursor:pointer;font-size:12px;white-space:nowrap}
    .btn-sm{background:#252525;border:1px solid #2a2a2a;border-radius:6px;padding:4px 10px;color:#888;cursor:pointer;font-size:11px}
    .btn-indigo{background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.35);border-radius:8px;padding:6px 12px;color:#818cf8;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap}
    .btn-pink-sm{background:rgba(244,114,182,0.15);border:1px solid rgba(244,114,182,0.3);border-radius:8px;padding:6px 12px;color:#f472b6;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;flex-shrink:0}
    .btn-danger{background:transparent;border:1px solid rgba(248,113,113,0.25);border-radius:8px;padding:7px 14px;color:#f87171;cursor:pointer;font-size:12px}
    .btn-agendor{background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);border-radius:7px;padding:4px 10px;color:#4ade80;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}
    /* Status */
    .status-btn{background:transparent;border:1px solid #2a2a2a;border-radius:7px;padding:3px 7px;cursor:pointer;display:flex;align-items:center;gap:5px}
    .smenu-opt{display:block;width:100%;padding:8px 12px;background:transparent;border:none;cursor:pointer;font-size:12px;text-align:left}
    .smenu-opt:hover{background:#252525}
    /* Filters */
    .fbtn{background:transparent;border:1px solid #222;border-radius:20px;padding:4px 9px;color:#444;cursor:pointer;font-size:11px;white-space:nowrap}
    .fbtn.factive{font-weight:500}
    /* Toast */
    #igp-toast{position:fixed;bottom:84px;right:22px;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:500;pointer-events:none;opacity:0;transition:opacity .3s;z-index:2;max-width:280px;line-height:1.4}
    #igp-toast.show{opacity:1}
    #igp-toast.ok{background:#14532d;color:#4ade80;border:1px solid rgba(74,222,128,0.3)}
    #igp-toast.err{background:#450a0a;color:#f87171;border:1px solid rgba(248,113,113,0.3)}
    #igp-toast.info{background:#1e1b4b;color:#a5b4fc;border:1px solid rgba(165,180,252,0.3)}
    /* Date Filter Tabs */
    .date-filter-wrap{background:#141414;border:1px solid #222;border-radius:10px;padding:10px 12px;margin-bottom:12px}
    .date-filter-tabs{display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap}
    .dftab{background:transparent;border:1px solid #2a2a2a;border-radius:7px;padding:4px 10px;color:#555;cursor:pointer;font-size:11px;white-space:nowrap;transition:all .15s}
    .dftab.active{background:rgba(192,132,252,0.12);border-color:rgba(192,132,252,0.4);color:#c084fc;font-weight:600}
    .date-inputs{display:flex;gap:6px;align-items:center}
    .date-inputs select,.date-inputs input{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:7px;padding:5px 8px;color:#aaa;font-size:12px;outline:none;cursor:pointer}
    .date-inputs select:focus,.date-inputs input:focus{border-color:#555;color:#fff}
    .date-inputs option{background:#1a1a1a}
    .date-result-label{font-size:11px;color:#555;margin-top:6px;padding-top:6px;border-top:1px solid #222}
    .date-result-label span{color:#c084fc;font-weight:600}
    /* Audios */
    .audio-card{background:#1a1a1a;border:1px solid #222;border-radius:12px;padding:11px 13px;margin-bottom:8px;cursor:grab}
    .audio-card:active{cursor:grabbing}
    .audio-play-btn{background:rgba(192,132,252,0.15);border:1px solid rgba(192,132,252,0.35);color:#c084fc;border-radius:50%;width:30px;height:30px;flex-shrink:0;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center}
    .audio-drag-hint{color:#333;font-size:14px;flex-shrink:0}
  `;

  // ═══════════════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════════════
  // Fallback só até a equipe conectar e a extensão puxar o funil de verdade
  // (ver pull_org_pipeline / doLinkOrg) — nunca é o que fica valendo de fato.
  const DEFAULT_STATUSES = [
    { key: 'novo',      label: 'Novo Lead',       color: '#818cf8', bg: 'rgba(129,140,248,0.12)' },
    { key: 'chamado',   label: 'Chamado',          color: '#fbbf24', bg: 'rgba(251,191,36,0.12)'  },
    { key: 'respondeu', label: 'Respondeu',        color: '#34d399', bg: 'rgba(52,211,153,0.12)'  },
    { key: 'contato',   label: 'Enviou Contato 📱', color: '#f472b6', bg: 'rgba(244,114,182,0.12)' },
  ];
  function hexToRgba(hex, a){
    const m=String(hex||'#818cf8').replace('#','');
    const full = m.length===3 ? m.split('').map(c=>c+c).join('') : m;
    const r=parseInt(full.slice(0,2),16)||0, g=parseInt(full.slice(2,4),16)||0, b=parseInt(full.slice(4,6),16)||0;
    return `rgba(${r},${g},${b},${a})`;
  }
  // Converte as etapas reais do funil (org_pipelines.stages: {key,label,short,
  // color,order}) pro formato que a extensão usa pra desenhar (label+color+bg).
  function mapPipelineStages(stages){
    return (stages||[]).slice().sort((a,b)=>(a.order||0)-(b.order||0))
      .map(s=>({ key:s.key, label:s.label||s.key, color:s.color||'#818cf8', bg:hexToRgba(s.color,0.12) }));
  }
  // Etapas de VERDADE da equipe conectada — cai pro fallback só se ainda não
  // tiver puxado nada (equipe não conectada, ou pull falhou).
  function currentStatuses(){ return (S.pipelineStages&&S.pipelineStages.length)?S.pipelineStages:DEFAULT_STATUSES; }
  function statusIdx(key){ const i=currentStatuses().findIndex(s=>s.key===key); return i<0?0:i; }
  function firstStatusKey(){ return currentStatuses()[0].key; }
  function lastStatusKey(){ const a=currentStatuses(); return a[a.length-1].key; }
  // Cada equipe cria a própria key ao adicionar/editar etapas (ex.: "Enviou
  // Contato" pode ser 'contato' numa equipe e 'enviou_contato' noutra) — a
  // KEY nunca é confiável entre equipes. O LABEL visível ("Novo Lead",
  // "Enviou Contato") é o que fica estável, então a âncora casa por key
  // conhecida OU por label normalizado (sem acento/maiúscula), com posição
  // (0/última) só como último recurso pra funis com vocabulário 100% diferente
  // (ex.: "Empresários": a_contatar/em_conversa/reuniao/negociando).
  function normLabel(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
  function findStageIdx(keys, labels){ const a=currentStatuses(); return a.findIndex(s=>keys.includes(s.key)||labels.includes(normLabel(s.label))); }
  const NEW_LEAD_KEYS=['novo'], NEW_LEAD_LABELS=['novo lead','novo'];
  const CONTACT_KEYS=['contato','enviou_contato'], CONTACT_LABELS=['enviou contato','contato enviado','contato'];
  // Etapa que representa "Novo Lead" de verdade — um lead recém-capturado
  // tem que entrar nela, não em "seja lá o que estiver na posição 0".
  function newLeadStatusKey(){ const i=findStageIdx(NEW_LEAD_KEYS,NEW_LEAD_LABELS); return i>=0?currentStatuses()[i].key:firstStatusKey(); }
  // "Ainda não chamado" — posição <= a etapa 'novo', espelhando isContacted().
  function isUncalled(status){ const i=findStageIdx(NEW_LEAD_KEYS,NEW_LEAD_LABELS); return statusIdx(status)<=(i>=0?i:0); }
  // Etapa que representa "Enviou Contato" de verdade — funis customizados
  // podem ter colunas DEPOIS dela (ex.: "Follow-up"), então "a última etapa"
  // deixa de ser sinônimo de "enviou contato" assim que isso acontece.
  function contactStatusKey(){ const i=findStageIdx(CONTACT_KEYS,CONTACT_LABELS); return i>=0?currentStatuses()[i].key:lastStatusKey(); }
  // "Já contatado" pro resto da UI (contador de convertidos, aba Contatos,
  // destaque rosa no card) — precisa ser POSIÇÃO >= a etapa de contato, não
  // só "é a última etapa", senão um lead em "Enviou Contato" some das
  // métricas assim que o funil ganha uma coluna depois dela (ex.: "Follow-up").
  function isContacted(status){ const i=findStageIdx(CONTACT_KEYS,CONTACT_LABELS); return statusIdx(status)>=(i>=0?i:currentStatuses().length-1); }
  const RESERVED = new Set(['explore','reel','reels','p','tv','stories','accounts','direct','notifications','ar','challenges','audio','shop','about','privacy','help','']);
  // Títulos genéricos de seção do Instagram que às vezes acabam parando onde
  // deveria estar o nome da pessoa (fallback de heading pego errado no Direct).
  const GENERIC_NAMES = new Set(['mensagens','messages','direct','solicitações','solicitacoes','requests','inbox','chats','conversas','não seguidores','nao seguidores','not following you back','seguidores','digital creator','personal blog','public figure','blogger','este perfil é privado','esta conta é privada','essa conta é privada','perfil privado','this account is private','conta privada']);
  // Mesma lista de botões/rótulos de layout do Instagram (não nomes de gente)
  // que nameFromProfile já filtrava sozinho — junto com GENERIC_NAMES acima,
  // cobre tanto rótulo de BOTÃO ("Enviar mensagem") quanto título de SEÇÃO
  // ("Mensagens"), que são strings diferentes e por isso escapavam um do outro.
  const BAD_NAME_RE=/^(seguir|follow|following|seguindo|message|mensagem|enviar mensagem|publicaç|posts?|seguidor|follower|não segu|nao segu|not follow|verificad|editar|ver tudo|sugest|cancelar|nota|stories?|destaque|digital creator|personal blog|public figure|blogger|criador\(a\)|perfil.{0,3}privad|account is private|conta privada|remover|bloquear|denunciar|silenciar|restringir)/i;
  function isBadName(t){
    const tl=(t||'').trim().toLowerCase();
    if(!tl) return true;
    if(GENERIC_NAMES.has(tl)) return true;
    return BAD_NAME_RE.test(tl);
  }

  const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  // ═══════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════
  let S = {
    leads: [],
    tab: 'dash', filter: 'all', search: '', noteSearch: '',
    showAdd: false,
    form: { name: '', username: '', niche: '', notes: '', mutualFriends: '' },
    phoneLeadId: null, phoneInput: '',
    open: false,
    openStatusId: null,
    detectedProfile: null,
    directDetect: null,        // { phone, leadId, name, username }
    directDismissed: '',       // key do número que o usuário ignorou
    agendorToken: '',          // sempre puxado da equipe (doLinkOrg) — não editável na extensão
    agendorStatus: {},
    // DATE FILTER STATE
    dateMode: 'today',   // 'today' | 'day' | 'month' | 'all'
    dateDay: new Date().toISOString().slice(0,10),    // YYYY-MM-DD
    dateMonth: new Date().getMonth(),                 // 0-11
    dateYear: new Date().getFullYear(),
    org: null,       // {id,name,code,locked,userId,userName} — equipe vinculada por código (ver doLinkOrg)
    orgCodeInput: '',
    orgMembers: [],  // membros da equipe conectada, pra escolher "quem é você" (doPickProspector)
    pipelineStages: null, // etapas reais do funil da equipe (ver currentStatuses/mapPipelineStages)
    agendorMap: null, // mapeamento etapa→funil/etapa do Agendor (Configurações → Integração Agendor), ver agendorStageFor
    audios: [],           // {id,name,dataUrl,duration,addedAt} — biblioteca de áudios prontos (aba Áudios)
    audioPlayingId: null, // qual áudio está tocando no preview da aba (não é o envio pro Direct)
    audioSending: false,  // trava concorrência: só um envio (microfone virtual) por vez
    audioDebug: null,     // {taFound,taTop,items} — aparece na aba Áudios quando não acha o botão de gravar (ver sendAudioToDirect)
    audioEngineReady: null, // null=verificando, true=injected.js respondeu, false=não respondeu (ver pingAudioEngine)
  };

  // ═══════════════════════════════════════════════
  // STORAGE
  // ═══════════════════════════════════════════════
  const db = {
    load: () => new Promise(r => chrome.storage.local.get(['igp_l','igp_tok','igp_org','igp_stages','igp_agendor_map','igp_leads_pulled_at','igp_sync_times','igp_sync_paused','igp_audios'], r)),
    save: d  => new Promise(r => chrome.storage.local.set(d, r)),
  };

  // ═══════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════
  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Usa a etapa DE VERDADE do funil da equipe (currentStatuses/pull_org_pipeline)
  // — o mapa fixo abaixo era usado sempre, então qualquer status fora dos 4
  // originais (ex.: uma etapa nova como "Follow-up") caía no default "Novo
  // Lead" e escondia o valor real do lead na tela da extensão.
  function badge(status) {
    const st = currentStatuses().find(s=>s.key===status);
    if (st) return `<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:500;color:${st.color};background:${st.bg};white-space:nowrap">${esc(st.label)}</span>`;
    const m = {
      novo:     {c:'#818cf8',bg:'rgba(129,140,248,0.12)',l:'Novo Lead'},
      chamado:  {c:'#fbbf24',bg:'rgba(251,191,36,0.12)',l:'Chamado'},
      respondeu:{c:'#34d399',bg:'rgba(52,211,153,0.12)',l:'Respondeu'},
      contato:  {c:'#f472b6',bg:'rgba(244,114,182,0.12)',l:'Enviou Contato'},
    };
    const s = m[status]||m.novo;
    return `<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:500;color:${s.c};background:${s.bg};white-space:nowrap">${s.l}</span>`;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'});
  }

  // ═══════════════════════════════════════════════
  // DATE FILTER LOGIC
  // ═══════════════════════════════════════════════
  function leadsInPeriod(leads) {
    if (S.dateMode === 'all') return leads;
    if (S.dateMode === 'today') {
      const today = new Date().toDateString();
      return leads.filter(l => new Date(l.addedAt).toDateString() === today);
    }
    if (S.dateMode === 'day') {
      return leads.filter(l => l.addedAt && l.addedAt.slice(0,10) === S.dateDay);
    }
    if (S.dateMode === 'month') {
      return leads.filter(l => {
        const d = new Date(l.addedAt);
        return d.getMonth() === S.dateMonth && d.getFullYear() === S.dateYear;
      });
    }
    return leads;
  }

  function periodLabel() {
    if (S.dateMode === 'today') return 'hoje';
    if (S.dateMode === 'all') return 'todos os períodos';
    if (S.dateMode === 'day') {
      const [y,m,d] = S.dateDay.split('-');
      return `${d}/${m}/${y}`;
    }
    if (S.dateMode === 'month') return `${MONTHS_PT[S.dateMonth]} ${S.dateYear}`;
    return '';
  }

  function getAvailableYears() {
    const years = new Set();
    const cur = new Date().getFullYear();
    years.add(cur);
    years.add(cur - 1);
    S.leads.forEach(l => { if (l.addedAt) years.add(new Date(l.addedAt).getFullYear()); });
    return [...years].sort((a,b)=>b-a);
  }

  function renderDateFilter() {
    const years = getAvailableYears();
    return `
      <div class="date-filter-wrap">
        <div style="font-size:11px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:7px">📅 Período</div>
        <div class="date-filter-tabs">
          <button class="dftab${S.dateMode==='today'?' active':''}" data-df="today">Hoje</button>
          <button class="dftab${S.dateMode==='day'?' active':''}" data-df="day">Por dia</button>
          <button class="dftab${S.dateMode==='month'?' active':''}" data-df="month">Por mês</button>
          <button class="dftab${S.dateMode==='all'?' active':''}" data-df="all">Todos</button>
        </div>
        ${S.dateMode==='day'?`
          <div class="date-inputs">
            <span style="color:#555;font-size:11px">Data:</span>
            <input type="date" id="igp-day-pick" value="${S.dateDay}" style="color-scheme:dark"/>
          </div>
        `:''}
        ${S.dateMode==='month'?`
          <div class="date-inputs">
            <span style="color:#555;font-size:11px">Mês:</span>
            <select id="igp-month-sel">
              ${MONTHS_PT.map((mn,i)=>`<option value="${i}"${i===S.dateMonth?' selected':''}>${mn}</option>`).join('')}
            </select>
            <select id="igp-year-sel">
              ${years.map(y=>`<option value="${y}"${y===S.dateYear?' selected':''}>${y}</option>`).join('')}
            </select>
          </div>
        `:''}
        <div class="date-result-label">Mostrando: <span>${periodLabel()}</span></div>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════
  // METRICS (now period-aware)
  // ═══════════════════════════════════════════════
  function metrics() {
    // "Respondeu" é um corte de posição (a partir da 3ª etapa), não uma etapa
    // fixa chamada "respondeu" — assim continua fazendo sentido mesmo com um
    // funil renomeado/redimensionado pela equipe.
    const respFrom = Math.min(2, currentStatuses().length-1);
    const today = new Date().toDateString();
    const tl = S.leads.filter(l => new Date(l.addedAt).toDateString()===today);
    const ct = tl.filter(l=>!isUncalled(l.status)).length;
    const tc = S.leads.filter(l=>!isUncalled(l.status)).length;
    const re = S.leads.filter(l=>statusIdx(l.status)>=respFrom).length;
    const cv = S.leads.filter(l=>isContacted(l.status)).length;

    // Period-filtered metrics
    const pl = leadsInPeriod(S.leads);
    const pCalled = pl.filter(l=>!isUncalled(l.status)).length;
    const pResp   = pl.filter(l=>statusIdx(l.status)>=respFrom).length;
    const pConv   = pl.filter(l=>isContacted(l.status)).length;

    return {
      todayLeads:tl, calledToday:ct, totalCalled:tc, responded:re, converted:cv,
      convRate: tc>0?Math.round(cv/tc*100):0,
      respRate: tc>0?Math.round(re/tc*100):0,
      // period
      periodLeads: pl, periodCalled: pCalled, periodResp: pResp, periodConv: pConv,
      periodConvRate: pCalled>0?Math.round(pConv/pCalled*100):0,
      periodRespRate: pCalled>0?Math.round(pResp/pCalled*100):0,
    };
  }

  function filtered() {
    const q=S.search.toLowerCase();
    const nq=(S.noteSearch||'').toLowerCase();
    return S.leads.filter(l=>{
      if (S.filter!=='all'&&l.status!==S.filter) return false;
      if (q&&!l.name.toLowerCase().includes(q)&&!(l.username||'').toLowerCase().includes(q)&&!(l.niche||'').toLowerCase().includes(q)&&!(l.notes||'').toLowerCase().includes(q)) return false;
      if (nq&&!(l.notes||'').toLowerCase().includes(nq)) return false;
      return true;
    });
  }

  // ═══════════════════════════════════════════════
  // DOM SETUP
  // ═══════════════════════════════════════════════
  const host = document.createElement('div');
  host.id='igp-host';
  host.style.cssText='position:fixed;top:0;right:0;z-index:2147483647;pointer-events:none;';
  document.body.appendChild(host);
  const shadow = host.attachShadow({mode:'open'});
  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  shadow.appendChild(styleEl);
  const wrap = document.createElement('div');
  shadow.appendChild(wrap);
  // O Instagram tem atalhos de teclado globais (letras soltas como "b" ou
  // "n" abrem diálogos/painéis dele) escutados no document — sem isso,
  // digitar nos campos da extensão (busca, notas, telefone etc.) também
  // aciona esses atalhos, porque o Instagram enxerga só o HOST da Shadow
  // DOM no evento, nunca o <input> de verdade lá dentro, e não reconhece
  // que é um campo de texto. Barra a propagação aqui, no topo da árvore da
  // extensão, antes que o evento saia da Shadow DOM.
  ['keydown','keyup','keypress'].forEach(evt=>wrap.addEventListener(evt, e=>e.stopPropagation()));

  // Toast element
  const toastEl = document.createElement('div');
  toastEl.id='igp-toast';
  shadow.appendChild(toastEl);
  let toastTimer = null;
  function toast(msg, type='info') {
    toastEl.textContent = msg;
    toastEl.className = `show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{ toastEl.className=''; }, 3500);
  }

  // Player de PREVIEW da aba Áudios (▶ ouvir antes de arrastar) — não tem
  // nenhuma relação com o "microfone virtual" usado no envio pro Direct
  // (esse roda isolado dentro de injected.js, no mundo principal da página).
  const previewAudio = new Audio();
  previewAudio.addEventListener('ended', ()=>{ S.audioPlayingId=null; if(S.open && S.tab==='audios') renderBody(); });
  function doToggleAudioPreview(id){
    const a=S.audios.find(x=>x.id===id); if(!a) return;
    if(S.audioPlayingId===id){ previewAudio.pause(); S.audioPlayingId=null; renderBody(); return; }
    previewAudio.pause();
    previewAudio.src=a.dataUrl;
    previewAudio.currentTime=0;
    previewAudio.play().catch(()=>toast('Não consegui tocar esse áudio','err'));
    S.audioPlayingId=id;
    renderBody();
  }

  // ═══════════════════════════════════════════════
  // PROFILE DETECTION
  // ═══════════════════════════════════════════════
  // Lê o nome real no CABEÇALHO do perfil aberto (<main>). É a fonte mais confiável
  // quando logado, pois aí o título da aba costuma ser só "(N) Instagram". Pega o
  // primeiro texto-folha "de nome" depois de pular @, botões e contadores. Como o
  // nome aparece ANTES da bio/sugestões no DOM, o primeiro válido é o nome.
  function nameFromProfile(uLow){
    try{
      const root=document.querySelector('main')||document.body;
      const els=root.querySelectorAll('h1,h2,span,div');
      for(const el of els){
        if(el.children.length>0) continue;              // só nós-folha (evita blocos grandes)
        const t=(el.textContent||'').trim();
        if(t.length<2||t.length>60) continue;
        const tl=t.toLowerCase();
        if(tl===uLow||tl==='@'+uLow) continue;          // é o próprio @
        if(t.startsWith('@')) continue;
        if(/instagram/i.test(t)) continue;
        if(/^[\d.,\s]+$/.test(t)) continue;             // só números (contadores)
        if(/\d+\s*(post|seguidor|follower|seguindo|mil|mi\b)/i.test(t)) continue;
        if(!/[A-Za-zÀ-ÿ]/.test(t)) continue;            // precisa ter letra
        if(isBadName(t)) continue;                      // botões/rótulos/títulos de seção comuns
        return t;
      }
    }catch(_){}
    return '';
  }

  // Acha o NOME REAL da pessoa (ex.: "Guilherme Elias"), não o @usuário.
  function findRealName(username){
    const uLow=username.toLowerCase();
    // 1) cabeçalho do perfil atual (confiável, reflete o perfil aberto)
    const dom=nameFromProfile(uLow);
    if(dom && dom.toLowerCase()!==uLow) return dom;
    // 2) og:title / título — só se o "(@handle)" bater com ESTE perfil (evita pegar
    //    o nome de um perfil anterior, pois o Instagram é SPA e o título atrasa).
    // Sem o mesmo filtro de isBadName daqui, um título tipo "Perfil privado
    // (@user) • Instagram" (Instagram usa esse texto no lugar do nome pra
    // contas privadas que você não segue) virava o "nome" do lead direto.
    const parse=(s)=>{
      if(!s) return '';
      const mm=s.match(/^(.+?)\s*\(@([A-Za-z0-9._]+)\)/);
      if(!mm || mm[2].toLowerCase()!==uLow) return '';
      const nm=mm[1].trim();
      return (nm && !isBadName(nm) && nm.toLowerCase()!=='instagram' && nm.toLowerCase()!==uLow) ? nm : '';
    };
    try{ const og=document.querySelector('meta[property="og:title"]'); const n=parse(og&&og.content); if(n) return n; }catch(_){}
    const n2=parse(document.title); if(n2) return n2;
    return username; // fallback seguro: usa o @ até conseguir o nome
  }

  function extractProfile() {
    const url = location.href;
    // Ancorado (início E fim da URL) — sem isso, /usuario/seguidores/ ou
    // /usuario/seguindo/ (o modal de lista aberto por cima do perfil) também
    // batiam aqui, e o nome lido do <main> acabava sendo o rótulo da lista
    // ("Seguidores"/"Não Seguidores") em vez do nome da pessoa.
    const m = url.match(/^https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?(?:\?.*)?$/);
    if (!m || RESERVED.has(m[1])) {
      if (S.detectedProfile) { S.detectedProfile=null; updateProfileBar(); }
      return;
    }
    const username = m[1];
    let attempts = 0;
    const tryDetect = ()=>{
      if (location.href !== url) return;          // navegou para outro perfil → aborta
      const name = findRealName(username);
      S.detectedProfile = { name, username, url };
      if (name.toLowerCase() !== username.toLowerCase()) maybeFixLeadName(username, name, url);
      updateProfileBar();
      if (S.open && S.tab==='leads') renderBody();
      // título do Instagram pode demorar a atualizar (SPA) → tenta de novo
      if (name.toLowerCase() === username.toLowerCase() && attempts < 5) {
        attempts++; setTimeout(tryDetect, 700);
      }
    };
    setTimeout(tryDetect, 700);
  }

  // Se já existe um lead com esse @ e o nome dele está como o próprio @ (bug antigo),
  // corrige automaticamente com o nome real ao passar pelo perfil.
  function maybeFixLeadName(username, name, url){
    if(!name || name.toLowerCase()===username.toLowerCase()) return;
    const uLow=username.toLowerCase();
    let changed=false; const fixedIds=[];
    S.leads=S.leads.map(l=>{
      if((l.username||'').toLowerCase()!==uLow) return l;
      const nClean=(l.name||'').trim(), n=nClean.toLowerCase();
      // nome "ruim" = vazio, igual ao @, ou contém "(@outro)" que não é o @ deste lead (corrompido pelo bug)
      const foreign=nClean.match(/\(@([A-Za-z0-9._]+)\)/);
      const corrupted = !!foreign && foreign[1].toLowerCase()!==uLow;
      // Nome antigo grudado com o @ sem separador (bug do getDirectPartner
      // já corrigido na captura, mas leads salvos antes continuam errados).
      const glued = n.length>uLow.length && n.endsWith(uLow);
      const isHandle = !l.name || n===uLow || n==='@'+uLow || corrupted || glued || isBadName(n);
      if(isHandle && l.name!==name){ changed=true; fixedIds.push(l.id); return { ...l, name, profileUrl:l.profileUrl||url }; }
      return l;
    });
    if(changed){
      db.save({igp_l:S.leads});
      fixedIds.forEach(id=>syncLeadUpdateDirect(id,{name}));
      toast(`Nome corrigido: ${name}`,'ok'); if(S.open) renderBody();
    }
  }

  function updateProfileBar() {
    const bar = shadow.getElementById('igp-profile-bar');
    if (!bar) return;
    if (!S.detectedProfile) { bar.className=''; return; }
    const p=S.detectedProfile;
    const alreadyAdded = S.leads.some(l=>l.username===p.username);
    bar.innerHTML=`
      <div class="pbar-name">${esc(p.name)}</div>
      <div class="pbar-user">@${esc(p.username)}</div>
      <div class="pbar-row">
        <span style="font-size:11px;color:#444">Perfil detectado</span>
        ${alreadyAdded
          ? `<span style="font-size:11px;color:#555;padding:4px 10px;background:#1a1a1a;border-radius:7px">✓ Já é lead</span>`
          : `<button class="btn-indigo" data-a="add-detected">+ Adicionar como lead</button>`}
      </div>
    `;
    bar.className='visible';
    const badge2 = shadow.getElementById('igp-badge');
    if (badge2 && !alreadyAdded) badge2.className='on'; else if (badge2) badge2.className='';
  }

  // ═══════════════════════════════════════════════
  // DIRECT (DM) — detecção automática do número enviado
  // ═══════════════════════════════════════════════
  function onDirect(){ return /\/direct\/(t|inbox)/.test(location.href); }

  function fmtPhone(d){
    d=String(d||'').replace(/\D/g,'');
    if(d.length>11 && d.startsWith('55')) d=d.slice(2);
    if(d.length===11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
    if(d.length===10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
    return '';
  }

  // Acha um telefone BR no texto. Usa a ÚLTIMA ocorrência (mensagem mais recente).
  function detectPhoneInText(text){
    if(!text) return '';
    const re=/(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/g;
    let best='', mm;
    while((mm=re.exec(text))!==null){
      let d=mm[0].replace(/\D/g,'');
      if(d.length>11 && d.startsWith('55')) d=d.slice(2);
      if(d.length===10||d.length===11){ const f=fmtPhone(d); if(f) best=f; }
    }
    return best;
  }

  // Alguns cabeçalhos do Direct colam nome + @usuário dentro do MESMO link
  // (nome maior + username menor embaixo, no mesmo <a>) — a.textContent (ou
  // h.textContent) gruda os dois sem espaço: "Otávio Corrêa"+"otaviocorreai_"
  // vira "Otávio Corrêaotaviocorreai_". Corta o username colado no final.
  function stripGluedHandle(name, username){
    if(!name||!username) return name;
    const nl=name.toLowerCase(), ul=username.toLowerCase();
    if(nl.length<=ul.length) return name;
    if(nl.endsWith('@'+ul)) return name.slice(0,name.length-ul.length-1).trim();
    if(nl.endsWith(ul)) return name.slice(0,name.length-ul.length).trim();
    return name;
  }

  // Identifica o participante da conversa (nome / @usuário) pelo cabeçalho do Direct.
  function getDirectPartner(root){
    let username='', name='';
    const header=(root&&root.querySelector('header'))||root||document.body;
    const links=header.querySelectorAll('a[href^="/"]');
    for(const a of links){
      const hm=(a.getAttribute('href')||'').match(/^\/([A-Za-z0-9._]+)\/?$/);
      if(hm && !RESERVED.has(hm[1])){
        username=hm[1];
        // Alguns links de perfil no cabeçalho do Direct são só o avatar (sem
        // texto visível) — nesse caso o nome vem do alt da imagem, se tiver.
        const img=a.querySelector('img[alt]');
        name=(a.textContent||'').trim() || ((img&&img.getAttribute('alt'))||'').trim();
        break;
      }
    }
    // Fallback pro heading da página só entra se o que já achamos não presta —
    // e mesmo assim, nunca aceita um título genérico de seção (ex.: "Mensagens",
    // que é o header compartilhado da caixa de entrada, não da conversa).
    if(isBadName(name)) name='';
    if(!name){
      const h=header.querySelector('h1,h2,[role="heading"]');
      const hName=h?(h.textContent||'').trim():'';
      name = isBadName(hName) ? '' : hName;
    }
    if(username) name=stripGluedHandle(name, username);
    if(name && name.length>60) name=name.slice(0,60);
    return { username, name };
  }

  let _lastDirectKey='';
  function scanDirect(){
    if(!onDirect()){ if(S.directDetect){ S.directDetect=null; _lastDirectKey=''; updateDirectBar(); } return; }
    const root=document.querySelector('div[role="main"]')||document.querySelector('section')||document.body;
    const partner=getDirectPartner(root);
    // só o trecho final do texto = mensagens mais recentes
    const text=((root&&root.innerText)||'').slice(-6000);
    const phone=detectPhoneInText(text);
    if(!phone){ if(S.directDetect){ S.directDetect=null; _lastDirectKey=''; updateDirectBar(); } return; }
    let lead=null;
    if(partner.username) lead=S.leads.find(l=>(l.username||'').toLowerCase()===partner.username.toLowerCase());
    if(!lead && partner.name) lead=S.leads.find(l=>(l.name||'').toLowerCase()===partner.name.toLowerCase());
    const key=(lead?lead.id:(partner.username||partner.name||'?'))+'|'+phone;
    if(key===S.directDismissed){ return; }                 // usuário já ignorou este
    S.directDetect={ phone, leadId:lead?lead.id:null, name:lead?lead.name:(partner.name||partner.username||'Lead'), username:partner.username||(lead&&lead.username)||'' };
    if(key!==_lastDirectKey){ _lastDirectKey=key; updateDirectBar(); }
  }

  function updateDirectBar(){
    const bar=shadow.getElementById('igp-direct-bar');
    if(!bar) return;
    const d=S.directDetect;
    if(!d){ bar.className=''; bar.innerHTML=''; return; }
    const lead=d.leadId?S.leads.find(l=>l.id===d.leadId):null;
    const already=lead && isContacted(lead.status) && (lead.phone||'').replace(/\D/g,'')===d.phone.replace(/\D/g,'');
    bar.innerHTML=`
      <div style="font-size:12px;font-weight:600;color:#f472b6">📱 Número detectado na conversa</div>
      <div style="font-size:15px;font-weight:700;color:#fff;margin-top:3px">${esc(d.phone)}</div>
      <div style="font-size:11px;color:#818cf8;margin-top:1px">${lead?('Lead: '+esc(lead.name)):(d.name?('conversa com '+esc(d.name)+(d.username?' (@'+esc(d.username)+')':'')):'lead não cadastrado')}</div>
      <div class="pbar-row">
        ${ already
          ? `<span style="font-size:11px;color:#4ade80">✓ Já registrado para este lead</span>`
          : lead
            ? `<button class="btn-pink-sm" data-a="confirm-direct">✓ Confirmar este número</button>`
            : `<button class="btn-indigo" data-a="confirm-direct-new">+ Criar lead e registrar</button>`}
        <button class="btn-sm" data-a="dismiss-direct">Ignorar</button>
      </div>`;
    bar.className='visible';
    const badge2=shadow.getElementById('igp-badge');
    if(badge2 && !already) badge2.className='on';
  }

  function doConfirmDirect(createNew){
    const d=S.directDetect; if(!d) return;
    let lead=d.leadId?S.leads.find(l=>l.id===d.leadId):null;
    let wasNew=false;
    if(!lead && createNew){
      if(!requireOrg()) return;
      wasNew=true;
      lead={ id:Date.now().toString(), name:d.name||d.username||'Lead', username:d.username||'',
        profileUrl:d.username?`https://instagram.com/${d.username}`:'', niche:'', notes:'', mutualFriends:'',
        status:newLeadStatusKey(), addedAt:new Date().toISOString(), orgId:S.org&&S.org.id, synced:false };
      S.leads.unshift(lead);
    }
    if(!lead){ toast('Abra o perfil do lead primeiro','info'); return; }
    const now=new Date().toISOString();
    S.leads=S.leads.map(l=>l.id===lead.id?{...l,status:contactStatusKey(),phone:d.phone,convertedAt:l.convertedAt||now}:l);
    db.save({igp_l:S.leads});
    if(wasNew) syncLeadAddDirect({...lead,status:contactStatusKey(),phone:d.phone});
    else syncLeadUpdateDirect(lead.id,{status:contactStatusKey(),phone:d.phone});
    const updated=S.leads.find(l=>l.id===lead.id);
    S.directDetect=null; _lastDirectKey='';
    if(S.open) renderBody(); else updateDirectBar();
    toast(`✓ Contato de ${updated.name} registrado!`,'ok');
    if(updated) syncAgendor(updated);
  }

  // Watch URL changes (Instagram SPA)
  let _lastUrl = location.href;
  let _scanDeb=null;
  new MutationObserver(()=>{
    if (location.href!==_lastUrl) { _lastUrl=location.href; S.directDetect=null; _lastDirectKey=''; S.directDismissed=''; extractProfile(); }
    clearTimeout(_scanDeb); _scanDeb=setTimeout(()=>{ try{ scanDirect(); }catch(_){} }, 700);
  }).observe(document, {subtree:true, childList:true});
  window.addEventListener('popstate', ()=>{ extractProfile(); setTimeout(()=>{ try{ scanDirect(); }catch(_){} },500); });
  setInterval(()=>{ try{ scanDirect(); }catch(_){} }, 2500);

  // ═══════════════════════════════════════════════
  // AUDIO → DIRECT (microfone virtual)
  // ═══════════════════════════════════════════════
  // O Instagram não aceita áudio como anexo solto (só imagem/vídeo) — a
  // única forma de um áudio virar mensagem de voz é gravando na hora. Então
  // ao soltar um card da aba Áudios em cima da conversa, em vez de tentar um
  // "drop de arquivo" que o Instagram ia rejeitar, a extensão finge segurar
  // o botão de gravar enquanto injected.js (mundo principal da página, ver
  // esse arquivo) troca a resposta do microfone pelo áudio importado. Isso é
  // inerentemente frágil a mudanças de layout do Instagram — os seletores
  // abaixo foram escolhidos pra serem o mais resilientes possível (por
  // aria-label do ícone, escopado à barra de composição), mas se o
  // Instagram mudar o HTML pode ser preciso ajustar findMicButton().
  function postToInjected(msg){ window.postMessage({ __igp:true, ...msg }, '*'); }

  // Confirma se injected.js (mundo principal da página, ver esse arquivo)
  // está mesmo rodando, ANTES de tentar qualquer envio — sem isso, um
  // problema de carregamento só aparecia depois de segurar o botão por
  // dezenas de segundos sem nenhuma resposta. Roda uma vez no carregamento
  // e pode ser repetido pelo botão "🔄 Testar conexão" na aba Áudios.
  function pingAudioEngine(){
    S.audioEngineReady=null;
    let answered=false;
    function onPong(ev){
      if(ev.source!==window || !ev.data || ev.data.__igp!==true) return;
      if(ev.data.type==='IGP_PONG' || ev.data.type==='IGP_INJECTED_READY'){
        answered=true;
        window.removeEventListener('message', onPong);
        S.audioEngineReady=true;
        if(S.open && S.tab==='audios') renderBody();
      }
    }
    window.addEventListener('message', onPong);
    postToInjected({type:'IGP_PING'});
    setTimeout(()=>{
      if(answered) return;
      window.removeEventListener('message', onPong);
      S.audioEngineReady=false;
      if(S.open && S.tab==='audios') renderBody();
    }, 1500);
  }
  pingAudioEngine();

  function getDirectDropTarget(){
    if(!onDirect()) return null;
    return document.querySelector('div[role="main"]')||document.querySelector('section');
  }

  function highlightDropTarget(el, on){
    if(!el) return;
    el.style.outline = on ? '2px dashed #f472b6' : '';
    el.style.outlineOffset = on ? '-2px' : '';
  }

  document.addEventListener('dragover', e=>{
    if(!e.dataTransfer||!e.dataTransfer.types||!e.dataTransfer.types.includes('application/x-igprospect-audio')) return;
    const target=getDirectDropTarget();
    if(!target) return;
    e.preventDefault();
    e.dataTransfer.dropEffect='copy';
    highlightDropTarget(target, true);
  });
  document.addEventListener('dragleave', e=>{
    const target=getDirectDropTarget();
    if(target && (!e.relatedTarget || !target.contains(e.relatedTarget))) highlightDropTarget(target, false);
  });
  document.addEventListener('drop', e=>{
    if(!e.dataTransfer) return;
    const id=e.dataTransfer.getData('application/x-igprospect-audio');
    if(!id) return;
    const target=getDirectDropTarget();
    if(!target) return;
    e.preventDefault();
    highlightDropTarget(target, false);
    sendAudioToDirect(id);
  }, true);

  // Acha o botão de gravar áudio da barra de composição (não o campo de
  // texto em si). Duas travas pra não errar o alvo:
  // 1) o rótulo (aria-label do ícone) precisa conter uma palavra-chave de
  //    microfone — em substring simples, não regex ancorada (bug corrigido:
  //    "Microfone" não batia antes por causa de \b logo depois de "mic").
  // 2) o botão precisa estar na MESMA ALTURA do campo de mensagem — sem
  //    isso, o botão de LIGAÇÃO DE VOZ lá no cabeçalho da conversa (que
  //    também tem "voz"/"áudio" no aria-label) podia ser escolhido no lugar
  //    do microfone de gravar, e a extensão discava uma chamada em vez de
  //    gravar um áudio.
  // "Clipe de voz" é o aria-label real usado pelo Instagram hoje (confirmado
  // via diagnóstico em produção — não é "Microfone" nem "Gravar áudio" como
  // seria de se imaginar). Mantém as outras variantes como fallback pra
  // outros idiomas/versões do Instagram.
  const MIC_KEYWORDS=['clipe de voz','voice clip','microfone','mic','gravar áudio','gravar audio','mensagem de voz','voice message','record audio','record voice','hold to record'];
  function findMicButton(){
    const root=document.querySelector('div[role="main"]')||document.body;
    const ta=root.querySelector('textarea, [contenteditable="true"]');
    if(!ta) return null;
    const taBox=ta.getBoundingClientRect();
    const matches=(label)=>{ const l=(label||'').toLowerCase(); return MIC_KEYWORDS.some(k=>l.includes(k)); };
    // O rótulo pode estar no <svg> do ícone OU direto no botão/div clicável
    // que o envolve — o Instagram já usou os dois jeitos em versões
    // diferentes, então checa as duas fontes em vez de assumir uma só.
    const candidates=new Set();
    root.querySelectorAll('svg[aria-label]').forEach(svg=>{
      if(matches(svg.getAttribute('aria-label'))){
        // Se não tem um <button>/div[role=button] ancestral (o Instagram nem
        // sempre usa esse padrão), cai pro pai direto do ícone, ou o próprio
        // ícone — eventos disparados nele ainda borbulham (bubbles:true) até
        // qualquer listener que o Instagram tenha registrado mais acima.
        const btn=svg.closest('button, div[role="button"]')||svg.parentElement||svg;
        candidates.add(btn);
      }
    });
    root.querySelectorAll('button[aria-label], div[role="button"][aria-label]').forEach(el=>{
      if(matches(el.getAttribute('aria-label'))) candidates.add(el);
    });
    let best=null, bestDist=Infinity;
    candidates.forEach(btn=>{
      const box=btn.getBoundingClientRect();
      if(Math.abs(box.top-taBox.top)>120) return; // fora da barra de composição (ex.: ligação de voz no topo)
      const dist=Math.abs(box.left-taBox.right);
      if(dist<bestDist){ bestDist=dist; best=btn; }
    });
    return best;
  }

  // "Segura" o botão de gravar pelo tempo da faixa (mousedown → espera →
  // mouseup), como um clique longo de verdade. Alguns layouts do Instagram
  // pedem uma confirmação extra depois de soltar — se aparecer um botão de
  // enviar visível logo em seguida, tenta clicar nele também.
  // O Instagram descarta cliques disparados por dispatchEvent() do JS da
  // página — eles sempre nascem com isTrusted=false, e a proteção
  // anti-automação deles simplesmente ignora (nem o mousedown chega a
  // acionar a gravação). Por isso o "segurar o botão" passa pro
  // background.js, que usa o Chrome DevTools Protocol pra simular um clique
  // no nível do navegador — indistinguível de um clique humano de verdade
  // (ver 'trusted_press_hold' em background.js). Custo: o Chrome mostra uma
  // barra "esta extensão está depurando a aba" enquanto o clique está
  // "segurado", some sozinha ao soltar.
  // Bolinha rosa temporária EXATAMENTE onde o clique de verdade (CDP) vai
  // cair — só pra dar pra ver num print se a coordenada calculada bate com
  // o ícone certo ou está caindo em outro lugar (ex.: atrás do painel, ou
  // no elemento errado).
  function showClickMarker(x,y){
    try{
      const m=document.createElement('div');
      m.style.cssText=`position:fixed;left:${x-11}px;top:${y-11}px;width:22px;height:22px;border-radius:50%;background:rgba(244,114,182,0.55);border:2px solid #f472b6;z-index:2147483647;pointer-events:none;box-shadow:0 0 0 6px rgba(244,114,182,0.25)`;
      document.body.appendChild(m);
      setTimeout(()=>m.remove(), 4000);
    }catch(_){}
  }

  function pressAndHold(btn, durationSec, done){
    const box=btn.getBoundingClientRect();
    const x=Math.round(box.left+box.width/2);
    const y=Math.round(box.top+box.height/2);
    showClickMarker(x,y);
    const holdMs=Math.max(500, Math.round((durationSec||3)*1000))+500;
    chrome.runtime.sendMessage({ type:'trusted_press_hold', x, y, holdMs }, res=>{
      if(chrome.runtime.lastError || !res || !res.ok){
        const raw=(res&&res.error)||(chrome.runtime.lastError&&chrome.runtime.lastError.message)||'erro desconhecido';
        const friendly=/already attached|another debugger/i.test(raw)
          ? 'Feche o DevTools (F12) desta aba do Instagram e tente de novo — não dá pra usar os dois ao mesmo tempo.'
          : `Não consegui simular o clique (${raw})`;
        done(false, friendly);
        return;
      }
      setTimeout(()=>{
        const sendBtn=document.querySelector('[aria-label="Enviar" i], [aria-label="Send" i]');
        if(sendBtn) sendBtn.click();
        done(true);
      }, 400);
    });
  }

  function sendAudioToDirect(id){
    if(S.audioSending){ toast('Já tem um áudio sendo enviado, aguarde…','info'); return; }
    const audio=S.audios.find(a=>a.id===id);
    if(!audio){ toast('Áudio não encontrado','err'); return; }
    if(!onDirect()){ toast('Abra uma conversa do Direct primeiro','info'); return; }
    if(S.audioEngineReady===false){ toast('O motor de envio não respondeu — recarregue a página do Instagram (F5) e tente de novo','err'); return; }
    const btn=findMicButton();
    if(!btn){
      toast('Não encontrei o botão de gravar áudio nesta conversa — olha o diagnóstico aqui embaixo, na aba Áudios','err');
      // Diagnóstico direto NO PAINEL (em vez de pedir pra abrir o console do
      // navegador — atrito grande demais pra quem não mexe com DevTools).
      // Mostra se o campo de mensagem foi achado e todos os aria-label
      // visíveis na conversa, com a posição vertical de cada um.
      try{
        const root=document.querySelector('div[role="main"]')||document.body;
        const ta=root.querySelector('textarea, [contenteditable="true"]');
        const taTop=ta?Math.round(ta.getBoundingClientRect().top):null;
        const matches=(label)=>{ const l=(label||'').toLowerCase(); return MIC_KEYWORDS.some(k=>l.includes(k)); };
        const items=[...root.querySelectorAll('[aria-label]')].map(el=>({
          tag: el.tagName, label: el.getAttribute('aria-label'), top: Math.round(el.getBoundingClientRect().top),
          matched: matches(el.getAttribute('aria-label')),
        })).sort((a,b)=>a.top-b.top);
        S.audioDebug={ taFound:!!ta, taTop, items };
      }catch(err){ S.audioDebug={ taFound:false, taTop:null, items:[], error:String(err) }; }
      S.tab='audios';
      render();
      return;
    }

    S.audioSending=true;
    let settled=false;
    const timeoutGuard=setTimeout(()=>{ postToInjected({type:'IGP_CANCEL_AUDIO'}); finish('O Instagram não respondeu ao pedido de gravação — tente de novo','err'); }, 12000);
    function finish(msg,type){
      if(settled) return; settled=true;
      window.removeEventListener('message', onReady);
      clearTimeout(timeoutGuard);
      S.audioSending=false;
      if(msg) toast(msg, type||'info');
    }
    function onReady(ev){
      if(ev.source!==window || !ev.data || ev.data.__igp!==true) return;
      if(ev.data.type==='IGP_AUDIO_READY'){
        clearTimeout(timeoutGuard);
        const dur=ev.data.duration||audio.duration||3;
        toast(`🎙️ Gravando "${audio.name}" (${fmtDuration(dur)})... não navegue nem feche a conversa`,'info');
        pressAndHold(btn, dur, (ok, err)=>{
          if(ok) finish(`✓ Áudio "${audio.name}" enviado na conversa!`,'ok');
          else finish(err||'Falha ao enviar o áudio','err');
        });
      }
      if(ev.data.type==='IGP_AUDIO_ERROR'){
        finish('Não consegui preparar esse áudio pra envio','err');
      }
    }
    window.addEventListener('message', onReady);
    postToInjected({type:'IGP_PREP_AUDIO', dataUrl:audio.dataUrl, id:audio.id});
  }

  // ═══════════════════════════════════════════════
  // AGENDOR INTEGRATION
  // ═══════════════════════════════════════════════
  // Nome bonito da PESSOA no Agendor: "Nome Real (@usuario)". O título do
  // negócio usa agendorDealTitle (só o nome) — ver syncAgendor abaixo.
  function agendorName(lead){
    const nm=(lead.name||'').trim();
    const un=(lead.username||'').trim().replace(/^@/,'');
    if(nm && un && nm.toLowerCase()!==un.toLowerCase()) return `${nm} (@${un})`;
    if(nm) return nm;
    if(un) return `@${un}`;
    return 'Lead IGProspect';
  }

  // Título do NEGÓCIO: só o nome, sem "(@usuario)" — o @ já aparece embaixo,
  // na pessoa vinculada (agendorName). Repetir os dois no título ficava
  // poluído, ex.: "Otávio Corrêa (@otaviocorreai)".
  function agendorDealTitle(lead){
    const nm=(lead.name||'').trim();
    if(nm) return nm;
    const un=(lead.username||'').trim().replace(/^@/,'');
    if(un) return `@${un}`;
    return 'Lead IGProspect';
  }

  function syncAgendor(lead) {
    if (!lead.phone) return;
    // Sem token não dá pra saber se a equipe simplesmente não usa Agendor ou
    // esqueceu de configurar — avisa sempre que marcar "Enviou Contato", já
    // que antes o envio só sumia em silêncio (nenhum toast, nenhum log).
    if (!S.agendorToken) { toast('☁ Token do Agendor não configurado no sistema — configure em Configurações → Integração Agendor e reconecte a equipe aqui.','err'); return; }
    if (lead.agendorManual||lead.agendorId) return;
    // Sem destino mapeado pra etapa atual, não envia — mesma regra do painel
    // (Configurações → Roteamento por etapa: "etapas sem mapeamento não são
    // enviadas"). Antes a extensão criava só a pessoa, sempre, ignorando isso.
    const map=agendorStageFor(lead);
    if (!map||!map.stageId) return;
    S.agendorStatus[lead.id]='syncing';
    renderBody();
    const displayName=agendorName(lead);
    const dealTitle=agendorDealTitle(lead);
    chrome.runtime.sendMessage({
      type: 'agendor_create_person',
      token: S.agendorToken,
      person: {
        name:       displayName,
        phone:      lead.phone,
        instagram:  lead.username||'',
        niche:      lead.niche||'',
        mutual:     lead.mutualFriends||'',
        notes:      lead.notes||'',
        profileUrl: lead.profileUrl||'',
      },
      deal: {
        title: dealTitle,
        dealStage: map.stageOrder,
        funnel: map.funnelId,
        description: `Origem: Redes sociais\nEnviado pelo IGProspect (funil ${map.funnelName}).`,
      }
    }, resp=>{
      if (chrome.runtime.lastError) { S.agendorStatus[lead.id]='error'; toast('Erro ao conectar com Agendor','err'); renderBody(); return; }
      if (resp&&resp.ok) {
        S.agendorStatus[lead.id]='ok';
        const agendorId = resp.data&&(resp.data.id||(resp.data.data&&resp.data.data.id));
        S.leads=S.leads.map(l=>l.id===lead.id?{...l,agendorId,agendorDealId:resp.dealId||null}:l);
        db.save({igp_l:S.leads});
        // Sem isso, o painel nunca fica sabendo que ESTE envio (direto da
        // extensão) já criou pessoa+negócio — o lead ficava com o botão
        // manual "→ Agendor" pra sempre, mesmo já existindo lá de verdade.
        if(agendorId) syncLeadUpdateDirect(lead.id,{agendorPersonId:agendorId, agendorDealId:resp.dealId||null, agendorFunnel:map.funnelName});
        toast(resp.dealId?`✓ Enviado ao Agendor → funil ${map.funnelName}!`:'✓ Sincronizado com Agendor!','ok');
      } else {
        S.agendorStatus[lead.id]='error';
        toast('Erro no Agendor: '+(resp&&resp.status?`status ${resp.status}`:'sem resposta'),'err');
      }
      renderBody();
    });
  }

  // ═══════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════
  function render(keepSearch) {
    const m = metrics();
    const cv = m.converted;
    const tabs=[
      {k:'dash',    label:'📊 Dashboard'},
      {k:'leads',   label:'👥 Leads'},
      {k:'contacts',label:'📱 Contatos'+(cv>0?` <em>${cv}</em>`:'')},
      {k:'audios',  label:'🎙️ Áudios'+(S.audios.length>0?` <em>${S.audios.length}</em>`:'')},
      {k:'settings',label:'⚙️ Config'},
    ];

    wrap.innerHTML=`
      <div id="igp-toggle-wrap" style="position:fixed;bottom:22px;right:22px;pointer-events:all">
        <button id="igp-toggle" title="IGProspect">📸</button>
        <div id="igp-badge"></div>
      </div>
      <div id="igp-panel" class="${S.open?'open':''}">
        <div id="igp-header">
          <div id="igp-logo">📸 IGProspect</div>
          <div style="display:flex;align-items:center;gap:8px">
            ${S.detectedProfile?`<span style="font-size:11px;color:#818cf8;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);border-radius:6px;padding:3px 8px">@${esc(S.detectedProfile.username)}</span>`:''}
            <button class="igp-close" data-a="close">✕</button>
          </div>
        </div>
        <div id="igp-profile-bar"></div>
        <div id="igp-direct-bar"></div>
        <div id="igp-nav">
          ${tabs.map(t=>`<button class="nav-btn${S.tab===t.k?' active':''}" data-tab="${t.k}">${t.label}</button>`).join('')}
        </div>
        <div id="igp-body">
          ${S.tab==='dash'?renderDash(m):S.tab==='leads'?renderLeads():S.tab==='contacts'?renderContacts(m):S.tab==='audios'?renderAudios():renderSettings(m)}
        </div>
      </div>
    `;
    postRender(keepSearch);
    updateProfileBar();
    updateDirectBar();
    pushPage();
  }

  // Empurra a página do Instagram para a esquerda quando o painel está aberto,
  // assim nada (botões de seguir/mensagem) fica escondido atrás da extensão.
  const PANEL_W = 360;
  function pushPage(){
    try{
      const el=document.documentElement;
      el.style.transition='margin-right .3s ease';
      const w=Math.min(PANEL_W, Math.round(window.innerWidth*0.9));
      el.style.marginRight = S.open ? w+'px' : '0px';
    }catch(_){}
  }
  window.addEventListener('resize', ()=>{ if(S.open) pushPage(); });

  function postRender(keepSearch) {
    const tog=shadow.getElementById('igp-toggle');
    if(tog) tog.onclick=e=>{e.stopPropagation();S.open=!S.open;render();};

    const sr=shadow.getElementById('igp-search');
    if(sr){
      sr.addEventListener('input',e=>{S.search=e.target.value;renderBody();});
      if(keepSearch==='search'){sr.focus();sr.setSelectionRange(sr.value.length,sr.value.length);}
    }
    const nsr=shadow.getElementById('igp-note-search');
    if(nsr){
      nsr.addEventListener('input',e=>{S.noteSearch=e.target.value;renderBody('notes');});
      if(keepSearch==='notes'){nsr.focus();nsr.setSelectionRange(nsr.value.length,nsr.value.length);}
    }
    shadow.querySelectorAll('.fi').forEach(el=>el.addEventListener('input',e=>{S.form[e.target.dataset.f]=e.target.value;}));
    const pi=shadow.getElementById('igp-pi');
    if(pi){
      pi.addEventListener('input',e=>{S.phoneInput=e.target.value;});
      pi.addEventListener('keydown',e=>{if(e.key==='Enter')doConfirmPhone();});
      setTimeout(()=>pi.focus(),50);
    }
    const af=shadow.getElementById('igp-audio-file');
    if(af) af.addEventListener('change', e=>{ handleAudioFiles(e.target.files); e.target.value=''; });
    const oc=shadow.getElementById('igp-orgcode');
    if(oc) oc.addEventListener('input',e=>{S.orgCodeInput=e.target.value;});
    const pr=shadow.getElementById('igp-prospector');
    if(pr) pr.addEventListener('change',e=>doPickProspector(e.target.value));

    // Date filter pickers
    const dayPick=shadow.getElementById('igp-day-pick');
    if(dayPick) dayPick.addEventListener('change',e=>{S.dateDay=e.target.value;renderBody();});
    const monSel=shadow.getElementById('igp-month-sel');
    if(monSel) monSel.addEventListener('change',e=>{S.dateMonth=parseInt(e.target.value);renderBody();});
    const yrSel=shadow.getElementById('igp-year-sel');
    if(yrSel) yrSel.addEventListener('change',e=>{S.dateYear=parseInt(e.target.value);renderBody();});
  }

  function renderBody(focus) {
    const body=shadow.getElementById('igp-body');
    if(!body)return;
    const m=metrics();
    body.innerHTML=S.tab==='dash'?renderDash(m):S.tab==='leads'?renderLeads():S.tab==='contacts'?renderContacts(m):S.tab==='audios'?renderAudios():renderSettings(m);
    postRender(focus===undefined?'search':focus);
    updateProfileBar();
    updateDirectBar();
  }

  // ═══════════════════════════════════════════════
  // TAB: DASHBOARD
  // ═══════════════════════════════════════════════
  function renderDash(m){
    const pl = m.periodLeads;
    return `
      <p style="color:#555;font-size:12px;margin:0 0 12px">${new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'})}</p>

      ${renderDateFilter()}

      <div style="font-size:11px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📊 ${periodLabel()}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        ${[
          ['Leads adicionados', pl.length, '#c084fc', ''],
          ['Chamados', m.periodCalled, '#fbbf24', ''],
          ['Taxa de resposta', m.periodRespRate+'%', '#34d399', m.periodResp+' responderam'],
          ['Enviaram contato 📱', m.periodConv, '#f472b6', m.periodConvRate+'% conversão'],
        ].map(([l,v,c,s])=>`
          <div class="card"><div style="font-size:11px;color:#555;margin-bottom:5px">${l}</div><div style="font-size:22px;font-weight:700;line-height:1;color:${c}">${v}</div>${s?`<div style="font-size:10px;color:#444;margin-top:4px">${s}</div>`:''}</div>
        `).join('')}
      </div>

      ${m.periodConv>0?`<div style="background:rgba(244,114,182,0.05);border:1px solid rgba(244,114,182,0.2);border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div><div style="font-size:13px;font-weight:600;color:#f472b6">🎉 ${m.periodConv} ${m.periodConv===1?'pessoa enviou':'pessoas enviaram'} contato</div><div style="font-size:11px;color:#666;margin-top:2px">${m.periodConvRate}% de conversão dos chamados</div></div>
        <button class="btn-pink-sm" data-a="go-contacts">Ver ↗</button>
      </div>`:''}

      <div style="font-size:11px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Funil geral</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:14px">
        ${currentStatuses().map(s=>{const c=S.leads.filter(l=>l.status===s.key).length;const p2=S.leads.length>0?Math.round(c/S.leads.length*100):0;return`<div class="card" style="text-align:center;padding:10px 6px"><div style="font-size:20px;font-weight:700;color:${s.color}">${c}</div><div style="font-size:10px;color:#555;margin-top:3px;line-height:1.2">${s.label.replace(' 📱','')}</div><div style="font-size:10px;color:#333;margin-top:2px">${p2}%</div></div>`;}).join('')}
      </div>

      ${pl.length===0?`<div style="text-align:center;padding:20px 0;font-size:12px;color:#444">Nenhuma prospecção em ${periodLabel()}.</div>`:
        S.leads.length===0?`<div style="text-align:center;padding:30px 0"><div style="font-size:36px;margin-bottom:10px">🎯</div><div style="font-size:13px;color:#555;margin-bottom:12px">Nenhum lead ainda!</div><button class="btn-grad" data-a="go-leads-add">+ Adicionar lead</button></div>`:`
        <div style="font-size:11px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Recentes</div>
        ${pl.slice(0,5).map(l=>`
          <div style="background:#1a1a1a;border:1px solid #1e1e1e;border-radius:10px;padding:10px 12px;margin-bottom:5px;display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:28px;height:28px;border-radius:50%;background:${isContacted(l.status)?'linear-gradient(135deg,#f472b6,#9333ea)':'linear-gradient(135deg,#833ab4,#fd1d1d)'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">${l.name.charAt(0).toUpperCase()}</div>
              <div>
                <div style="font-size:13px;font-weight:500;color:#fff">${esc(l.name)}</div>
                ${isContacted(l.status)&&l.phone?`<div style="font-size:11px;color:#f472b6">📱 ${esc(l.phone)}</div>`:l.username?`<div style="font-size:11px;color:#444">@${esc(l.username)}</div>`:''}
              </div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
              ${badge(l.status)}
              <span style="font-size:10px;color:#333">${fmtDate(l.addedAt)}</span>
            </div>
          </div>
        `).join('')}
      `}
    `;
  }

  // ═══════════════════════════════════════════════
  // TAB: LEADS
  // ═══════════════════════════════════════════════
  function renderLeads(){
    const fl=filtered();
    const p=S.detectedProfile;
    const autoHint=p&&!S.leads.some(l=>l.username===p.username);
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span style="font-weight:700;font-size:15px;color:#fff">Leads <span style="font-size:12px;font-weight:400;color:#444">(${S.leads.length})</span></span>
        <div style="display:flex;gap:6px">
          ${autoHint?`<button class="btn-indigo" data-a="add-detected" style="font-size:12px;padding:6px 10px">+ @${esc(p.username)}</button>`:''}
          <button class="btn-grad" data-a="toggle-add" style="padding:7px 14px;font-size:12px">+ Manual</button>
        </div>
      </div>
      ${S.showAdd?`
        <div class="card" style="margin-bottom:12px">
          <div style="font-weight:600;font-size:13px;color:#fff;margin-bottom:10px">Novo Lead</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
            ${[['name','Nome *','Nome completo'],['username','Username Instagram','@usuario'],['niche','Nicho','empresário, coach...'],['mutualFriends','Amigos em comum','Em comum']].map(([f,l,ph])=>`
              <div><label style="font-size:11px;color:#555;display:block;margin-bottom:3px">${l}</label>
              <input class="inp fi" data-f="${f}" placeholder="${ph}" value="${esc(S.form[f])}"/></div>
            `).join('')}
          </div>
          <div style="margin-bottom:8px"><label style="font-size:11px;color:#555;display:block;margin-bottom:3px">Observações</label>
          <textarea class="inp fi" data-f="notes" placeholder="Notas...">${esc(S.form.notes)}</textarea></div>
          <div style="display:flex;gap:7px">
            <button class="btn-grad" data-a="save-lead" style="padding:7px 14px;font-size:12px">Salvar</button>
            <button class="btn-ghost" data-a="cancel-add" style="padding:7px 12px;font-size:12px">Cancelar</button>
          </div>
        </div>
      `:''}
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
        <input id="igp-search" class="inp" placeholder="🔍 Buscar..." value="${esc(S.search)}" style="font-size:12px;padding:6px 10px;flex:1;min-width:100px"/>
        ${['all',...currentStatuses().map(s=>s.key)].map(k=>{
          const s=currentStatuses().find(x=>x.key===k);
          const cnt=k==='all'?S.leads.length:S.leads.filter(l=>l.status===k).length;
          const active=S.filter===k;
          return`<button class="fbtn${active?' factive':''}" data-fil="${k}" style="${active?`border-color:${s?.color||'#555'};color:${s?.color||'#fff'};background:${s?.bg||'rgba(255,255,255,0.07)'}`:''}">${k==='all'?'Todos':s?.label.replace(' 📱','')} (${cnt})</button>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
        <input id="igp-note-search" class="inp" placeholder="📝 Buscar nas notas..." value="${esc(S.noteSearch)}" style="font-size:12px;padding:6px 10px;flex:1;min-width:100px"/>
        ${['Perdido','Sem interesse','Sem retorno'].map(t=>{
          const active=(S.noteSearch||'').toLowerCase()===t.toLowerCase();
          return`<button class="fbtn${active?' factive':''}" data-note="${esc(t)}">${t}</button>`;
        }).join('')}
        ${S.noteSearch?`<button class="fbtn" data-note-clear="1">✕ Limpar</button>`:''}
      </div>
      ${S.noteSearch?`<div style="font-size:11px;color:#666;margin:-4px 0 10px">Mostrando leads cuja nota contém "<span style="color:#818cf8">${esc(S.noteSearch)}</span>" — ${fl.length} resultado(s)</div>`:''}
      ${fl.length===0?`<div style="text-align:center;padding:30px 0;font-size:12px;color:#444">${S.leads.length===0?'Nenhum lead. Clique em + para adicionar.':'Nenhum lead com esses filtros.'}</div>`
      :fl.map(l=>renderLeadCard(l)).join('')}
    `;
  }

  function renderLeadCard(l){
    const ph=(l.phone||'').replace(/\D/g,'');
    const wa=ph?`https://wa.me/55${ph}`:'';
    const agSt=S.agendorStatus[l.id];
    return `
      <div class="lead-card${isContacted(l.status)?' cv':''}" data-lid="${l.id}">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <div style="width:34px;height:34px;border-radius:50%;background:${isContacted(l.status)?'linear-gradient(135deg,#f472b6,#9333ea)':'linear-gradient(135deg,#833ab4,#fd1d1d)'};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#fff;flex-shrink:0">${l.name.charAt(0).toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span style="font-weight:600;font-size:13px;color:#fff">${esc(l.name)}</span>
              ${l.profileUrl?`<a href="${esc(l.profileUrl)}" target="_blank" style="font-size:11px;color:#818cf8;text-decoration:none">@${esc(l.username||'')} ↗</a>`:l.username?`<span style="font-size:11px;color:#555">@${esc(l.username)}</span>`:''}
            </div>
            ${isContacted(l.status)&&l.phone?`
              <div style="display:flex;align-items:center;gap:6px;margin-top:7px;padding:6px 10px;background:rgba(244,114,182,0.08);border:1px solid rgba(244,114,182,0.2);border-radius:8px">
                <span>📱</span><span style="font-weight:600;font-size:13px;color:#f472b6">${esc(l.phone)}</span>
                ${wa?`<a href="${wa}" target="_blank" style="margin-left:auto;font-size:11px;color:#25d366;background:rgba(37,211,102,0.1);border:1px solid rgba(37,211,102,0.2);border-radius:6px;padding:2px 8px;text-decoration:none;font-weight:600">WhatsApp ↗</a>`:''}
                ${S.agendorToken&&!l.agendorId&&agSt!=='ok'&&!l.agendorManual?`<button class="btn-agendor" data-a="sync-agendor" data-lid="${l.id}" style="margin-left:${wa?'0':'auto'}">${agSt==='syncing'?'⏳ Sync...':'☁ Agendor'}</button>${agSt!=='syncing'?`<button class="btn-sm" data-a="mark-agendor" data-lid="${l.id}" title="Marcar que já está no Agendor">✓ Já no Agendor</button>`:''}`:''}
                ${l.agendorId||agSt==='ok'||l.agendorManual?`<span style="font-size:11px;color:#4ade80;background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.2);border-radius:6px;padding:2px 8px">✓ Agendor</span>`:''}
              </div>
            `:''}
            <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px">
              ${l.niche?`<span style="font-size:11px;padding:2px 7px;border-radius:20px;background:#252525;color:#777">${esc(l.niche)}</span>`:''}
              ${l.mutualFriends?`<span style="font-size:11px;padding:2px 7px;border-radius:20px;background:rgba(129,140,248,0.1);color:#818cf8">👥 ${esc(l.mutualFriends)}</span>`:''}
            </div>
            ${l.notes?`<div style="font-size:11px;color:#555;margin-top:5px;line-height:1.4">${esc(l.notes)}</div>`:''}
            <div style="font-size:10px;color:#333;margin-top:5px;display:flex;gap:8px">
              <span>➕ ${fmtDate(l.addedAt)}</span>
              ${l.convertedAt?`<span style="color:rgba(244,114,182,0.5)">📱 ${fmtDate(l.convertedAt)}</span>`:''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">
            <div style="position:relative">
              <button class="status-btn" data-a="open-menu" data-lid="${l.id}" style="display:flex;align-items:center;gap:5px;background:transparent;border:1px solid #2a2a2a;border-radius:7px;padding:3px 7px;cursor:pointer">
                ${badge(l.status)}<span style="color:#444;font-size:9px">▼</span>
              </button>
              ${S.openStatusId===l.id?`
                <div style="position:absolute;right:0;top:108%;background:#1e1e1e;border:1px solid #2a2a2a;border-radius:9px;z-index:999;min-width:165px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.6)">
                  ${currentStatuses().map((s,i)=>`<button class="smenu-opt" data-a="set-status" data-lid="${l.id}" data-st="${s.key}" style="color:${s.color};border-bottom:${i<currentStatuses().length-1?'1px solid #252525':'none'}">${s.label}</button>`).join('')}
                </div>
              `:''}
            </div>
            ${l.agendorId||agSt==='ok'||l.agendorManual
              ?`<button class="btn-sm" data-a="unmark-agendor" data-lid="${l.id}" style="color:#4ade80;border-color:rgba(74,222,128,0.3);font-size:10px" title="Clique para desmarcar">✓ Agendor</button>`
              :`<button class="btn-sm" data-a="mark-agendor" data-lid="${l.id}" style="font-size:10px" title="Marcar que já está no Agendor">Agendor?</button>`}
            <button data-a="del-lead" data-lid="${l.id}" style="background:transparent;border:none;color:#333;cursor:pointer;font-size:14px;line-height:1;padding:2px">✕</button>
          </div>
        </div>
        ${S.phoneLeadId===l.id?`
          <div style="margin-top:10px;padding:12px;background:rgba(244,114,182,0.06);border:1px solid rgba(244,114,182,0.25);border-radius:9px">
            <div style="font-size:12px;font-weight:600;color:#f472b6;margin-bottom:5px">📱 Registrar número que ${esc(l.name)} enviou</div>
            <div style="display:flex;gap:6px">
              <input id="igp-pi" class="inp" placeholder="(11) 99999-9999" value="${esc(S.phoneInput)}" style="flex:1;font-size:13px;border-color:rgba(244,114,182,0.4)"/>
              <button class="btn-phone" data-a="confirm-phone" data-lid="${l.id}">Confirmar</button>
              <button class="btn-ghost" data-a="cancel-phone" style="padding:8px 10px;font-size:12px">✕</button>
            </div>
          </div>
        `:''}
      </div>
    `;
  }

  // ═══════════════════════════════════════════════
  // TAB: CONTACTS
  // ═══════════════════════════════════════════════
  function renderContacts(m){
    const contacts=S.leads.filter(l=>isContacted(l.status));
    return `
      <div style="font-weight:700;font-size:15px;color:#fff;margin-bottom:4px">Contatos Recebidos 📱</div>
      <div style="font-size:12px;color:#444;margin-bottom:14px">Pessoas que enviaram o número — sua conversão real.</div>
      <div style="background:rgba(244,114,182,0.05);border:1px solid rgba(244,114,182,0.18);border-radius:12px;padding:12px 16px;margin-bottom:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        ${[['Contatos',m.converted,'#f472b6'],['Chamados',m.totalCalled,'#fbbf24'],['Conversão',m.convRate+'%','#34d399']].map(([l,v,c])=>`
          <div><div style="font-size:10px;color:#555;margin-bottom:3px">${l}</div><div style="font-size:20px;font-weight:700;color:${c}">${v}</div></div>
        `).join('')}
      </div>
      ${contacts.length===0?`<div style="text-align:center;padding:40px 0"><div style="font-size:36px;margin-bottom:10px">📱</div><div style="font-size:13px;color:#555">Nenhum contato ainda.</div></div>`
      :contacts.map(l=>{
        const ph=(l.phone||'').replace(/\D/g,'');
        const wa=ph?`https://wa.me/55${ph}`:'';
        const agSt=S.agendorStatus[l.id];
        return `
          <div style="background:#1a1a1a;border:1px solid rgba(244,114,182,0.2);border-radius:12px;padding:12px 14px;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#f472b6,#9333ea);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;color:#fff;flex-shrink:0">${l.name.charAt(0).toUpperCase()}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:14px;color:#fff">${esc(l.name)}</div>
                ${l.profileUrl?`<a href="${esc(l.profileUrl)}" target="_blank" style="font-size:11px;color:#818cf8;text-decoration:none">@${esc(l.username||'')} ↗</a>`:l.username?`<div style="font-size:11px;color:#555">@${esc(l.username)}</div>`:''}
                ${l.niche?`<div style="font-size:11px;color:#666;margin-top:1px">${esc(l.niche)}</div>`:''}
                <div style="font-size:10px;color:#333;margin-top:3px">📅 ${fmtDate(l.addedAt)} ${l.convertedAt?` → 📱 ${fmtDate(l.convertedAt)}`:''}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:14px;font-weight:700;color:#f472b6;margin-bottom:6px">${esc(l.phone||'')}</div>
                <div style="display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap">
                  <button class="btn-sm" data-a="copy-phone" data-phone="${esc(l.phone||'')}">Copiar</button>
                  ${wa?`<a href="${wa}" target="_blank" style="background:rgba(37,211,102,0.1);border:1px solid rgba(37,211,102,0.2);border-radius:7px;padding:4px 10px;color:#25d366;font-size:11px;font-weight:600;text-decoration:none">WA ↗</a>`:''}
                  ${S.agendorToken&&!l.agendorId&&agSt!=='ok'&&!l.agendorManual?`<button class="btn-agendor" data-a="sync-agendor" data-lid="${l.id}">${agSt==='syncing'?'⏳':'☁ Agendor'}</button>`:''}
                  ${l.agendorId||agSt==='ok'||l.agendorManual
                    ?`<button class="btn-sm" data-a="unmark-agendor" data-lid="${l.id}" style="color:#4ade80;border-color:rgba(74,222,128,0.3)" title="Clique para desmarcar">✓ Agendor</button>`
                    :`<button class="btn-sm" data-a="mark-agendor" data-lid="${l.id}" title="Marcar que já está no Agendor">✓ Já no Agendor</button>`}
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    `;
  }

  // ═══════════════════════════════════════════════
  // TAB: AUDIOS
  // ═══════════════════════════════════════════════
  function fmtDuration(sec){
    sec=Math.round(sec||0);
    const m=Math.floor(sec/60), s=sec%60;
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  function renderAudios(){
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span style="font-weight:700;font-size:15px;color:#fff">Áudios <span style="font-size:12px;font-weight:400;color:#444">(${S.audios.length})</span></span>
        <button class="btn-grad" data-a="import-audio" style="padding:7px 14px;font-size:12px">+ Importar</button>
      </div>
      <input type="file" id="igp-audio-file" accept="audio/*" multiple style="display:none"/>
      <div style="font-size:12px;color:#555;margin-bottom:10px;line-height:1.5">
        Importe áudios prontos (MP3, OGG, WAV...) e depois <b>arraste o card pra dentro de uma conversa aberta no Direct</b> — a extensão grava e manda como mensagem de voz normal, sem precisar segurar o microfone.
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:11px;color:#555">
        <span>Motor de envio:</span>
        ${S.audioEngineReady===true?`<span style="color:#4ade80;font-weight:600">✅ pronto</span>`
          :S.audioEngineReady===false?`<span style="color:#f87171;font-weight:600">⚠️ não respondeu</span>`
          :`<span style="color:#818cf8">verificando…</span>`}
        <button class="btn-sm" data-a="ping-audio-engine" style="font-size:10px">🔄 Testar</button>
      </div>
      ${S.audios.length===0?`
        <div style="text-align:center;padding:40px 0"><div style="font-size:36px;margin-bottom:10px">🎙️</div><div style="font-size:13px;color:#555;margin-bottom:4px">Nenhum áudio importado ainda.</div><div style="font-size:11px;color:#444">Clique em + Importar pra adicionar um arquivo de áudio.</div></div>
      `:S.audios.map(a=>renderAudioCard(a)).join('')}
      ${renderAudioDebug()}
    `;
  }

  // Aparece só quando um envio falha por não achar o botão de gravar —
  // mostra tudo que a extensão enxergou na conversa (aria-label + posição),
  // direto no painel, pra mandar print sem precisar abrir o DevTools.
  function renderAudioDebug(){
    const d=S.audioDebug;
    if(!d) return '';
    const rows=(d.items||[]).map(it=>`
      <div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #222;${it.matched?'background:rgba(74,222,128,0.08)':''}">
        <span style="color:#555;width:40px;flex-shrink:0">${it.top}</span>
        <span style="color:#818cf8;width:64px;flex-shrink:0">${esc(it.tag)}</span>
        <span style="color:${it.matched?'#4ade80':'#ccc'};word-break:break-word;font-weight:${it.matched?'700':'400'}">${it.matched?'✓ ':''}${esc(it.label)}</span>
      </div>
    `).join('');
    const anyMatch=(d.items||[]).some(it=>it.matched);
    return `
      <div class="card" style="margin-top:14px;border-color:rgba(248,113,113,0.3)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-weight:600;font-size:12px;color:#f87171">🔧 Diagnóstico — não achei o botão de áudio</span>
          <button class="btn-sm" data-a="clear-audio-debug">✕</button>
        </div>
        <div style="font-size:11px;color:#555;margin-bottom:4px">Campo de mensagem encontrado: <b style="color:${d.taFound?'#4ade80':'#f87171'}">${d.taFound?`sim (topo ${d.taTop}px)`:'não'}</b></div>
        <div style="font-size:11px;color:#555;margin-bottom:8px">Linha(s) em <span style="color:#4ade80;font-weight:600">verde</span> = bateu com a palavra-chave${anyMatch?', mas foi descartada (posição longe do campo de mensagem, ou sem elemento clicável perto)':' — nenhuma encontrada'}.</div>
        <div style="max-height:280px;overflow-y:auto;font-family:monospace;font-size:11px">
          ${rows||'<span style="color:#555">nenhum ícone com aria-label encontrado na conversa</span>'}
        </div>
      </div>
    `;
  }

  function renderAudioCard(a){
    const playing=S.audioPlayingId===a.id;
    return `
      <div class="audio-card" draggable="true" data-aid="${a.id}" title="Arraste pra uma conversa do Direct pra enviar">
        <div style="display:flex;align-items:center;gap:10px">
          <button class="audio-play-btn" data-a="play-audio" data-aid="${a.id}" title="${playing?'Pausar':'Ouvir'}">${playing?'⏸':'▶'}</button>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.name)}</div>
            <div style="font-size:11px;color:#555;margin-top:2px">${fmtDuration(a.duration)} · ${fmtDate(a.addedAt)}</div>
          </div>
          <span class="audio-drag-hint">⠿</span>
          <button class="btn-sm" data-a="del-audio" data-aid="${a.id}" style="flex-shrink:0">✕</button>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════
  // TAB: SETTINGS
  // ═══════════════════════════════════════════════
  function renderSettings(m){
    const needFixNames=S.leads.filter(l=>{ const u=(l.username||'').toLowerCase(); const n=(l.name||'').trim().toLowerCase(); return u && (!l.name || n===u || n==='@'+u); }).length;
    return `
      <div style="font-weight:700;font-size:15px;color:#fff;margin-bottom:18px">Configurações</div>

      <div class="card" style="margin-bottom:10px;border-color:${S.org?'rgba(74,222,128,0.25)':'rgba(248,113,113,0.35)'}">
        <div style="font-weight:600;font-size:13px;color:${S.org?'#4ade80':'#f87171'};margin-bottom:4px">${S.org?'✓ Equipe conectada: '+esc(S.org.name):'⚠ Nenhuma equipe conectada'}</div>
        <div style="font-size:12px;color:#555;margin-bottom:10px;line-height:1.5">${S.org?'Todo lead capturado aqui vai pra essa equipe, sempre — mesmo com o painel fechado ou aberto em outra equipe.':'Cole o código da equipe pra essa extensão saber pra onde mandar os leads. Sem isso, nada é capturado. O código fica em Configurações → Equipe, dentro do sistema.'}</div>
        <div style="display:flex;gap:7px">
          <input id="igp-orgcode" class="inp" placeholder="Código da equipe (ex.: A1B2C3)" style="flex:1;font-size:12px;text-transform:uppercase" maxlength="12" value="${esc(S.orgCodeInput||'')}"/>
          <button class="btn-grad" data-a="link-org" style="padding:8px 14px;font-size:12px">${S.org?'Trocar':'Conectar'}</button>
        </div>
        ${S.org?`
        <div style="height:1px;background:#252525;margin:12px 0"></div>
        <label style="font-size:11px;color:${S.org.userId?'#555':'#fbbf24'};display:block;margin-bottom:4px">${S.org.userId?'Quem é você':'⚠ Quem é você? — sem isso o lead não conta pra sua comissão'}</label>
        <select id="igp-prospector" class="inp" style="font-size:12px">
          <option value="">— selecione —</option>
          ${S.orgMembers.map(m=>`<option value="${esc(m.user_id)}" ${S.org.userId===m.user_id?'selected':''}>${esc(m.name)}</option>`).join('')}
        </select>
        <div style="height:1px;background:#252525;margin:12px 0"></div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:11px;color:#555">${currentStatuses().length} etapa(s) de funil · ${S.leads.length} lead(s) na extensão</span>
          <button class="btn-ghost" data-a="sync-org-now" style="padding:6px 10px;font-size:11px">↻ Sincronizar agora</button>
        </div>
        ${syncPaused?`<div style="margin-top:10px;padding:8px 10px;background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.3);border-radius:8px;font-size:11px;color:#f87171">⏸ Envio automático pausado — mais de ${SYNC_RATE_LIMIT} leads em ${SYNC_RATE_WINDOW_MS/60000}min (trava de segurança). Volta sozinho quando o ritmo normalizar.</div>`:''}
        `:''}
      </div>

      <div class="card" style="margin-bottom:10px;border-color:rgba(74,222,128,0.2)">
        <div style="font-weight:600;font-size:13px;color:#4ade80;margin-bottom:4px">☁ Integração Agendor CRM</div>
        <div style="font-size:12px;color:#555;line-height:1.5">O token já é o mesmo configurado nas Configurações do sistema — puxado sozinho ao conectar a equipe acima, não precisa colar de novo aqui.</div>
        ${S.agendorToken?`<div style="font-size:11px;color:#4ade80;margin-top:8px">✓ Token configurado — sincronização automática ativa</div>`:`<div style="font-size:11px;color:#555;margin-top:8px">Sem token — configure a integração com o Agendor no sistema (Configurações) e reconecte a equipe aqui.</div>`}
      </div>

      <div class="card" style="margin-bottom:10px">
        <div style="font-weight:600;font-size:13px;color:#fff;margin-bottom:8px">Conversão = contato recebido</div>
        <div style="font-size:12px;color:#555;line-height:1.6;margin-bottom:12px">Somente leads com status <span style="color:#f472b6">Enviou Contato 📱</span> entram na taxa de conversão.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px">
          ${[['Total de leads',S.leads.length,''],['Chamados',m.totalCalled,''],['Responderam',m.responded,''],['Enviaram contato 📱',m.converted,'#f472b6'],['Taxa de conversão',m.convRate+'%','#f472b6']].map(([l,v,c])=>`
            <div style="background:#141414;border-radius:8px;padding:10px 12px"><div style="font-size:10px;color:#444;margin-bottom:3px">${l}</div><div style="font-size:18px;font-weight:700;color:${c||'#fff'}">${v}</div></div>
          `).join('')}
        </div>
      </div>

      <div class="card" style="margin-bottom:10px;border-color:rgba(129,140,248,0.2)">
        <div style="font-weight:600;font-size:13px;color:#818cf8;margin-bottom:4px">🔧 Corrigir nomes (@)</div>
        <div style="font-size:12px;color:#555;margin-bottom:10px;line-height:1.5">Leads antigos podem ter ficado com o <b>@usuário</b> no lugar do nome. A extensão corrige <b>automaticamente</b> assim que você abre o perfil (ou o Direct) da pessoa. ${needFixNames>0?`<span style="color:#fbbf24">Ainda faltam <b>${needFixNames}</b> lead(s) com nome = @.</span>`:'<span style="color:#4ade80">Todos os nomes estão certos! ✓</span>'}</div>
        ${S.detectedProfile?`<button class="btn-indigo" data-a="fix-open-name" style="padding:7px 12px;font-size:12px">Corrigir nome de @${esc(S.detectedProfile.username)} agora</button>`:`<div style="font-size:11px;color:#444">Abra o perfil de um lead no Instagram para corrigir o nome dele.</div>`}
      </div>

      <div class="card" style="border-color:rgba(248,113,113,0.2)">
        <div style="font-weight:600;font-size:13px;color:#f87171;margin-bottom:6px">Zona de perigo</div>
        <div style="font-size:12px;color:#555;margin-bottom:12px">Apaga todos os leads permanentemente.</div>
        <button class="btn-danger" data-a="clear-leads">Apagar todos os leads</button>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════
  // EVENT DELEGATION
  // ═══════════════════════════════════════════════
  shadow.addEventListener('click', e=>{
    const inMenu=e.target.closest('[data-a="open-menu"]')||e.target.closest('.smenu-opt')||e.target.closest('.status-btn');
    if (!inMenu&&S.openStatusId){ S.openStatusId=null; renderBody(); return; }

    const el=e.target.closest('[data-a]');
    if (!el) return;
    e.stopPropagation();
    const a=el.dataset.a, lid=el.dataset.lid, st=el.dataset.st, aid=el.dataset.aid;

    switch(a){
      case 'close':        S.open=false; render(); break;
      case 'go-contacts':  S.tab='contacts'; render(); break;
      case 'go-leads-add': S.tab='leads'; S.showAdd=true; render(); break;
      case 'toggle-add':   S.showAdd=!S.showAdd; renderBody(); break;
      case 'cancel-add':   S.showAdd=false; S.form={name:'',username:'',niche:'',notes:'',mutualFriends:''}; renderBody(); break;
      case 'save-lead':    doAddLead(); break;
      case 'add-detected': doAddDetected(); break;
      case 'open-menu':    S.openStatusId=S.openStatusId===lid?null:lid; renderBody(); break;
      case 'set-status':   doSetStatus(lid,st); break;
      case 'del-lead':     doDeleteLead(lid); break;
      case 'confirm-phone':doConfirmPhone(); break;
      case 'confirm-direct': doConfirmDirect(false); break;
      case 'confirm-direct-new': doConfirmDirect(true); break;
      case 'dismiss-direct':
        if(S.directDetect){ S.directDismissed=(S.directDetect.leadId||S.directDetect.username||S.directDetect.name||'?')+'|'+S.directDetect.phone; S.directDetect=null; _lastDirectKey=''; updateDirectBar(); }
        break;
      case 'cancel-phone': S.phoneLeadId=null; S.phoneInput=''; renderBody(); break;
      case 'sync-agendor': { const lead=S.leads.find(l=>l.id===lid); if(lead) syncAgendor(lead); break; }
      case 'mark-agendor': { S.leads=S.leads.map(l=>l.id===lid?{...l,agendorManual:true}:l); db.save({igp_l:S.leads}); renderBody(); toast('Marcado como já no Agendor','ok'); break; }
      case 'unmark-agendor': { S.leads=S.leads.map(l=>l.id===lid?{...l,agendorManual:false,agendorId:undefined}:l); db.save({igp_l:S.leads}); delete S.agendorStatus[lid]; renderBody(); toast('Desmarcado do Agendor','info'); break; }
      case 'copy-phone':
        navigator.clipboard?.writeText(el.dataset.phone).then(()=>{el.textContent='✓';setTimeout(()=>{el.textContent='Copiar';},2000);});
        break;
      case 'import-audio': { const fi=shadow.getElementById('igp-audio-file'); if(fi) fi.click(); break; }
      case 'play-audio':   doToggleAudioPreview(aid); break;
      case 'del-audio':
        S.audios=S.audios.filter(x=>x.id!==aid);
        db.save({igp_audios:S.audios});
        if(S.audioPlayingId===aid){ previewAudio.pause(); S.audioPlayingId=null; }
        renderBody();
        break;
      case 'clear-audio-debug': S.audioDebug=null; renderBody(); break;
      case 'ping-audio-engine': pingAudioEngine(); renderBody(); break;
      case 'link-org':      doLinkOrg(); break;
      case 'sync-org-now':  if(S.org&&S.org.code){ pullPipeline(S.org.code); pullLeads(S.org.code, true); db.save({igp_leads_pulled_at:Date.now()}); } break;
      case 'fix-open-name': { const p=S.detectedProfile; if(p){ const nm=findRealName(p.username); maybeFixLeadName(p.username,nm,p.url); if(nm.toLowerCase()===p.username.toLowerCase()) toast('Não achei o nome real nesta página','info'); renderBody(); } break; }
      case 'clear-leads':
        if(confirm('Apagar todos os leads? Não pode ser desfeito.')){ S.leads=[]; db.save({igp_l:S.leads}); renderBody(); }
        break;
    }
  }, true);

  shadow.addEventListener('click', e=>{
    // Date filter tabs
    const dfEl=e.target.closest('[data-df]');
    if(dfEl){ S.dateMode=dfEl.dataset.df; renderBody(); return; }

    const tabEl=e.target.closest('[data-tab]');
    if(tabEl){ S.tab=tabEl.dataset.tab; S.openStatusId=null; render(); }
    const filEl=e.target.closest('[data-fil]');
    if(filEl){ S.filter=filEl.dataset.fil; renderBody(); return; }

    const noteEl=e.target.closest('[data-note]');
    if(noteEl){
      const v=noteEl.dataset.note;
      S.noteSearch = (S.noteSearch||'').toLowerCase()===v.toLowerCase() ? '' : v;
      renderBody('notes'); return;
    }
    const noteClr=e.target.closest('[data-note-clear]');
    if(noteClr){ S.noteSearch=''; renderBody('notes'); return; }
  }, true);

  // Início do arrasto de um card de áudio — o resto do fluxo (soltar em cima
  // da conversa do Direct) é tratado nos listeners de 'dragover'/'drop' no
  // DOCUMENT da página, não aqui dentro do shadow (ver seção "AUDIO → DIRECT").
  shadow.addEventListener('dragstart', e=>{
    const card=e.target.closest('.audio-card');
    if(!card){ return; }
    e.dataTransfer.setData('application/x-igprospect-audio', card.dataset.aid);
    e.dataTransfer.effectAllowed='copy';
  });

  // ═══════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════
  // Sem equipe conectada, não captura nada — evita o lead ir pra equipe errada
  // (ou pra nenhuma). Manda o usuário direto pra tela de conectar.
  function requireOrg(){
    if(!S.org){
      toast('Conecte a equipe primeiro em ⚙️ Config','err');
      S.tab='settings'; render();
      return false;
    }
    if(!S.org.userId) toast('Lembre de dizer "quem é você" em ⚙️ Config — sem isso o lead não conta pra sua comissão','info');
    return true;
  }
  function doAddLead(){
    if(!S.form.name.trim()) return;
    if(!requireOrg()) return;
    const p=S.detectedProfile;
    const lead={
      id:Date.now().toString(), ...S.form,
      profileUrl: p&&p.username===S.form.username ? p.url : '',
      status:newLeadStatusKey(), addedAt:new Date().toISOString(), orgId:S.org&&S.org.id, synced:false
    };
    S.leads.unshift(lead);
    S.form={name:'',username:'',niche:'',notes:'',mutualFriends:''};
    S.showAdd=false;
    db.save({igp_l:S.leads});
    syncLeadAddDirect(lead);
    renderBody();
    toast('Lead adicionado!','ok');
  }

  function doAddDetected(){
    const p=S.detectedProfile;
    if(!p) return;
    if(!requireOrg()) return;
    if(S.leads.some(l=>l.username===p.username)){ toast('Lead já cadastrado','info'); return; }
    // tenta o nome real de novo na hora de salvar (caso a página tenha terminado de carregar)
    let realName=p.name;
    if(!realName || realName.toLowerCase()===p.username.toLowerCase()) realName=findRealName(p.username);
    const lead={
      id:Date.now().toString(),
      name:realName, username:p.username,
      profileUrl:p.url,
      niche:'', notes:'', mutualFriends:'',
      status:newLeadStatusKey(), addedAt:new Date().toISOString(), orgId:S.org&&S.org.id, synced:false
    };
    S.leads.unshift(lead);
    db.save({igp_l:S.leads});
    syncLeadAddDirect(lead);
    updateProfileBar();
    if(S.tab==='leads') renderBody(); else { S.tab='leads'; render(); }
    toast(`@${p.username} adicionado como lead!`,'ok');
  }

  function doSetStatus(lid,st){
    S.openStatusId=null;
    if(st===contactStatusKey()){
      const lead=S.leads.find(l=>l.id===lid);
      if(lead){ S.phoneLeadId=lid; S.phoneInput=lead.phone||''; renderBody(); }
    } else {
      S.leads=S.leads.map(l=>l.id===lid?{...l,status:st}:l);
      db.save({igp_l:S.leads});
      syncLeadUpdateDirect(lid,{status:st});
      renderBody();
    }
  }

  function doConfirmPhone(){
    if(!S.phoneInput.trim()||!S.phoneLeadId) return;
    const now=new Date().toISOString();
    S.leads=S.leads.map(l=>l.id===S.phoneLeadId?{...l,status:contactStatusKey(),phone:S.phoneInput.trim(),convertedAt:now}:l);
    db.save({igp_l:S.leads});
    syncLeadUpdateDirect(S.phoneLeadId,{status:contactStatusKey(),phone:S.phoneInput.trim()});
    const lead=S.leads.find(l=>l.id===S.phoneLeadId);
    S.phoneLeadId=null; S.phoneInput='';
    renderBody();
    toast('Contato registrado!','ok');
    if(lead) syncAgendor(lead);
  }

  function doDeleteLead(lid){
    S.leads=S.leads.filter(l=>l.id!==lid);
    db.save({igp_l:S.leads});
    syncLeadDeleteDirect(lid);
    renderBody();
  }

  // Lê cada arquivo importado como data URL (fica salvo no chrome.storage.local
  // da extensão — "unlimitedStorage" no manifest, senão o limite padrão de
  // ~10MB estoura rápido com áudio) e mede a duração antes de salvar, porque
  // é ela que decide quanto tempo "segurar" o microfone no envio (ver
  // pressAndHold).
  function handleAudioFiles(fileList){
    const files=Array.from(fileList||[]);
    if(!files.length) return;
    files.forEach(file=>{
      if(!file.type.startsWith('audio/')){ toast(`"${file.name}" não é um arquivo de áudio`,'err'); return; }
      const reader=new FileReader();
      reader.onload=()=>{
        const dataUrl=reader.result;
        const probe=new Audio();
        probe.preload='metadata';
        probe.addEventListener('loadedmetadata', ()=>{
          const entry={
            id: Date.now().toString()+Math.random().toString(36).slice(2,6),
            name: file.name.replace(/\.[^.]+$/,''),
            dataUrl, duration: probe.duration||0, addedAt: new Date().toISOString(),
          };
          S.audios.unshift(entry);
          db.save({igp_audios:S.audios});
          if(S.tab==='audios') renderBody();
          toast(`Áudio "${entry.name}" importado!`,'ok');
        }, {once:true});
        probe.addEventListener('error', ()=>toast(`Não consegui ler "${file.name}"`,'err'), {once:true});
        probe.src=dataUrl;
      };
      reader.onerror=()=>toast(`Erro ao importar "${file.name}"`,'err');
      reader.readAsDataURL(file);
    });
  }

  // Resolve o código da equipe (Configurações → Equipe, no sistema) via
  // background.js — a extensão não faz login, só usa a chave pública do
  // Supabase pra achar id/nome/token daquela equipe. Uma vez conectada,
  // fica travada aqui: nenhuma sincronização do painel sobrescreve mais
  // (ver bridge.js e o listener de storage no fim deste arquivo).
  function doLinkOrg(){
    const inp=shadow.getElementById('igp-orgcode');
    const code=((inp&&inp.value)||S.orgCodeInput||'').trim();
    if(!code){ toast('Digite o código da equipe','info'); return; }
    toast('Verificando código…','info');
    chrome.runtime.sendMessage({ type:'resolve_org_code', code }, res=>{
      if(!res||!res.ok||!res.org){
        const msg = res&&res.notFound===false
          ? `Erro ao verificar código: ${res.error||'peça pro dono rodar os SQL pendentes do sistema'}`
          : 'Código inválido — confira em Configurações → Equipe no sistema';
        toast(msg,'err'); return;
      }
      // A extensão só pode estar vinculada a UMA equipe por vez — trocar de
      // equipe zera os leads locais daqui. Sem isso, leads de uma equipe
      // ficavam "presos" como se fossem captura local não sincronizada e
      // somavam com os da equipe nova ao trocar.
      S.leads=[];
      S.org={ id:res.org.id, name:res.org.name, code, locked:true, userId:null, userName:'' };
      S.orgMembers=[];
      S.orgCodeInput='';
      // Reseta a trava de segurança também — é um contador por equipe conectada,
      // não faz sentido carregar o ritmo da equipe anterior pra essa nova.
      recentSyncTimes=[]; syncPaused=false;
      // CRÍTICO: também zera as etapas/mapeamento do Agendor cacheados — sem
      // isso, se o pullPipeline() da equipe nova demorar ou falhar por
      // qualquer motivo, a extensão continuava usando as etapas (e as KEYS)
      // da equipe ANTERIOR pra decidir status/Agendor da equipe nova, o que
      // é pior que usar o fallback genérico: as keys de uma equipe não têm
      // NENHUMA relação com as da outra. Cai no DEFAULT_STATUSES até o pull
      // da equipe nova confirmar as etapas de verdade dela.
      S.pipelineStages=null; S.agendorMap=null;
      // SEMPRE substitui o token pelo da equipe nova, mesmo vazio — antes só
      // atualizava quando a equipe TINHA token, então conectar numa equipe
      // sem Agendor mantinha o token cacheado de uma equipe anterior (ex.: de
      // teste), e a extensão mostrava "Token configurado" com o campo vazio
      // no sistema.
      S.agendorToken=res.org.agendor_token||'';
      db.save({igp_org:S.org, igp_l:S.leads, igp_leads_pulled_at:0, igp_sync_times:[], igp_sync_paused:false, igp_stages:null, igp_agendor_map:null, igp_tok:S.agendorToken});
      renderBody();
      toast(`✓ Conectado à equipe "${res.org.name}" — falta dizer quem é você`,'ok');
      chrome.runtime.sendMessage({ type:'resolve_org_members', code }, res2=>{
        S.orgMembers=(res2&&res2.ok&&res2.members)||[];
        if(S.orgMembers.length===1){ // só uma pessoa na equipe? já resolve sozinho
          S.org.userId=S.orgMembers[0].user_id; S.org.userName=S.orgMembers[0].name;
          db.save({igp_org:S.org});
        }
        renderBody();
      });
      pullPipeline(code);
      pullLeads(code, true);
    });
  }

  // Etapas de verdade do funil (Configurações → Personalização, no sistema) —
  // sem isso a extensão usa o fallback genérico (novo/chamado/respondeu/contato).
  function pullPipeline(code){
    chrome.runtime.sendMessage({ type:'pull_org_pipeline', code }, res=>{
      if(!res||!res.ok||!res.pipeline){ console.warn('IGProspect: falha ao puxar etapas do funil', res&&res.error); return; }
      S.pipelineStages=mapPipelineStages(res.pipeline.stages);
      S.agendorMap=res.pipeline.agendor_map||null;
      db.save({igp_stages:S.pipelineStages, igp_agendor_map:S.agendorMap});
      if(S.open) renderBody();
    });
  }
  // Mesma lógica do painel (app.js agendorStageFor): decide o destino no
  // Agendor conforme a ETAPA ATUAL do lead — mapeamento por etapa primeiro,
  // formato antigo "achatado" só como último recurso.
  function agendorStageFor(lead){
    const map=S.agendorMap; if(!map) return null;
    const byStage=map[lead.status||'novo']; if(byStage) return byStage;
    if(map.stageId) return map;
    return null;
  }

  // Traz os leads que já existem no sistema pra dentro da extensão — assim
  // ela não começa vazia toda vez que conecta uma equipe. showToast=true só
  // na conexão manual (evita popup toda vez que a extensão só reabre sozinha).
  function pullLeads(code, showToast){
    chrome.runtime.sendMessage({ type:'pull_org_leads', code }, res=>{
      if(!res||!res.ok){ console.warn('IGProspect: falha ao puxar leads do sistema', res&&res.error); return; }
      const server=res.leads||[];
      // Mescla por cima do que já existe localmente — preserva campos que só
      // vivem na extensão (notas, marcação manual de Agendor, etc.) em vez de
      // substituir o lead inteiro pela versão "enxuta" que vem do servidor.
      const localById=new Map(S.leads.map(l=>[String(l.id),l]));
      const merged=server.map(l=>{
        const loc=localById.get(l.ext_id)||{};
        return { ...loc,
          id:l.ext_id, name:l.name||l.username||'Lead', username:l.username||'',
          phone:l.phone||'', niche:l.niche||'', status:l.status||newLeadStatusKey(),
          addedAt:l.added_at||loc.addedAt||new Date().toISOString(), synced:true,
        };
      });
      const serverIds=new Set(server.map(l=>l.ext_id));
      // Some do servidor mas synced!==false (já tinha sido confirmado antes,
      // ou é um lead antigo de antes desse controle existir) = foi apagado
      // no sistema — some daqui também. Só mantém o que ainda está pendente
      // de sincronizar pela primeira vez (synced===false), pra não perder
      // captura recente antes dela sequer ter tido a chance de ir pro banco.
      const localOnly=S.leads.filter(l=>!serverIds.has(String(l.id)) && l.synced===false);
      S.leads=[...merged, ...localOnly];
      db.save({igp_l:S.leads});
      if(showToast) toast(`${server.length} lead(s) trazido(s) do sistema`,'ok');
      if(S.open) renderBody();
    });
  }

  // "Quem é você" — sem isso o lead grava sem prospector (created_by nulo),
  // e "prospectado por" fica em branco nos relatórios/comissão.
  function doPickProspector(userId){
    if(!S.org) return;
    const m=S.orgMembers.find(x=>x.user_id===userId);
    S.org={ ...S.org, userId: m?userId:null, userName: m?m.name:'' };
    db.save({igp_org:S.org});
    renderBody();
    if(m) toast(`✓ Leads agora são prospectados por ${m.name}`,'ok');
  }

  // Grava o lead direto no Supabase da equipe conectada, na hora — não
  // depende do painel estar aberto. "Fire and forget": se falhar (sem
  // internet, etc.) o lead continua salvo localmente e não trava a UI.
  // Trava de segurança (circuit breaker) — nenhum humano prospecta 100 leads
  // em 10 minutos manualmente. Se acontecer (bug de captura, equipe errada
  // conectada, automação de terceiros etc.), pausa o envio automático sozinha
  // em vez de deixar rodar solto por uma hora inteira sem ninguém perceber.
  // Some sozinha quando o ritmo volta ao normal (janela desliza).
  const SYNC_RATE_WINDOW_MS = 10*60*1000;
  const SYNC_RATE_LIMIT = 100;
  let recentSyncTimes = [];
  let syncPaused = false;
  function registerSyncAndCheck(){
    const cutoff=Date.now()-SYNC_RATE_WINDOW_MS;
    recentSyncTimes=recentSyncTimes.filter(t=>t>cutoff);
    recentSyncTimes.push(Date.now());
    db.save({igp_sync_times:recentSyncTimes});
    if(recentSyncTimes.length>SYNC_RATE_LIMIT){
      if(!syncPaused){
        syncPaused=true; db.save({igp_sync_paused:true});
        toast(`⚠️ Mais de ${SYNC_RATE_LIMIT} leads em ${SYNC_RATE_WINDOW_MS/60000}min — envio automático pausado por segurança. Avise o dono da equipe antes de continuar.`,'err');
      }
      return false;
    }
    if(syncPaused){ syncPaused=false; db.save({igp_sync_paused:false}); }
    return true;
  }
  function syncLeadAddDirect(lead){
    if(!S.org||!S.org.code) return;
    if(!registerSyncAndCheck()) return;
    chrome.runtime.sendMessage({ type:'add_lead_direct', code:S.org.code, lead, userId:S.org.userId||null }, res=>{
      if(!res||!res.ok){ console.warn('IGProspect: falha ao sincronizar lead direto', res&&res.error); return; }
      // Confirmado no banco — marca como sincronizado, senão o próximo pull
      // (que usa "sincronizado mas sumiu do servidor" = apagado) apagaria
      // esse lead local achando que ele nunca chegou a existir lá.
      const l=S.leads.find(x=>x.id===lead.id); if(l){ l.synced=true; db.save({igp_l:S.leads}); }
    });
  }
  function syncLeadUpdateDirect(extId, patch){
    if(!S.org||!S.org.code||!extId) return;
    chrome.runtime.sendMessage({ type:'update_lead_direct', code:S.org.code, extId, status:patch.status, phone:patch.phone, name:patch.name, agendorPersonId:patch.agendorPersonId, agendorDealId:patch.agendorDealId, agendorFunnel:patch.agendorFunnel }, res=>{
      if(!res||!res.ok) console.warn('IGProspect: falha ao atualizar lead direto', res&&res.error);
    });
  }
  // Apagar aqui apaga no sistema também (mão dupla — a outra direção, apagar
  // no sistema e a extensão perceber, é resolvida no pullLeads).
  function syncLeadDeleteDirect(extId){
    if(!S.org||!S.org.code||!extId) return;
    chrome.runtime.sendMessage({ type:'delete_lead_direct', code:S.org.code, extId }, res=>{
      if(!res||!res.ok) console.warn('IGProspect: falha ao apagar lead no sistema', res&&res.error);
    });
  }


  // ═══════════════════════════════════════════════
  // ═══════════════════════════════════════════════
  db.load().then(d=>{
    if(d.igp_l) S.leads=d.igp_l;
    if(d.igp_tok) S.agendorToken=d.igp_tok;
    if(d.igp_org) S.org=d.igp_org;
    if(d.igp_stages) S.pipelineStages=d.igp_stages;
    if(d.igp_agendor_map) S.agendorMap=d.igp_agendor_map;
    if(d.igp_sync_times) recentSyncTimes=d.igp_sync_times;
    if(d.igp_sync_paused) syncPaused=true;
    if(d.igp_audios) S.audios=d.igp_audios;
    render();
    extractProfile();
    // Repopula a lista de membros pra poder trocar/confirmar "quem é você"
    // sem precisar reconectar a equipe do zero a cada vez que a extensão recarrega.
    if(S.org&&S.org.code){
      chrome.runtime.sendMessage({ type:'resolve_org_members', code:S.org.code }, res=>{
        S.orgMembers=(res&&res.ok&&res.members)||[];
        if(S.open) renderBody();
      });
      pullPipeline(S.org.code); // barato, atualiza sempre — pega renomeações de etapa na hora
      // Puxar TODOS os leads é mais pesado — só repete de tempos em tempos,
      // não em toda recarga da extensão (cada navegação no Instagram, etc.).
      const lastPull=d.igp_leads_pulled_at||0;
      if(Date.now()-lastPull>10*60*1000){
        pullLeads(S.org.code, false);
        db.save({igp_leads_pulled_at:Date.now()});
      }
    }
  });
  // O painel (se aberto, na mesma equipe) ainda pode SUGERIR a equipe ativa —
  // mas nunca sobrescreve uma equipe travada aqui via código (ver doLinkOrg).
  try{
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.igp_org && !(S.org&&S.org.locked)) S.org = changes.igp_org.newValue || null;
    });
  } catch(e) { /* sem permissão de storage — ignora */ }

})();
