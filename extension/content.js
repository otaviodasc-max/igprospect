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
  `;

  // ═══════════════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════════════
  const STATUSES = [
    { key: 'novo',      label: 'Novo Lead',       color: '#818cf8', bg: 'rgba(129,140,248,0.12)' },
    { key: 'chamado',   label: 'Chamado',          color: '#fbbf24', bg: 'rgba(251,191,36,0.12)'  },
    { key: 'respondeu', label: 'Respondeu',        color: '#34d399', bg: 'rgba(52,211,153,0.12)'  },
    { key: 'contato',   label: 'Enviou Contato 📱', color: '#f472b6', bg: 'rgba(244,114,182,0.12)' },
  ];
  const RESERVED = new Set(['explore','reel','reels','p','tv','stories','accounts','direct','notifications','ar','challenges','audio','shop','about','privacy','help','']);
  // Títulos genéricos de seção do Instagram que às vezes acabam parando onde
  // deveria estar o nome da pessoa (fallback de heading pego errado no Direct).
  const GENERIC_NAMES = new Set(['mensagens','messages','direct','solicitações','solicitacoes','requests','inbox','chats','conversas']);

  const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  // ═══════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════
  let S = {
    leads: [], goal: 20,
    tab: 'dash', filter: 'all', search: '', noteSearch: '',
    showAdd: false,
    form: { name: '', username: '', niche: '', notes: '', mutualFriends: '' },
    phoneLeadId: null, phoneInput: '',
    goalInput: 20,
    open: false,
    openStatusId: null,
    detectedProfile: null,
    directDetect: null,        // { phone, leadId, name, username }
    directDismissed: '',       // key do número que o usuário ignorou
    agendorToken: '',
    agendorTokenInput: '',
    agendorStatus: {},
    // DATE FILTER STATE
    dateMode: 'today',   // 'today' | 'day' | 'month' | 'all'
    dateDay: new Date().toISOString().slice(0,10),    // YYYY-MM-DD
    dateMonth: new Date().getMonth(),                 // 0-11
    dateYear: new Date().getFullYear(),
    org: null,       // {id,name,code,locked,userId,userName} — equipe vinculada por código (ver doLinkOrg)
    orgCodeInput: '',
    orgMembers: [],  // membros da equipe conectada, pra escolher "quem é você" (doPickProspector)
  };

  // ═══════════════════════════════════════════════
  // STORAGE
  // ═══════════════════════════════════════════════
  const db = {
    load: () => new Promise(r => chrome.storage.local.get(['igp_l','igp_g','igp_tok','igp_org'], r)),
    save: d  => new Promise(r => chrome.storage.local.set(d, r)),
  };

  // ═══════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════
  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function badge(status) {
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
    const today = new Date().toDateString();
    const tl = S.leads.filter(l => new Date(l.addedAt).toDateString()===today);
    const ct = tl.filter(l=>l.status!=='novo').length;
    const tc = S.leads.filter(l=>l.status!=='novo').length;
    const re = S.leads.filter(l=>['respondeu','contato'].includes(l.status)).length;
    const cv = S.leads.filter(l=>l.status==='contato').length;

    // Period-filtered metrics
    const pl = leadsInPeriod(S.leads);
    const pCalled = pl.filter(l=>l.status!=='novo').length;
    const pResp   = pl.filter(l=>['respondeu','contato'].includes(l.status)).length;
    const pConv   = pl.filter(l=>l.status==='contato').length;

    return {
      todayLeads:tl, calledToday:ct, totalCalled:tc, responded:re, converted:cv,
      convRate: tc>0?Math.round(cv/tc*100):0,
      respRate: tc>0?Math.round(re/tc*100):0,
      pct: S.goal>0?Math.min(100,Math.round(ct/S.goal*100)):0,
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
      const bad=/^(seguir|follow|following|seguindo|message|mensagem|enviar mensagem|publicaç|posts?|seguidor|follower|verificad|editar|ver tudo|sugest|cancelar|nota|stories?|destaque)/i;
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
        if(bad.test(t)) continue;                       // botões/rótulos comuns
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
    const parse=(s)=>{
      if(!s) return '';
      const mm=s.match(/^(.+?)\s*\(@([A-Za-z0-9._]+)\)/);
      if(!mm || mm[2].toLowerCase()!==uLow) return '';
      const nm=mm[1].trim();
      return (nm && nm.toLowerCase()!=='instagram' && nm.toLowerCase()!==uLow) ? nm : '';
    };
    try{ const og=document.querySelector('meta[property="og:title"]'); const n=parse(og&&og.content); if(n) return n; }catch(_){}
    const n2=parse(document.title); if(n2) return n2;
    return username; // fallback seguro: usa o @ até conseguir o nome
  }

  function extractProfile() {
    const url = location.href;
    const m = url.match(/instagram\.com\/([a-zA-Z0-9._]+)\/?(\\?|$)/);
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
      const isHandle = !l.name || n===uLow || n==='@'+uLow || corrupted || GENERIC_NAMES.has(n);
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
    if(GENERIC_NAMES.has(name.toLowerCase())) name='';
    if(!name){
      const h=header.querySelector('h1,h2,[role="heading"]');
      const hName=h?(h.textContent||'').trim():'';
      name = GENERIC_NAMES.has(hName.toLowerCase()) ? '' : hName;
    }
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
    const already=lead && lead.status==='contato' && (lead.phone||'').replace(/\D/g,'')===d.phone.replace(/\D/g,'');
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
        status:'novo', addedAt:new Date().toISOString(), orgId:S.org&&S.org.id };
      S.leads.unshift(lead);
    }
    if(!lead){ toast('Abra o perfil do lead primeiro','info'); return; }
    const now=new Date().toISOString();
    S.leads=S.leads.map(l=>l.id===lead.id?{...l,status:'contato',phone:d.phone,convertedAt:l.convertedAt||now}:l);
    db.save({igp_l:S.leads});
    if(wasNew) syncLeadAddDirect({...lead,status:'contato',phone:d.phone});
    else syncLeadUpdateDirect(lead.id,{status:'contato',phone:d.phone});
    const updated=S.leads.find(l=>l.id===lead.id);
    S.directDetect=null; _lastDirectKey='';
    if(S.open) renderBody(); else updateDirectBar();
    toast(`✓ Contato de ${updated.name} registrado!`,'ok');
    if(S.agendorToken&&updated) syncAgendor(updated);
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
  // AGENDOR INTEGRATION
  // ═══════════════════════════════════════════════
  // Nome bonito p/ o Agendor: "Nome Real (@usuario)"
  function agendorName(lead){
    const nm=(lead.name||'').trim();
    const un=(lead.username||'').trim().replace(/^@/,'');
    if(nm && un && nm.toLowerCase()!==un.toLowerCase()) return `${nm} (@${un})`;
    if(nm) return nm;
    if(un) return `@${un}`;
    return 'Lead IGProspect';
  }

  function syncAgendor(lead) {
    if (!S.agendorToken||!lead.phone) return;
    if (lead.agendorManual||lead.agendorId) return;
    S.agendorStatus[lead.id]='syncing';
    renderBody();
    chrome.runtime.sendMessage({
      type: 'agendor_create_person',
      token: S.agendorToken,
      person: {
        name:       agendorName(lead),
        phone:      lead.phone,
        instagram:  lead.username||'',
        niche:      lead.niche||'',
        mutual:     lead.mutualFriends||'',
        notes:      lead.notes||'',
        profileUrl: lead.profileUrl||'',
      }
    }, resp=>{
      if (chrome.runtime.lastError) { S.agendorStatus[lead.id]='error'; toast('Erro ao conectar com Agendor','err'); renderBody(); return; }
      if (resp&&resp.ok) {
        S.agendorStatus[lead.id]='ok';
        const agendorId = resp.data&&(resp.data.id||(resp.data.data&&resp.data.data.id));
        S.leads=S.leads.map(l=>l.id===lead.id?{...l,agendorId}:l);
        db.save({igp_l:S.leads});
        toast('✓ Sincronizado com Agendor!','ok');
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
          ${S.tab==='dash'?renderDash(m):S.tab==='leads'?renderLeads():S.tab==='contacts'?renderContacts(m):renderSettings(m)}
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
    const gi=shadow.getElementById('igp-gi');
    if(gi) gi.addEventListener('input',e=>{S.goalInput=Number(e.target.value);});
    const ti=shadow.getElementById('igp-ti');
    if(ti) ti.addEventListener('input',e=>{S.agendorTokenInput=e.target.value;});
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
    body.innerHTML=S.tab==='dash'?renderDash(m):S.tab==='leads'?renderLeads():S.tab==='contacts'?renderContacts(m):renderSettings(m);
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

      <div class="card" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px">
          <span style="font-weight:600;color:#fff">Meta diária</span>
          <span style="color:${m.calledToday>=S.goal?'#34d399':'#666'}">${m.calledToday} / ${S.goal}</span>
        </div>
        <div style="background:#252525;border-radius:20px;height:6px"><div style="width:${m.pct}%;height:100%;background:linear-gradient(90deg,#833ab4,#fd1d1d,#fcb045);border-radius:20px;transition:width .4s"></div></div>
        <div style="font-size:11px;color:#444;margin-top:6px;text-align:right">${m.calledToday>=S.goal?'✅ Meta atingida!':'Faltam '+(S.goal-m.calledToday)+' chamadas'}</div>
      </div>

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
        ${STATUSES.map(s=>{const c=S.leads.filter(l=>l.status===s.key).length;const p2=S.leads.length>0?Math.round(c/S.leads.length*100):0;return`<div class="card" style="text-align:center;padding:10px 6px"><div style="font-size:20px;font-weight:700;color:${s.color}">${c}</div><div style="font-size:10px;color:#555;margin-top:3px;line-height:1.2">${s.label.replace(' 📱','')}</div><div style="font-size:10px;color:#333;margin-top:2px">${p2}%</div></div>`;}).join('')}
      </div>

      ${pl.length===0?`<div style="text-align:center;padding:20px 0;font-size:12px;color:#444">Nenhuma prospecção em ${periodLabel()}.</div>`:
        S.leads.length===0?`<div style="text-align:center;padding:30px 0"><div style="font-size:36px;margin-bottom:10px">🎯</div><div style="font-size:13px;color:#555;margin-bottom:12px">Nenhum lead ainda!</div><button class="btn-grad" data-a="go-leads-add">+ Adicionar lead</button></div>`:`
        <div style="font-size:11px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Recentes</div>
        ${pl.slice(0,5).map(l=>`
          <div style="background:#1a1a1a;border:1px solid #1e1e1e;border-radius:10px;padding:10px 12px;margin-bottom:5px;display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:28px;height:28px;border-radius:50%;background:${l.status==='contato'?'linear-gradient(135deg,#f472b6,#9333ea)':'linear-gradient(135deg,#833ab4,#fd1d1d)'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">${l.name.charAt(0).toUpperCase()}</div>
              <div>
                <div style="font-size:13px;font-weight:500;color:#fff">${esc(l.name)}</div>
                ${l.status==='contato'&&l.phone?`<div style="font-size:11px;color:#f472b6">📱 ${esc(l.phone)}</div>`:l.username?`<div style="font-size:11px;color:#444">@${esc(l.username)}</div>`:''}
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
        ${['all',...STATUSES.map(s=>s.key)].map(k=>{
          const s=STATUSES.find(x=>x.key===k);
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
      <div class="lead-card${l.status==='contato'?' cv':''}" data-lid="${l.id}">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <div style="width:34px;height:34px;border-radius:50%;background:${l.status==='contato'?'linear-gradient(135deg,#f472b6,#9333ea)':'linear-gradient(135deg,#833ab4,#fd1d1d)'};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#fff;flex-shrink:0">${l.name.charAt(0).toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span style="font-weight:600;font-size:13px;color:#fff">${esc(l.name)}</span>
              ${l.profileUrl?`<a href="${esc(l.profileUrl)}" target="_blank" style="font-size:11px;color:#818cf8;text-decoration:none">@${esc(l.username||'')} ↗</a>`:l.username?`<span style="font-size:11px;color:#555">@${esc(l.username)}</span>`:''}
            </div>
            ${l.status==='contato'&&l.phone?`
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
                  ${STATUSES.map((s,i)=>`<button class="smenu-opt" data-a="set-status" data-lid="${l.id}" data-st="${s.key}" style="color:${s.color};border-bottom:${i<STATUSES.length-1?'1px solid #252525':'none'}">${s.label}</button>`).join('')}
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
    const contacts=S.leads.filter(l=>l.status==='contato');
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
  // TAB: SETTINGS
  // ═══════════════════════════════════════════════
  function renderSettings(m){
    const tokMasked=S.agendorToken?S.agendorToken.slice(0,8)+'••••••••••••••••••••••••••••':'';
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
        `:''}
      </div>

      <div class="card" style="margin-bottom:10px">
        <div style="font-weight:600;font-size:13px;color:#fff;margin-bottom:12px">Meta diária de chamadas</div>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="number" id="igp-gi" class="inp" min="1" max="999" value="${S.goalInput}" style="width:75px;font-size:14px"/>
          <span style="color:#555;font-size:12px">chamadas / dia</span>
          <button class="btn-grad" data-a="save-goal" style="margin-left:auto;padding:7px 14px;font-size:12px">Salvar</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:10px;border-color:rgba(74,222,128,0.2)">
        <div style="font-weight:600;font-size:13px;color:#4ade80;margin-bottom:4px">☁ Integração Agendor CRM</div>
        <div style="font-size:12px;color:#555;margin-bottom:10px;line-height:1.5">${S.org?'Puxado automaticamente da equipe ao conectar. Só precisa colar aqui se quiser usar um token diferente do configurado no sistema.':'Conecte a uma equipe acima pra puxar o token automaticamente, ou cole o seu abaixo.'}</div>
        <label style="font-size:11px;color:#555;display:block;margin-bottom:4px">Token de API</label>
        <div style="display:flex;gap:7px;margin-bottom:8px">
          <input id="igp-ti" class="inp" placeholder="Cole o token aqui..." value="${S.agendorToken?tokMasked:esc(S.agendorTokenInput)}" style="flex:1;font-size:12px;${S.agendorToken?'color:#4ade80;border-color:rgba(74,222,128,0.3)':''}" ${S.agendorToken?'data-masked="1"':''}/>
          <button class="btn-agendor" data-a="save-token" style="padding:8px 12px">Salvar</button>
          ${S.agendorToken?`<button class="btn-danger" data-a="clear-token" style="padding:7px 10px;font-size:11px">✕</button>`:''}
        </div>
        ${S.agendorToken?`<div style="font-size:11px;color:#4ade80">✓ Token configurado — sincronização automática ativa</div>`:`<div style="font-size:11px;color:#555">Sem token configurado. Encontre o token em: <a href="https://app.agendor.com.br/api" target="_blank" style="color:#818cf8">app.agendor.com.br/api</a></div>`}
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
      case 'link-org':      doLinkOrg(); break;
      case 'save-goal':    doSaveGoal(); break;
      case 'save-token':   doSaveToken(); break;
      case 'clear-token':  S.agendorToken=''; S.agendorTokenInput=''; db.save({igp_tok:''}); renderBody(); break;
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
      status:'novo', addedAt:new Date().toISOString(), orgId:S.org&&S.org.id
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
      status:'novo', addedAt:new Date().toISOString(), orgId:S.org&&S.org.id
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
    if(st==='contato'){
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
    S.leads=S.leads.map(l=>l.id===S.phoneLeadId?{...l,status:'contato',phone:S.phoneInput.trim(),convertedAt:now}:l);
    db.save({igp_l:S.leads});
    syncLeadUpdateDirect(S.phoneLeadId,{status:'contato',phone:S.phoneInput.trim()});
    const lead=S.leads.find(l=>l.id===S.phoneLeadId);
    S.phoneLeadId=null; S.phoneInput='';
    renderBody();
    toast('Contato registrado!','ok');
    if(S.agendorToken&&lead) syncAgendor(lead);
  }

  function doDeleteLead(lid){
    S.leads=S.leads.filter(l=>l.id!==lid);
    db.save({igp_l:S.leads});
    renderBody();
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
      S.org={ id:res.org.id, name:res.org.name, code, locked:true, userId:null, userName:'' };
      S.orgMembers=[];
      S.orgCodeInput='';
      db.save({igp_org:S.org});
      if(res.org.agendor_token){
        S.agendorToken=res.org.agendor_token; S.agendorTokenInput='';
        db.save({igp_tok:res.org.agendor_token});
      }
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
  function syncLeadAddDirect(lead){
    if(!S.org||!S.org.code) return;
    chrome.runtime.sendMessage({ type:'add_lead_direct', code:S.org.code, lead, userId:S.org.userId||null }, res=>{
      if(!res||!res.ok) console.warn('IGProspect: falha ao sincronizar lead direto', res&&res.error);
    });
  }
  function syncLeadUpdateDirect(extId, patch){
    if(!S.org||!S.org.code||!extId) return;
    chrome.runtime.sendMessage({ type:'update_lead_direct', code:S.org.code, extId, status:patch.status, phone:patch.phone, name:patch.name }, res=>{
      if(!res||!res.ok) console.warn('IGProspect: falha ao atualizar lead direto', res&&res.error);
    });
  }

  function doSaveGoal(){
    S.goal=S.goalInput;
    db.save({igp_g:S.goal});
    renderBody();
    toast('Meta salva!','ok');
  }

  function doSaveToken(){
    const ti=shadow.getElementById('igp-ti');
    const val=ti&&!ti.dataset.masked?ti.value.trim():S.agendorTokenInput.trim();
    if(!val||val.includes('•')) return;
    S.agendorToken=val;
    S.agendorTokenInput='';
    db.save({igp_tok:val});
    renderBody();
    toast('Token Agendor salvo!','ok');
  }

  // ═══════════════════════════════════════════════
  // ═══════════════════════════════════════════════
  db.load().then(d=>{
    if(d.igp_l) S.leads=d.igp_l;
    if(d.igp_g){ S.goal=d.igp_g; S.goalInput=d.igp_g; }
    if(d.igp_tok){ S.agendorToken=d.igp_tok; S.agendorTokenInput=d.igp_tok; }
    if(d.igp_org) S.org=d.igp_org;
    render();
    extractProfile();
    // Repopula a lista de membros pra poder trocar/confirmar "quem é você"
    // sem precisar reconectar a equipe do zero a cada vez que a extensão recarrega.
    if(S.org&&S.org.code){
      chrome.runtime.sendMessage({ type:'resolve_org_members', code:S.org.code }, res=>{
        S.orgMembers=(res&&res.ok&&res.members)||[];
        if(S.open) renderBody();
      });
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
