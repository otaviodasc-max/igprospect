'use strict';
/* =====================================================================
   IGProspect SaaS — app
   Multi-inquilino por organização. Dados no Supabase (Postgres + RLS).
   Visual portado do dashboard original.
===================================================================== */

const CFG = window.IGP_CONFIG || {};
const CONFIGURED = CFG.SUPABASE_URL && CFG.SUPABASE_URL.startsWith('http') && CFG.SUPABASE_ANON_KEY && CFG.SUPABASE_ANON_KEY.length > 20;
const sb = CONFIGURED ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

/* ===== TEMA (claro/escuro) — aplicado antes de renderizar p/ não piscar ===== */
const THEME_KEY='igp_theme';
function applyTheme(t){ document.documentElement.setAttribute('data-theme', t==='light'?'light':'dark'); }
function currentTheme(){ try{ return localStorage.getItem(THEME_KEY)||'dark'; }catch(e){ return 'dark'; } }
function setTheme(t){ try{ localStorage.setItem(THEME_KEY,t); }catch(e){} applyTheme(t); if(typeof S!=='undefined'&&S.session) renderShell(); }
applyTheme(currentTheme());

const S = { session:null, profile:null, org:null, route:'dashboard', period:'all',
  leads:[], calls:[], deals:[], messages:[], unread:0, authMode:'login',
  pipelines:[], niches:[], dealStagesCfg:null, callOutcomesCfg:null,
  members:[], weeklyPayments:[], features:null,
  lf:{ q:'', note:'', status:'', niche:'', pipeline:'', sort:'newest', page:1, ag:'' },
  cf:{ q:'', outcome:'', sort:'newest', page:1 },
  crmPipelineId:'', crmQ:'', dealQ:'', goalsView:'week', _funnelStages:[], sel:{ mode:false, ids:new Set() },
  relView:'pay', relWeekOffset:0, relMemberId:'', relWeeksBack:12, relQ:'' };
const PAGE_SIZE = 25;
// Resolve o módulo de profissão ativo na organização atual (ver modules.js).
// Serve como PONTO DE PARTIDA ao criar uma org (backfill) e como fallback
// enquanto a org ainda não tem customização própria salva no banco.
function MOD(){ const id=(S.org&&S.org.module_id)||'consorcio'; return (window.IGP_MODULES&&window.IGP_MODULES[id])||window.IGP_MODULES.consorcio; }

/* ---------- Funis de lead (org_pipelines) — customizáveis pelo dono ---------- */
function defaultPipeline(){ return S.pipelines.find(p=>p.is_default) || S.pipelines[0] || null; }
function pipelineById(id){ return (id && S.pipelines.find(p=>p.id===id)) || defaultPipeline(); }
// Fallback (org sem pipelines carregados ainda, ex. antes do backfill rodar).
function fallbackStages(){ return MOD().prospectFunnel.stages.map((k,i)=>({key:k,label:MOD().prospectFunnel.meta[k].label,short:MOD().prospectFunnel.meta[k].short,color:MOD().prospectFunnel.colors[k],order:i})); }
function stagesOf(p){ const raw=(p&&p.stages&&p.stages.length)?p.stages:fallbackStages(); return raw.slice().sort((a,b)=>a.order-b.order); }
const STS = (p=defaultPipeline()) => stagesOf(p).map(s=>s.key);
const SM  = (p=defaultPipeline()) => Object.fromEntries(stagesOf(p).map(s=>[s.key,{label:s.label,short:s.short||s.label}]));
const SC  = (p=defaultPipeline()) => Object.fromEntries(stagesOf(p).map(s=>[s.key,s.color]));
// Rótulo/cor de um lead específico, respeitando o funil AO QUAL ELE PERTENCE
// (leads de funis diferentes podem ter status com o mesmo nome e cores diferentes).
function leadPipeline(l){ return pipelineById(l&&l.pipeline_id); }
function stLabel(l){ const st=(l&&l.status)||'novo'; const m=SM(leadPipeline(l)); return (m[st]&&m[st].label)||st||'—'; }
function stShort(l){ const st=(l&&l.status)||'novo'; const m=SM(leadPipeline(l)); return (m[st]&&m[st].short)||stLabel(l); }
function stColor(l){ const st=(l&&l.status)||'novo'; return SC(leadPipeline(l))[st]||'#64748B'; }
// Um lead "converteu" quando chega na ÚLTIMA etapa do funil ao qual pertence
// (era hardcoded para status==='contato'; agora vale para qualquer funil customizado).
function isLastStage(status, pipeline){ const stages=STS(pipeline); return stages.length>0 && stages[stages.length-1]===status; }

/* ---------- Desfechos de ligação (org_call_outcomes) — customizáveis pelo dono ---------- */
const DEFAULT_CALL_OUTCOMES = [
  {key:'interessado',label:'Interessado',color:'#10B981',order:0},
  {key:'retornar',label:'Retornar depois',color:'#F59E0B',order:1},
  {key:'sem_interesse',label:'Sem interesse',color:'#EF4444',order:2},
  {key:'nao_atendeu',label:'Não atendeu',color:'#64748B',order:3},
  {key:'fechado',label:'Fechou negócio',color:'#6366F1',order:4},
];
function callOutcomesRaw(){ const o=S.callOutcomesCfg&&S.callOutcomesCfg.outcomes; return (o&&o.length)?o:DEFAULT_CALL_OUTCOMES; }
const CALL_OUT = () => callOutcomesRaw().slice().sort((a,b)=>a.order-b.order).map(o=>o.key);
const COM = () => Object.fromEntries(callOutcomesRaw().map(o=>[o.key,o.label]));
const CC  = () => Object.fromEntries(callOutcomesRaw().map(o=>[o.key,o.color]));

/* ---------- Estágios de negociação (org_deal_stages) — customizáveis pelo dono ---------- */
function dealStagesRaw(){
  const cfg=S.dealStagesCfg&&S.dealStagesCfg.stages;
  if(cfg&&cfg.length) return cfg;
  const f=MOD().dealFunnel; return f.stages.map((k,i)=>({key:k,label:f.meta[k].label,short:f.meta[k].short,color:f.colors[k],order:i}));
}
const DEAL_STS   = () => dealStagesRaw().slice().sort((a,b)=>a.order-b.order).map(s=>s.key);
const DEAL_SM    = () => Object.fromEntries(dealStagesRaw().map(s=>[s.key,{label:s.label,short:s.short||s.label}]));
const DEAL_SC    = () => Object.fromEntries(dealStagesRaw().map(s=>[s.key,s.color]));
const WON        = () => (S.dealStagesCfg&&S.dealStagesCfg.won_stage) || MOD().dealFunnel.wonStage;
const LOST       = () => (S.dealStagesCfg&&S.dealStagesCfg.lost_stage) || MOD().dealFunnel.lostStage;
const CARD_TYPES = () => (S.dealStagesCfg&&S.dealStagesCfg.card_types&&S.dealStagesCfg.card_types.length) ? S.dealStagesCfg.card_types : MOD().cardTypes;

const AGENDOR_BASE = 'https://api.agendor.com.br/v3';
const slugify = s => String(s||'').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||('etapa_'+Date.now());

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const ini = n => { if(!n) return '?'; const w=String(n).trim().split(/\s+/); return (w.length>1?w[0][0]+w[w.length-1][0]:w[0].slice(0,2)).toUpperCase(); };
const fmtNum = n => n!=null ? Number(n).toLocaleString('pt-BR') : '—';
const fmtDate = iso => { if(!iso) return '—'; try{ return new Date(iso).toLocaleDateString('pt-BR'); }catch(e){ return '—'; } };
const fmtCurrency = v => v!=null ? Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : '—';
// Máscara de campo monetário (R$): separa o milhar com ponto à medida que se
// digita (ex.: "1500" -> "1.500"), sem travar a digitação. Se o usuário digitar
// uma vírgula, os dígitos depois dela viram os centavos, ao vivo (ex.: "1500,5"
// -> "1.500,5"). Só ao sair do campo (blur) é que os centavos são completados
// para 2 casas (ex.: "100" -> "100,00", "1.500,5" -> "1.500,50").
function maskMoneyInput(el){ if(!el) return;
  const liveFormat=raw=>{
    if(!raw) return '';
    const commaIdx=raw.indexOf(',');
    if(commaIdx===-1){
      const intPart=raw.replace(/\D/g,'').replace(/^0+(?=\d)/,'').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
      return intPart;
    }
    const intPart=raw.slice(0,commaIdx).replace(/\D/g,'').replace(/^0+(?=\d)/,'').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
    const decPart=raw.slice(commaIdx+1).replace(/\D/g,'').slice(0,2);
    return (intPart||'0')+','+decPart;
  };
  el.addEventListener('input',()=>{ el.value=liveFormat(el.value); });
  el.addEventListener('blur',()=>{
    if(!el.value) return;
    const commaIdx=el.value.indexOf(',');
    if(commaIdx===-1){ el.value=el.value+',00'; return; }
    let dec=el.value.slice(commaIdx+1); while(dec.length<2) dec+='0';
    el.value=el.value.slice(0,commaIdx)+','+dec;
  });
}
const moneyToNumber = s => { if(s==null||s==='') return null; const n=parseFloat(String(s).replace(/\./g,'').replace(',','.')); return isNaN(n)?null:n; };
const numberToMoney = n => (n==null||n==='') ? '' : Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
// Recoloca o foco/cursor num campo após um re-render (evita perder o foco ao digitar na busca)
function refocus(id){ const el=$(id); if(el){ el.focus(); const v=el.value||''; try{ el.setSelectionRange(v.length,v.length); }catch(e){} } }
const timeAgo = iso => { if(!iso) return ''; const m=Math.floor((Date.now()-new Date(iso))/60000); if(m<1)return'agora'; if(m<60)return m+'min atrás'; const h=Math.floor(m/60); if(h<24)return h+'h atrás'; const d=Math.floor(h/24); if(d<8)return d+'d atrás'; return fmtDate(iso); };
function toast(msg,type){ const el=document.createElement('div'); el.className='toast '+(type||''); el.textContent=msg; $('toast-ctr').appendChild(el); setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(),320); },3200); }
function openModal(html){ $('modal-root').innerHTML=html; }
function closeModal(){ $('modal-root').innerHTML=''; }
window.closeModal=closeModal;
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });
document.addEventListener('click',e=>{ if(e.target.classList&&e.target.classList.contains('modal-ov')) closeModal(); if(e.target.closest&&e.target.closest('.x')) closeModal(); });

const dayStart = n => { const d=new Date(); d.setHours(0,0,0,0); if(n>0) d.setDate(d.getDate()-n+1); return d; };
const inPeriod = (arr,period,key) => { key=key||'addedAt'; if(period==='all') return arr; const start=dayStart(parseInt(period)); return arr.filter(x=>x[key]&&new Date(x[key])>=start); };

/* ---------- seleção em massa (Leads / Negociações / CRM / Ligações) ---------- */
function selReset(){ S.sel.mode=false; S.sel.ids.clear(); }
function selToggle(id){ if(S.sel.ids.has(id)) S.sel.ids.delete(id); else S.sel.ids.add(id); }
function selBar(){
  if(!S.sel.mode) return `<button class="btn btn-outline btn-sm" data-selact="on"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>Selecionar</button>`;
  const n=S.sel.ids.size;
  return `<span style="font-size:.74rem;color:var(--t2);font-weight:600;white-space:nowrap">${n} selecionado(s)</span>
    <button class="btn btn-outline btn-sm" data-selact="all">Selecionar tudo</button>
    <button class="btn btn-outline btn-sm" data-selact="off">Cancelar</button>
    <button class="btn btn-danger btn-sm" data-selact="del" ${n?'':'disabled'}>Excluir (${n})</button>`;
}
function bindSelBar(allIds, rerender, doDelete){
  document.querySelectorAll('[data-selact]').forEach(b=>b.onclick=()=>{
    const a=b.dataset.selact;
    if(a==='on'){ S.sel.mode=true; }
    else if(a==='off'){ selReset(); }
    else if(a==='all'){ const sel=S.sel.ids; const allSel=allIds.length&&allIds.every(id=>sel.has(id)); if(allSel) allIds.forEach(id=>sel.delete(id)); else allIds.forEach(id=>sel.add(id)); }
    else if(a==='del'){ if(!S.sel.ids.size) return; confirmBulkDelete(S.sel.ids.size, doDelete); return; }
    rerender();
  });
}
function confirmBulkDelete(n, onOk){
  openModal(`<div class="modal-ov"><div class="modal-box" style="max-width:430px"><div class="modal-hd"><div><div class="modal-title">Excluir ${n} ${n===1?'item':'itens'}</div><div class="modal-sub">Ação permanente</div></div><div class="x"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div></div><div class="modal-bd"><p class="confirm-txt">Tem certeza que deseja excluir <b>${n}</b> ${n===1?'registro selecionado':'registros selecionados'}? Esta ação <b>não pode ser desfeita</b>.</p></div><div class="modal-ft"><button class="btn btn-outline" onclick="closeModal()">Cancelar</button><button class="btn btn-danger" id="bulk-ok">Excluir ${n}</button></div></div></div>`);
  $('bulk-ok').onclick=async()=>{ $('bulk-ok').disabled=true; await onOk(); };
}
const selCell = id => S.sel.mode?`<td class="sel-td" style="width:34px;text-align:center"><input type="checkbox" class="rowchk" data-sel="${esc(id)}" ${S.sel.ids.has(id)?'checked':''} style="width:16px;height:16px;accent-color:var(--p);cursor:pointer"></td>`:'';
const selChk = id => S.sel.mode?`<input type="checkbox" class="cardchk" data-sel="${esc(id)}" ${S.sel.ids.has(id)?'checked':''} style="width:17px;height:17px;accent-color:var(--p);flex-shrink:0;cursor:pointer">`:'';

async function deleteInChunks(table, ids){
  for(let i=0;i<ids.length;i+=200){
    const { error }=await sb.from(table).delete().in('id',ids.slice(i,i+200));
    if(error) return error;
  }
  return null;
}
async function bulkDeleteLeads(){
  const ids=[...S.sel.ids]; if(!ids.length){ closeModal(); return; }
  const agLeads = agendorOn() ? S.leads.filter(l=>S.sel.ids.has(l.id) && l.agendorPersonId) : [];
  const error=await deleteInChunks('leads',ids);
  if(error){ toast(error.message,'error'); return; }
  for(const l of agLeads){ await deleteFromAgendor(l); }
  selReset(); closeModal(); toast(`${ids.length} lead(s) excluído(s)${agLeads.length?` · ${agLeads.length} do Agendor`:''}`,'success');
  await loadLeads(); await loadDeals(); renderShell();
}
// Pergunta se os leads sem registro no Agendor já estão cadastrados lá (não reenviar)
// ou se devem ser enviados agora. Retorna true=enviar, false=já estão lá, null=cancelou.
function askAlreadyInAgendor(n){
  return new Promise(resolve=>{
    openModal(`<div class="modal-ov"><div class="modal-box" style="max-width:460px"><div class="modal-hd"><div><div class="modal-title">Enviar ao Agendor?</div><div class="modal-sub">${n} lead(s) selecionado(s) sem registro no Agendor</div></div><div class="x" id="ag-ask-x"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div></div><div class="modal-bd"><p class="confirm-txt">Esses leads já estão cadastrados no Agendor (ex.: você importou eles de lá) ou preciso enviá-los agora?</p></div><div class="modal-ft"><button class="btn btn-outline" id="ag-ask-already">☁ Já estão no Agendor</button><button class="btn btn-primary" id="ag-ask-send">Enviar ao Agendor</button></div></div></div>`);
    const finish=v=>{ closeModal(); resolve(v); };
    $('ag-ask-x').onclick=()=>finish(null);
    $('ag-ask-already').onclick=()=>finish(false);
    $('ag-ask-send').onclick=()=>finish(true);
  });
}
// Muda em massa a etapa dos leads selecionados (aba Leads). idx: 0=Novo Lead,
// 1=Chamado, 2=Respondeu, 'last'=Enviou Contato (posição na lista de etapas
// do FUNIL DE CADA LEAD, respeitando funis customizados). Ao mover pra "Enviou
// Contato" a negociação é criada automaticamente (mesmo trigger do banco usado
// no fluxo individual/CRM), e — se o Agendor estiver configurado — pergunta se
// os leads sem registro lá já estão cadastrados, pra não duplicar.
async function bulkSetLeadsStage(idx){
  const ids=[...S.sel.ids]; if(!ids.length){ toast('Selecione ao menos um lead','warn'); return; }
  const leads=ids.map(id=>S.leads.find(l=>l.id===id)).filter(Boolean);
  const isContatoAction = idx==='last';
  let markAsAgendor=false;
  if(isContatoAction && agendorOn()){
    const missing=leads.filter(l=>!l.agendorPersonId);
    if(missing.length){
      const wantsSend=await askAlreadyInAgendor(missing.length);
      if(wantsSend===null) return;
      markAsAgendor = !wantsSend;
    }
  }
  const byStatus={};
  for(const l of leads){
    const stages=stagesOf(leadPipeline(l)); if(!stages.length) continue;
    const i = idx==='last' ? stages.length-1 : Math.min(idx, stages.length-1);
    (byStatus[stages[i].key]=byStatus[stages[i].key]||[]).push(l.id);
  }
  for(const st in byStatus){
    const idsForSt=byStatus[st];
    for(let i=0;i<idsForSt.length;i+=200){ const{error}=await sb.from('leads').update({status:st}).in('id',idsForSt.slice(i,i+200)); if(error){ toast(error.message,'error'); return; } }
    idsForSt.forEach(id=>{ const l=S.leads.find(x=>x.id===id); if(l) l.status=st; });
  }
  if(markAsAgendor){
    const missingIds=leads.filter(l=>!l.agendorPersonId).map(l=>l.id);
    for(let i=0;i<missingIds.length;i+=200){ await sb.from('leads').update({agendor_person_id:'manual'}).in('id',missingIds.slice(i,i+200)); }
    missingIds.forEach(id=>{ const l=S.leads.find(x=>x.id===id); if(l) l.agendorPersonId='manual'; });
  }
  const dealTargets=leads.filter(l=>isLastStage(l.status,leadPipeline(l))||l.tipo==='empresario');
  if(dealTargets.length){
    const prospector=(S.profile&&(S.profile.name||S.profile.email))||null;
    const rows=dealTargets.map(l=>({ lead_id:l.id, prospector_name:prospector }));
    for(let i=0;i<rows.length;i+=200){ const{error}=await sb.from('deals').upsert(rows.slice(i,i+200),{onConflict:'lead_id',ignoreDuplicates:true}); if(error){ console.warn('bulkSetLeadsStage deals:',error.message); } }
    await loadDeals();
  }
  if(isContatoAction){
    for(const l of leads){ if(isLastStage(l.status,leadPipeline(l))) notifyLeadContato(l); }
    if(!markAsAgendor && agendorOn() && agendorAutoOn()){
      for(const l of leads){ if(!l.agendorPersonId) await sendLeadToAgendor(l.id,true); }
    }
  }
  selReset(); toast(`${ids.length} lead(s) atualizados`,'success'); renderShell();
}
async function bulkDeleteDeals(){
  const ids=[...S.sel.ids]; if(!ids.length){ closeModal(); return; }
  const error=await deleteInChunks('deals',ids);
  if(error){ toast(error.message,'error'); return; }
  selReset(); closeModal(); toast(`${ids.length} negociação(ões) excluída(s)`,'success');
  await loadDeals(); renderShell();
}
async function bulkDeleteCalls(){
  const ids=[...S.sel.ids]; if(!ids.length){ closeModal(); return; }
  const error=await deleteInChunks('calls',ids);
  if(error){ toast(error.message,'error'); return; }
  selReset(); closeModal(); toast(`${ids.length} ligação(ões) excluída(s)`,'success');
  await loadCalls(); renderShell();
}

/* =====================================================================
   AUTH
===================================================================== */
function renderAuth(){
  $('app').classList.remove('show'); $('onboard').classList.add('hidden'); $('auth').classList.remove('hidden');
  const cfgWarn = CONFIGURED ? '' : `<div class="cfg-warn">⚠️ Configure o <b>config.js</b> com a URL e a anon key do Supabase.</div>`;
  const login = S.authMode==='login';
  $('auth-card').innerHTML = `
    <div class="auth-logo">
      <div class="logo-ico"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10" r="6"/><line x1="14.8" y1="14.3" x2="20" y2="19.5"/><circle cx="10.5" cy="8.2" r="1.7"/><path d="M7.4 12.7a3.3 3.3 0 0 1 6.2 0"/></svg></div>
      <div><div class="l1">IGProspect</div><div class="l2">Sistema de Prospecção</div></div>
    </div>
    ${cfgWarn}
    <div class="auth-h">${login?'Entrar':'Criar conta'}</div>
    <div class="auth-sub">${login?'Acesse com seu e-mail e senha.':'Cadastre-se para começar.'}</div>
    ${login?'':`<div class="field"><label>Nome</label><input class="inp" id="au-name" placeholder="Seu nome"></div>`}
    <div class="field"><label>E-mail</label><input class="inp" id="au-email" type="email" placeholder="voce@email.com" autocomplete="email"></div>
    <div class="field"><label>Senha</label><input class="inp" id="au-pass" type="password" placeholder="••••••••" autocomplete="${login?'current-password':'new-password'}"></div>
    <button class="btn-block" id="au-go" ${CONFIGURED?'':'disabled'}>${login?'Entrar':'Criar conta'}</button>
    <div class="auth-err" id="au-err"></div>
    <div class="auth-alt">${login?'Não tem conta?':'Já tem conta?'} <a id="au-switch">${login?'Criar conta':'Entrar'}</a></div>`;
  $('au-switch').onclick=()=>{ S.authMode=login?'signup':'login'; renderAuth(); };
  $('au-go').onclick=doAuth;
  $('au-pass').addEventListener('keydown',e=>{ if(e.key==='Enter') doAuth(); });
}
function authErr(m,ok){ const e=$('au-err'); e.style.color=ok?'#6EE7B7':'#FC8181'; e.textContent=m; e.classList.add('show'); }
async function doAuth(){
  if(!sb) return;
  const email=$('au-email').value.trim(), pass=$('au-pass').value;
  if(!email||!pass){ authErr('Preencha e-mail e senha.'); return; }
  $('au-go').disabled=true;
  try{
    if(S.authMode==='signup'){
      const name=$('au-name').value.trim();
      const { data, error } = await sb.auth.signUp({ email, password:pass, options:{ data:{ full_name:name } } });
      if(error) throw error;
      if(!data.session){ S.authMode='login'; renderAuth(); authErr('Conta criada! Confirme pelo link no seu e-mail e depois entre.',true); return; }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password:pass });
      if(error) throw error;
    }
    await boot();
  }catch(err){ authErr(traduzErro(err.message)); $('au-go').disabled=false; }
}
function traduzErro(m){
  if(/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if(/already registered/i.test(m)) return 'Este e-mail já tem conta. Tente entrar.';
  if(/at least 6/i.test(m)) return 'A senha precisa ter ao menos 6 caracteres.';
  if(/Email not confirmed/i.test(m)) return 'Confirme seu e-mail (ou desative a confirmação no Supabase).';
  return m;
}

/* =====================================================================
   ONBOARDING
===================================================================== */
// Questionário que escolhe o Módulo de Profissão (ver modules.js) para a
// nova organização. Regras fixas, sem IA: cada opção soma pontos por
// módulo, o maior total vence (empate cai em 'consorcio', 1º da ordem).
const QUIZ = [
  { id:'q1', weight:3, label:'O que você vende ou oferece?', options:[
    { key:'a', label:'Cartas de consórcio (imóvel, veículo, investimento)', points:{consorcio:3} },
    { key:'b', label:'Imóveis (compra, venda, aluguel)', points:{imoveis:3} },
    { key:'c', label:'Seguros (auto, vida, residencial, saúde...)', points:{seguros:3} },
    { key:'d', label:'Software, assinatura ou curso/infoproduto', points:{saas:3} },
    { key:'e', label:'Outro', points:{consorcio:1,imoveis:1,seguros:1,saas:1} },
  ]},
  { id:'q2', weight:1, label:'Qual sua principal fonte de leads?', options:[
    { key:'a', label:'Instagram / redes sociais (prospecção ativa)', points:{consorcio:2,imoveis:1,seguros:1,saas:1} },
    { key:'b', label:'Indicação e carteira de clientes', points:{imoveis:2,seguros:2} },
    { key:'c', label:'Site, anúncios pagos, inbound', points:{saas:2,imoveis:1} },
    { key:'d', label:'Portais especializados (ex.: Zap Imóveis, comparadores)', points:{imoveis:2,seguros:2} },
  ]},
  { id:'q3', weight:1, label:'Quanto tempo dura, em média, do primeiro contato até fechar?', options:[
    { key:'a', label:'Menos de 1 semana', points:{seguros:2,saas:1} },
    { key:'b', label:'1 a 4 semanas', points:{consorcio:1,seguros:1,imoveis:1,saas:2} },
    { key:'c', label:'1 a 3 meses', points:{consorcio:2,imoveis:2} },
    { key:'d', label:'Mais de 3 meses', points:{imoveis:2,saas:1} },
  ]},
  { id:'q4', weight:1, label:'Como você chama o resultado final de uma venda fechada?', options:[
    { key:'a', label:'Uma carta contemplada/vendida', points:{consorcio:3} },
    { key:'b', label:'Um imóvel vendido ou alugado', points:{imoveis:3} },
    { key:'c', label:'Uma apólice emitida', points:{seguros:3} },
    { key:'d', label:'Um contrato assinado / cliente ativo', points:{saas:3} },
  ]},
];
function scoreModule(answers){
  const order=window.IGP_MODULE_ORDER||['consorcio'];
  const totals={}; order.forEach(m=>totals[m]=0);
  QUIZ.forEach(q=>{ const opt=q.options.find(o=>o.key===answers[q.id]); if(!opt) return;
    for(const m in opt.points){ if(totals[m]!=null) totals[m]+=opt.points[m]*q.weight; } });
  let best=order[0], bestScore=-1;
  order.forEach(m=>{ if(totals[m]>bestScore){ best=m; bestScore=totals[m]; } });
  return { moduleId:best, totals };
}
function renderOnboard(){
  $('auth').classList.add('hidden'); $('app').classList.remove('show'); $('onboard').classList.remove('hidden');
  $('onboard-card').innerHTML=`
    <div class="auth-logo"><div class="logo-ico"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div><div><div class="l1">Seu espaço</div><div class="l2">Onde seus leads ficam</div></div></div>
    <div class="auth-h">Bem-vindo!</div>
    <div class="auth-sub">Crie um espaço novo (você vira o dono) ou entre num existente com o código de convite.</div>
    <div class="seg"><button class="active" id="sg-new">Criar espaço</button><button id="sg-join">Entrar por código</button></div>
    <div id="ob-body"></div>
    <div class="auth-err" id="ob-err"></div>`;
  let mode='new', orgName='';
  const body=()=>{ $('ob-body').innerHTML = mode==='new'
    ? `<div class="field"><label>Nome do espaço</label><input class="inp" id="ob-name" placeholder="Ex.: Equipe da Chefe" value="${esc(orgName)}"></div><button class="btn-block" id="ob-go">Continuar</button>`
    : `<div class="field"><label>Código de convite</label><input class="inp" id="ob-code" placeholder="Ex.: 7K2P9X" style="text-transform:uppercase"></div><button class="btn-block" id="ob-go">Entrar no espaço</button>`;
    $('ob-go').onclick = mode==='new' ? (()=>{ orgName=$('ob-name').value.trim()||'Meu espaço'; renderModuleQuiz(orgName); }) : doJoinOrg;
  };
  $('sg-new').onclick=()=>{ mode='new'; $('sg-new').classList.add('active'); $('sg-join').classList.remove('active'); body(); };
  $('sg-join').onclick=()=>{ mode='join'; $('sg-join').classList.add('active'); $('sg-new').classList.remove('active'); body(); };
  body();
}
// Tela 2 do onboarding: questionário de 1 pergunta por vez que escolhe o
// Módulo de Profissão da nova organização.
function renderModuleQuiz(orgName, step=0, answers={}){
  const total=QUIZ.length;
  if(step>=total){ renderModuleResult(orgName, answers); return; }
  const q=QUIZ[step];
  const dots=Array.from({length:total},(_,i)=>`<span style="width:6px;height:6px;border-radius:50%;background:${i<=step?'var(--p)':'var(--surf3)'}"></span>`).join('');
  $('onboard-card').innerHTML=`
    <div class="auth-logo"><div class="logo-ico"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div><div><div class="l1">${esc(orgName)}</div><div class="l2">Pergunta ${step+1} de ${total}</div></div></div>
    <div style="display:flex;gap:5px;margin:4px 0 16px">${dots}</div>
    <div class="auth-h" style="font-size:1.05rem">${esc(q.label)}</div>
    <div id="quiz-opts" style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
      ${q.options.map(o=>`<button class="btn btn-outline" style="text-align:left;justify-content:flex-start" data-opt="${o.key}">${esc(o.label)}</button>`).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:16px">
      <button class="btn btn-outline btn-sm" id="quiz-back">${step===0?'Voltar':'‹ Anterior'}</button>
      <button class="btn btn-outline btn-sm" id="quiz-skip">Pular por enquanto</button>
    </div>`;
  $('quiz-opts').onclick=e=>{ const b=e.target.closest('[data-opt]'); if(!b)return; renderModuleQuiz(orgName, step+1, { ...answers, [q.id]:b.dataset.opt }); };
  $('quiz-back').onclick=()=> step===0 ? renderOnboard() : renderModuleQuiz(orgName, step-1, answers);
  $('quiz-skip').onclick=()=> doCreateOrg(orgName, 'consorcio', answers);
}
// Tela 3: mostra o módulo escolhido pelo questionário, com opção de trocar
// manualmente antes de confirmar a criação do espaço.
function renderModuleResult(orgName, answers){
  const { moduleId }=scoreModule(answers);
  const order=window.IGP_MODULE_ORDER||['consorcio'];
  const render=sel=>{
    const m=window.IGP_MODULES[sel];
    $('onboard-card').innerHTML=`
      <div class="auth-logo"><div class="logo-ico"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div><div><div class="l1">${esc(orgName)}</div><div class="l2">Módulo sugerido</div></div></div>
      <div class="auth-h">${m.icon} Achamos que seu negócio é: ${esc(m.name)}</div>
      <div class="auth-sub">O sistema já vem configurado com o funil, os termos e os campos certos para ${esc(m.name)}. Você pode trocar isso depois em Configurações.</div>
      <div class="field"><label>Não é bem isso? Escolha manualmente</label><select class="inp" id="mq-sel">${order.map(id=>`<option value="${id}" ${id===sel?'selected':''}>${window.IGP_MODULES[id].icon} ${window.IGP_MODULES[id].name}</option>`).join('')}</select></div>
      <button class="btn-block" id="mq-go">Confirmar e criar espaço</button>
      <div class="auth-err" id="ob-err"></div>`;
    $('mq-sel').onchange=e=>render(e.target.value);
    $('mq-go').onclick=()=>doCreateOrg(orgName, $('mq-sel').value, answers);
  };
  render(moduleId);
}
async function doCreateOrg(orgName, moduleId, answers){
  const btn=$('mq-go')||$('quiz-skip'); if(btn) btn.disabled=true;
  const { data:orgId, error }=await sb.rpc('create_org',{ p_name:orgName||'Meu espaço', p_module_id:moduleId||'consorcio' });
  if(error){ if($('ob-err')){ $('ob-err').textContent=error.message; $('ob-err').classList.add('show'); } if(btn) btn.disabled=false; return; }
  if(orgId && answers && Object.keys(answers).length) await sb.from('orgs').update({ module_answers:answers }).eq('id',orgId);
  toast('Espaço criado!','success'); await boot();
}
async function doJoinOrg(){ const code=$('ob-code').value.trim(); if(!code) return; $('ob-go').disabled=true; const { error }=await sb.rpc('join_org',{ p_code:code }); if(error){ $('ob-err').textContent='Código inválido.'; $('ob-err').classList.add('show'); $('ob-go').disabled=false; return; } toast('Você entrou no espaço!','success'); await boot(); }

/* =====================================================================
   DATA LAYER (mapeia snake_case <-> camelCase)
===================================================================== */
const leadFromRow = r => ({ id:r.id, name:r.name, username:r.username, phone:r.phone, email:r.email, niche:r.niche, status:r.status||'novo', tipo:r.tipo||'comum', pipeline_id:r.pipeline_id, funil:r.funil, cidade:r.cidade, estado:r.estado, cnpj:r.cnpj, notes:r.notes, followers:r.followers, following:r.following, source:r.source, addedAt:r.added_at, createdBy:r.created_by, extId:r.ext_id, agendorPersonId:r.agendor_person_id, agendorDealId:r.agendor_deal_id, agendorFunnel:r.agendor_funnel, agendorStatus:r.agendor_status, customFields:r.custom_fields||{} });
const leadToRow = l => { const o={ name:l.name, username:l.username, phone:l.phone, email:l.email, niche:l.niche, status:l.status, tipo:l.tipo, notes:l.notes, followers:l.followers, following:l.following }; if(l.pipeline_id!==undefined)o.pipeline_id=l.pipeline_id; if(l.source)o.source=l.source; if(l.customFields)o.custom_fields=l.customFields; return o; };
const callFromRow = r => ({ id:r.id, leadId:r.lead_id, name:r.name, phone:r.phone, outcome:r.outcome||'nao_atendeu', duration:r.duration, at:r.at, notes:r.notes, createdBy:r.created_by });
const callToRow = c => ({ lead_id:c.leadId||null, name:c.name, phone:c.phone, outcome:c.outcome, duration:c.duration, at:c.at, notes:c.notes });
const dealFromRow = r => ({ id:r.id, orgId:r.org_id, leadId:r.lead_id, createdBy:r.created_by, prospectorName:r.prospector_name, status:r.status||'contato', cardType:r.card_type, cardValue:r.card_value, commissionValue:r.commission_value, commissionPct:r.commission_pct, commissionPaid:!!r.commission_paid, paidAt:r.paid_at, report:r.report, notes:r.notes, closedAt:r.closed_at, createdAt:r.created_at, leadName:r.leads&&r.leads.name, leadUsername:r.leads&&r.leads.username, leadPhone:r.leads&&r.leads.phone, leadNiche:r.leads&&r.leads.niche });
const dealToRow = d => { const o={updated_at:new Date().toISOString()}; if(d.status!==undefined)o.status=d.status; if(d.cardType!==undefined)o.card_type=d.cardType||null; if(d.cardValue!==undefined)o.card_value=d.cardValue!=null&&d.cardValue!==''?Number(d.cardValue):null; if(d.commissionValue!==undefined)o.commission_value=d.commissionValue!=null&&d.commissionValue!==''?Number(d.commissionValue):null; if(d.commissionPct!==undefined)o.commission_pct=d.commissionPct!=null&&d.commissionPct!==''?Number(d.commissionPct):null; if(d.commissionPaid!==undefined)o.commission_paid=!!d.commissionPaid; if(d.paidAt!==undefined)o.paid_at=d.paidAt||null; if(d.report!==undefined)o.report=d.report; if(d.notes!==undefined)o.notes=d.notes; if(d.closedAt!==undefined)o.closed_at=d.closedAt||null; return o; };
const weeklyPaymentFromRow = r => ({ id:r.id, orgId:r.org_id, memberId:r.member_id, memberName:r.member_name, weekStart:r.week_start, weekEnd:r.week_end, prospectLeads:r.prospect_leads, prospectPay:Number(r.prospect_pay)||0, commissionPay:Number(r.commission_pay)||0, total:Number(r.total)||0, dealIds:r.deal_ids||[], createdAt:r.created_at });

// Busca TODAS as linhas em páginas (Supabase limita cada consulta a 1000 linhas).
// Sem isso, leads antigos (ex.: empresários de janeiro) ficavam fora das 1000 mais
// recentes e nunca apareciam, mesmo importados com sucesso.
async function fetchAll(build){ const PAGE=1000; let from=0, out=[]; for(;;){ const { data, error }=await build().range(from,from+PAGE-1); if(error) return { data:null, error }; const rows=data||[]; out=out.concat(rows); if(rows.length<PAGE) break; from+=PAGE; } return { data:out, error:null }; }
async function loadLeads(){ const { data, error }=await fetchAll(()=>sb.from('leads').select('*').order('added_at',{ascending:false})); if(error){ toast('Erro ao carregar leads: '+error.message,'error'); return; } S.leads=(data||[]).map(leadFromRow); }
async function loadCalls(){ const { data, error }=await fetchAll(()=>sb.from('calls').select('*').order('at',{ascending:false})); if(error){ S.calls=[]; return; } S.calls=(data||[]).map(callFromRow); }
async function loadDeals(){ const { data, error }=await fetchAll(()=>sb.from('deals').select('*, leads(name,username,phone,niche)').order('created_at',{ascending:false})); if(error){ S.deals=[]; return; } S.deals=(data||[]).map(dealFromRow); }
const msgFromRow = r => ({ id:r.id, orgId:r.org_id, userId:r.user_id, author:r.author_name, body:r.body, at:r.created_at });
async function loadMessages(){ const { data, error }=await sb.from('messages').select('*').order('created_at',{ascending:false}).limit(200); if(error){ S.messages=[]; return; } S.messages=(data||[]).map(msgFromRow).reverse(); }

// Customização por org (Personalização): funis, nichos, estágios de negociação e desfechos de ligação.
// Se as tabelas ainda não foram migradas (supabase-pipelines.sql não rodou), os arrays ficam vazios
// e os helpers (STS/DEAL_STS/CALL_OUT etc.) caem no fallback do módulo — nada quebra.
async function loadPipelines(){ const { data, error }=await sb.from('org_pipelines').select('*').order('order_idx'); if(error){ S.pipelines=[]; return; } S.pipelines=data||[]; }
async function loadNiches(){ const { data, error }=await sb.from('org_niches').select('*').order('order_idx'); if(error){ S.niches=[]; return; } S.niches=data||[]; }
async function loadDealStagesCfg(){ if(!S.org) return; const { data }=await sb.from('org_deal_stages').select('*').eq('org_id',S.org.id).maybeSingle(); S.dealStagesCfg=data||null; }
async function loadCallOutcomesCfg(){ if(!S.org) return; const { data }=await sb.from('org_call_outcomes').select('*').eq('org_id',S.org.id).maybeSingle(); S.callOutcomesCfg=data||null; }
async function loadOrgConfig(){ await Promise.all([loadPipelines(), loadNiches(), loadDealStagesCfg(), loadCallOutcomesCfg()]); }

// Membros ativos na organização atual (aba Relatórios — pagamento por pessoa)
// e histórico de pagamentos semanais já confirmados (nunca some da tela).
async function loadMembers(){ if(!S.org) return; const { data, error }=await sb.from('profiles').select('id,name,email,org_role').eq('org_id',S.org.id).order('name'); if(error){ S.members=[]; return; } S.members=data||[]; }
async function loadWeeklyPayments(){ const { data, error }=await sb.from('weekly_payments').select('*').order('week_start',{ascending:false}); if(error){ S.weeklyPayments=[]; return; } S.weeklyPayments=(data||[]).map(weeklyPaymentFromRow); }

/* =====================================================================
   METRICS / CHARTS (portados do original)
===================================================================== */
const metrics = leads => { const c={novo:0,chamado:0,respondeu:0,contato:0}; for(const l of leads){ const s=l.status||'novo'; if(c[s]!=null) c[s]++; } return c; };
const topNiches = (leads,n=8) => { const m={}; for(const l of leads){ const k=(l.niche||'Sem nicho').trim()||'Sem nicho'; m[k]=(m[k]||0)+1; } return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,n); };
const timeline14 = leads => { const t=new Date(); t.setHours(0,0,0,0); return Array.from({length:14},(_,i)=>{ const day=new Date(t); day.setDate(day.getDate()-(13-i)); const nx=new Date(day); nx.setDate(nx.getDate()+1); return { date:day, count:leads.filter(l=>{ if(!l.addedAt)return false; const d=new Date(l.addedAt); return d>=day&&d<nx; }).length }; }); };
const weeklyTrend = leads => { const now=new Date(); now.setHours(0,0,0,0); return Array.from({length:8},(_,i)=>{ const ri=7-i; const s=new Date(now); s.setDate(s.getDate()-ri*7-6); const e=new Date(now); e.setDate(e.getDate()-ri*7+1); return { label:`S${i+1}`, count:leads.filter(l=>l.addedAt&&new Date(l.addedAt)>=s&&new Date(l.addedAt)<e).length }; }); };
function drawTimeline(data){ const cv=$('tl-chart'); if(!cv)return; const ctx=cv.getContext('2d'); const W=cv.parentElement.offsetWidth||500,H=155; cv.width=W;cv.height=H; const P={t:14,r:14,b:28,l:34},cW=W-P.l-P.r,cH=H-P.t-P.b,maxV=Math.max(...data.map(d=>d.count),1),step=cW/((data.length-1)||1); ctx.clearRect(0,0,W,H);
  const GRID=cssVar('--chart-grid'),AXIS=cssVar('--chart-axis'),NODE=cssVar('--chart-node');
  for(let i=0;i<=4;i++){ const y=P.t+(cH/4)*i; ctx.strokeStyle=GRID;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(P.l,y);ctx.lineTo(P.l+cW,y);ctx.stroke(); ctx.fillStyle=AXIS;ctx.font='9.5px Inter';ctx.textAlign='right';ctx.fillText(Math.round(maxV-(maxV/4)*i),P.l-5,y+3); }
  const pts=data.map((d,i)=>({x:P.l+i*step,y:P.t+cH-(d.count/maxV)*cH})); const g=ctx.createLinearGradient(0,P.t,0,P.t+cH); g.addColorStop(0,'rgba(99,102,241,.3)');g.addColorStop(1,'rgba(99,102,241,0)');
  ctx.beginPath();ctx.moveTo(pts[0].x,P.t+cH);ctx.lineTo(pts[0].x,pts[0].y); for(let i=1;i<pts.length;i++){const c=(pts[i-1].x+pts[i].x)/2;ctx.bezierCurveTo(c,pts[i-1].y,c,pts[i].y,pts[i].x,pts[i].y);} ctx.lineTo(pts[pts.length-1].x,P.t+cH);ctx.closePath();ctx.fillStyle=g;ctx.fill();
  ctx.beginPath();ctx.strokeStyle='#6366F1';ctx.lineWidth=2.5;ctx.lineJoin='round';ctx.moveTo(pts[0].x,pts[0].y); for(let i=1;i<pts.length;i++){const c=(pts[i-1].x+pts[i].x)/2;ctx.bezierCurveTo(c,pts[i-1].y,c,pts[i].y,pts[i].x,pts[i].y);} ctx.stroke();
  pts.forEach((p,i)=>{ if(data[i].count>0){ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);ctx.fillStyle='#6366F1';ctx.fill();ctx.strokeStyle=NODE;ctx.lineWidth=2;ctx.stroke();} });
  ctx.fillStyle=AXIS;ctx.font='9px Inter';ctx.textAlign='center'; data.forEach((d,i)=>{ if(i%2===0)ctx.fillText(d.date.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}),pts[i].x,H-7); }); }
function drawWeekly(data){ const cv=$('wk-chart'); if(!cv)return; const ctx=cv.getContext('2d'); const W=cv.parentElement.offsetWidth||500,H=125; cv.width=W;cv.height=H; const P={t:10,r:12,b:26,l:28},cW=W-P.l-P.r,cH=H-P.t-P.b,maxV=Math.max(...data.map(d=>d.count),1),boff=cW/data.length,bw=Math.max(Math.floor(boff*.62),4); ctx.clearRect(0,0,W,H);
  const GRID=cssVar('--chart-grid'),AXIS=cssVar('--chart-axis');
  for(let i=0;i<=3;i++){const y=P.t+(cH/3)*i;ctx.strokeStyle=GRID;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(P.l,y);ctx.lineTo(P.l+cW,y);ctx.stroke();}
  data.forEach((d,i)=>{ const x=P.l+i*boff+(boff-bw)/2,bh=(d.count/maxV)*cH,y=P.t+cH-bh; if(d.count===0)return; const g=ctx.createLinearGradient(0,y,0,y+bh);g.addColorStop(0,'rgba(99,102,241,.88)');g.addColorStop(1,'rgba(99,102,241,.22)'); ctx.beginPath(); if(ctx.roundRect)ctx.roundRect(x,y,bw,bh,3);else ctx.rect(x,y,bw,bh); ctx.fillStyle=g;ctx.fill(); ctx.fillStyle=AXIS;ctx.font='8.5px Inter';ctx.textAlign='center';ctx.fillText(d.count,x+bw/2,y-4); });
  ctx.fillStyle=AXIS;ctx.font='9px Inter';ctx.textAlign='center'; data.forEach((d,i)=>{ ctx.fillText(d.label,P.l+i*boff+boff/2,H-7); }); }
function drawDonut(c,total){ const cv=$('donut-chart'); if(!cv)return; const ctx=cv.getContext('2d'); const W=110,H=110,cx=55,cy=55,r=44,ir=29; cv.width=W*2;cv.height=H*2;cv.style.width=W+'px';cv.style.height=H+'px'; ctx.scale(2,2);ctx.clearRect(0,0,W,H);
  if(total===0){ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.strokeStyle=cssVar('--chart-grid');ctx.lineWidth=r-ir;ctx.stroke();return;}
  const sc=SC(); const colors=[sc.novo,sc.chamado,sc.respondeu,sc.contato],vals=[c.novo,c.chamado,c.respondeu,c.contato]; let ang=-Math.PI/2;
  vals.forEach((v,i)=>{ if(!v)return; const sw=(v/total)*Math.PI*2; ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,ang,ang+sw);ctx.closePath();ctx.fillStyle=colors[i];ctx.fill();ang+=sw; });
  ctx.beginPath();ctx.arc(cx,cy,ir,0,Math.PI*2);ctx.fillStyle=cssVar('--chart-node');ctx.fill(); }

/* =====================================================================
   SHELL
===================================================================== */
const NAV = [
  { k:'dashboard', label:'Dashboard', icon:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>' },
  { k:'goals', label:'Metas', icon:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' },
  { k:'leads', label:'Leads', icon:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' },
  { k:'crm', label:'CRM', icon:'<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>' },
  { k:'deals', label:'Negociações', icon:'<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
  { k:'calls', label:'Ligações', icon:'<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>' },
  { k:'relatorios', label:'Relatórios', icon:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V9"/><path d="M12 17V5"/><path d="M15 17v-3"/>' },
  { k:'team', label:'Equipe', icon:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
  { k:'settings', label:'Configurações', icon:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
];
function TAB_INFO_GET(){ const m=MOD(); return { dashboard:['Dashboard','Visão geral dos seus leads'], goals:['Metas do Mês','Acompanhe o progresso da equipe e bata as metas'], leads:['Leads','Gerencie e filtre sua base'], crm:['CRM · Pipeline','Arraste leads pelo funil'], deals:[m.labels.dealsTabTitle, m.labels.dealsTabSub], calls:['Ligações','Registre e acompanhe suas chamadas'], relatorios:['Relatórios','Pagamentos semanais, leads, ligações e vendas — histórico permanente'], team:['Equipe','Recados e comunicados entre vocês'], settings:['Configurações','Espaço e integrações'], admin:['Painel Administrativo','Gestão da plataforma'] }; }

// Carrega as abas liberadas para a equipe ativa. Se a RPC ainda não existe
// no banco (migração não rodada), deixa S.features=null = mostra tudo.
async function loadFeatures(){
  try{ const { data, error }=await sb.rpc('my_features'); if(error) throw error;
       S.features = new Set((data||[]).map(f=>f.key)); }
  catch(_){ S.features = null; }
}
// Aba visível? Admin vê tudo; sem features carregadas, mostra tudo.
function featOn(k){ if(S.profile&&S.profile.platform_role==='admin') return true; if(!S.features) return true; return S.features.has(k); }

function renderShell(){
  $('auth').classList.add('hidden'); $('onboard').classList.add('hidden'); $('app').classList.add('show');
  if(S.route==='team') S.unread=0;
  const isAdmin = S.profile&&S.profile.platform_role==='admin';
  if(S.route!=='admin' && !featOn(S.route)) S.route='dashboard';
  const openDeals = S.deals.filter(d=>d.status!==WON()&&d.status!==LOST()).length;
  let nav = NAV.filter(n=>featOn(n.k)).map(n=>`<div class="nav-item ${S.route===n.k?'active':''}" data-route="${n.k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${n.icon}</svg>${n.label}${n.k==='leads'&&S.leads.length?`<span class="nav-badge">${S.leads.length}</span>`:''}${n.k==='deals'&&openDeals?`<span class="nav-badge">${openDeals}</span>`:''}${n.k==='calls'&&S.calls.length?`<span class="nav-badge">${S.calls.length}</span>`:''}${n.k==='team'&&S.unread?`<span class="nav-badge" style="background:rgba(16,185,129,.22);color:#6EE7B7">${S.unread}</span>`:''}</div>`).join('');
  if(isAdmin) nav += `<div class="s-sec">Plataforma</div><div class="nav-item ${S.route==='admin'?'active':''}" data-route="admin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Admin</div>`;
  $('s-nav').innerHTML=nav;
  $('s-user').textContent = (S.profile&&(S.profile.name||S.profile.email))||'—';
  $('s-org').textContent = ((S.org&&S.org.name)||'—') + (S.profile&&S.profile.org_role==='owner'?' · dono':'') + ' ▾';
  $('s-org').style.cursor='pointer'; $('s-org').title='Trocar de equipe';
  $('s-org').onclick=renderOrgSwitcher;
  $('s-nav').querySelectorAll('[data-route]').forEach(el=>el.onclick=()=>{ S.route=el.dataset.route; selReset(); $('app').classList.remove('sb-open'); renderShell(); });
  // Menu gaveta no celular
  const mb=$('menu-btn'); if(mb) mb.onclick=()=>$('app').classList.toggle('sb-open');
  const ov=$('sb-overlay'); if(ov) ov.onclick=()=>$('app').classList.remove('sb-open');
  const ti=TAB_INFO_GET()[S.route]||['','']; $('tb-title').textContent=ti[0]; $('tb-sub').textContent=ti[1];
  const showPeriod = ['dashboard','leads','calls','deals'].includes(S.route);
  $('period-tabs').style.display = showPeriod?'flex':'none';
  $('period-tabs').querySelectorAll('.period-tab').forEach(t=>{ t.classList.toggle('active',t.dataset.period===S.period); t.onclick=()=>{ S.period=t.dataset.period; S.lf.page=1; S.cf.page=1; renderShell(); }; });
  routeRender();
}
function routeRender(){ ({dashboard:renderDashboard,goals:renderGoals,leads:renderLeads,crm:renderCRM,deals:renderDeals,calls:renderCalls,relatorios:renderRelatorios,team:renderTeam,settings:renderSettings,admin:renderAdmin}[S.route]||renderDashboard)(); }

/* =====================================================================
   DASHBOARD
===================================================================== */
function renderDashboard(){
  const leads=inPeriod(S.leads,S.period);
  const c=metrics(leads), total=leads.length, pct=n=>total?Math.round(n/total*100):0;
  const KICO={ novo:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', chamado:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', respondeu:'<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>', contato:'<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>' };
  const sts=STS(), sm=SM(), sc=SC();
  const kpis=[ {k:'novo',cls:'kk-n',lbl:'Total de Leads',val:total,p:null,sub:`${S.leads.length} no total`}, {k:'chamado',cls:'kk-c',lbl:'Chamados',val:c.chamado,p:pct(c.chamado),sub:'do total'}, {k:'respondeu',cls:'kk-r',lbl:'Responderam',val:c.respondeu,p:pct(c.respondeu),sub:'dos chamados'}, {k:'contato',cls:'kk-o',lbl:'Convertidos',val:c.contato,p:pct(c.contato),sub:'taxa de conv.'} ];
  const kpiHtml=kpis.map(x=>`<div class="kpi-card ${x.cls}"><div class="kpi-top"><div class="kpi-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${KICO[x.k]}</svg></div></div><div class="kpi-lbl">${x.lbl}</div><div class="kpi-val">${x.val}</div><div class="kpi-sub">${x.p!=null?`<span class="kpi-pct">${x.p}%</span>`:''}${x.sub}</div></div>`).join('');
  const maxC=Math.max(...sts.map(s=>c[s]||0),1);
  const funnelHtml=sts.map(s=>{ const n=c[s]||0,w=Math.round(n/maxC*100); return `<div class="funnel-row"><div class="funnel-lbl"><span class="sdot" style="background:${sc[s]}"></span>${sm[s].label}</div><div class="funnel-track"><div class="funnel-fill" style="width:${w}%;background:${sc[s]};opacity:.82"><span>${n>0?pct(n)+'%':''}</span></div></div><div class="funnel-cnt">${n}</div></div>`; }).join('');
  const niches=topNiches(leads),maxN=(niches[0]&&niches[0][1])||1;
  const nichesHtml=niches.length?niches.map(([nm,n],i)=>`<div class="niche-row"><span class="niche-rank">${i+1}</span><span class="niche-nm" title="${esc(nm)}">${esc(nm)}</span><div class="niche-track"><div class="niche-fill" style="width:${Math.round(n/maxN*100)}%"></div></div><span class="niche-cnt">${n}</span></div>`).join(''):'<div style="font-size:.74rem;color:var(--t3);text-align:center;padding:14px 0">Sem dados de nicho</div>';
  const recent=[...leads].sort((a,b)=>new Date(b.addedAt||0)-new Date(a.addedAt||0)).slice(0,6);
  const recentHtml=recent.length?recent.map(l=>`<div class="rl-item"><div class="avatar">${esc(ini(l.name||l.username))}</div><div class="rl-info"><div class="rl-name">${esc(l.name||l.username||'—')}</div><div class="rl-user">@${esc(l.username||'—')}</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px"><span class="badge" style="background:${stColor(l)}22;color:${stColor(l)}">${stShort(l)}</span><span class="rl-time">${timeAgo(l.addedAt)}</span></div></div>`).join(''):'<div style="font-size:.74rem;color:var(--t3);padding:12px 0">Nenhum lead no período.</div>';
  const donutLgd=sts.map(s=>{ const n=c[s]||0; return `<div class="donut-row"><div class="donut-dot" style="background:${sc[s]}"></div><span class="donut-lbl">${sm[s].label}</span><span class="donut-val">${n}</span><span class="donut-pct">${pct(n)}%</span></div>`; }).join('');
  const callsP=inPeriod(S.calls,S.period,'at'), cm=callMetrics(callsP);
  const callOut=CALL_OUT(), callLbl=COM(), callClr=CC();
  const callsCard=`<div class="card"><div class="card-hd"><div class="card-title">Ligações</div><span class="text-link" style="font-size:.69rem" id="see-calls">Ver todas →</span></div><div class="card-bd"><div style="display:flex;align-items:baseline;gap:8px;margin-bottom:11px"><span style="font-family:'Plus Jakarta Sans';font-size:1.9rem;font-weight:800;line-height:1">${callsP.length}</span><span style="font-size:.7rem;color:var(--t3)">no período</span></div><div style="display:flex;flex-direction:column;gap:7px">${callOut.map(o=>cm[o]?`<div class="donut-row"><div class="donut-dot" style="background:${callClr[o]}"></div><span class="donut-lbl">${callLbl[o]}</span><span class="donut-val">${cm[o]}</span></div>`:'').join('')||'<div style="font-size:.72rem;color:var(--t3)">Nenhuma ligação no período.</div>'}</div></div></div>`;

  if(S.leads.length===0){
    $('content').innerHTML=`<div class="card" style="padding:28px;text-align:center"><div class="empty-ico" style="margin:0 auto 14px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div><div class="empty-title">Bem-vindo, ${esc(S.profile&&S.profile.name||'')}!</div><div class="empty-sub" style="margin-bottom:14px">Você está no espaço <b>${esc(S.org&&S.org.name||'')}</b>. Cadastre seu primeiro lead para ver os gráficos.</div><button class="btn btn-primary" id="wb-add">Cadastrar primeiro lead</button></div>`;
    $('wb-add').onclick=()=>{ S.route='leads'; renderShell(); setTimeout(()=>leadForm(),50); };
    return;
  }
  let payCard='';
  if(MOD().features.weeklyPay){
    const wp=weeklyPay();
    const wkLbl=`${wp.ws.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} a ${new Date(wp.we-1).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}`;
    const unpaidRows=wp.unpaid.length?wp.unpaid.map(d=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:.72rem;padding:5px 0;border-bottom:1px dashed var(--border)"><span style="color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">⏳ Comissão da venda — <b>${esc(d.name)}</b>${d.closedAt?` <span style="color:var(--t3)">(${fmtDate(d.closedAt)})</span>`:''}</span><span style="color:#FCD34D;font-weight:700;white-space:nowrap">${fmtCurrency(d.value)}</span></div>`).join(''):'<div style="font-size:.72rem;color:var(--t3);padding:4px 0">Nenhuma comissão pendente.</div>';
    payCard=`<div class="card" style="padding:20px;border-left:3px solid #10B981;margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:14px">
        <div><div style="font-weight:800;font-size:1rem">💵 A pagar nesta semana</div><div style="font-size:.72rem;color:var(--t3)">semana ${wkLbl} · ${fmtCurrency(wp.dayRate)}/dia por ${wp.target} leads (${fmtCurrency(wp.perLead)}/lead)</div></div>
        <div style="text-align:right"><div style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:2rem;line-height:1;color:#10B981">${fmtCurrency(wp.total)}</div><div style="font-size:.7rem;color:var(--t3)">total a pagar</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
        <div style="background:var(--surf2);border-radius:9px;padding:12px 14px">
          <div style="font-size:.72rem;color:var(--t3);margin-bottom:3px">Prospecção · ${wp.prospectLeads} leads na semana</div>
          <div style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:1.3rem;color:#6366F1">${fmtCurrency(wp.prospectPay)}</div>
        </div>
        <div style="background:var(--surf2);border-radius:9px;padding:12px 14px">
          <div style="font-size:.72rem;color:var(--t3);margin-bottom:6px">Comissões não pagas · ${fmtCurrency(wp.unpaidTotal)}</div>
          ${unpaidRows}
        </div>
      </div>
    </div>`;
  }
  $('content').innerHTML=`<div class="kpi-grid">${kpiHtml}</div>${payCard}<div class="dash-grid"><div class="dash-col">
    <div class="card"><div class="card-hd"><div class="card-title">Leads Adicionados · últimos 14 dias</div></div><div class="card-bd"><div class="chart-wrap" style="height:155px"><canvas id="tl-chart"></canvas></div></div></div>
    <div class="card"><div class="card-hd"><div class="card-title">Funil de Prospecção</div></div><div class="card-bd"><div class="funnel-wrap">${funnelHtml}</div></div></div>
    <div class="card"><div class="card-hd"><div class="card-title">Tendência Semanal · 8 semanas</div></div><div class="card-bd"><div class="chart-wrap" style="height:125px"><canvas id="wk-chart"></canvas></div></div></div>
  </div><div class="dash-col">
    <div class="card"><div class="card-hd"><div class="card-title">Distribuição de Status</div></div><div class="card-bd"><div class="donut-wrap"><div class="donut-cw"><canvas id="donut-chart" width="110" height="110"></canvas><div class="donut-center"><div class="donut-cv">${total}</div><div class="donut-cl">Leads</div></div></div><div class="donut-legend">${donutLgd}</div></div></div></div>
    <div class="card"><div class="card-hd"><div class="card-title">Top Nichos</div></div><div class="card-bd"><div class="niche-list">${nichesHtml}</div></div></div>
    <div class="card"><div class="card-hd"><div class="card-title">Adicionados Recentemente</div><span class="text-link" style="font-size:.69rem" id="see-all">Ver todos →</span></div><div class="card-bd" style="padding-top:6px">${recentHtml}</div></div>
    ${callsCard}
  </div></div>`;
  $('see-all')&&($('see-all').onclick=()=>{ S.route='leads'; renderShell(); });
  $('see-calls')&&($('see-calls').onclick=()=>{ S.route='calls'; renderShell(); });
  requestAnimationFrame(()=>{ drawTimeline(timeline14(leads)); drawWeekly(weeklyTrend(leads)); drawDonut(c,total); });
}

/* =====================================================================
   LEADS
===================================================================== */
function filteredLeads(){
  let leads=inPeriod(S.leads,S.period); const q=S.lf.q.toLowerCase().trim();
  if(q) leads=leads.filter(l=>(l.name||'').toLowerCase().includes(q)||(l.username||'').toLowerCase().includes(q)||(l.niche||'').toLowerCase().includes(q)||(l.phone||'').toLowerCase().includes(q)||(l.notes||'').toLowerCase().includes(q));
  const nq=(S.lf.note||'').toLowerCase().trim();
  if(nq) leads=leads.filter(l=>(l.notes||'').toLowerCase().includes(nq));
  if(S.lf.status) leads=leads.filter(l=>(l.status||'novo')===S.lf.status);
  if(S.lf.niche) leads=leads.filter(l=>(l.niche||'Sem nicho')===S.lf.niche);
  if(S.lf.pipeline) leads=leads.filter(l=>(l.pipeline_id||(defaultPipeline()&&defaultPipeline().id))===S.lf.pipeline);
  if(S.lf.ag==='in') leads=leads.filter(l=>!!l.agendorPersonId);
  else if(S.lf.ag==='out') leads=leads.filter(l=>!l.agendorPersonId);
  if(S.lf.sort==='oldest') return [...leads].sort((a,b)=>new Date(a.addedAt||0)-new Date(b.addedAt||0));
  if(S.lf.sort==='name') return [...leads].sort((a,b)=>(a.name||a.username||'').localeCompare(b.name||b.username||''));
  return [...leads].sort((a,b)=>new Date(b.addedAt||0)-new Date(a.addedAt||0));
}
function renderLeads(){
  const all=filteredLeads(); const pages=Math.max(1,Math.ceil(all.length/PAGE_SIZE)); S.lf.page=Math.min(S.lf.page,pages);
  const slice=all.slice((S.lf.page-1)*PAGE_SIZE,S.lf.page*PAGE_SIZE);
  const niches=[...new Set(S.leads.map(l=>l.niche||'').filter(Boolean))].sort();
  const rows=slice.length?slice.map(l=>{ const pl=leadPipeline(l); return `<tr data-id="${esc(l.id)}"${S.sel.mode&&S.sel.ids.has(l.id)?' style="background:rgba(99,102,241,.08)"':''}>
    ${selCell(l.id)}
    <td><div class="lead-cell"><div class="avatar">${esc(ini(l.name||l.username))}</div><div><div class="lead-nm">${esc(l.name||'—')}${S.pipelines.length>1?` <span class="tag" style="background:rgba(99,102,241,.14);color:#A5B4FC;border-color:rgba(99,102,241,.25)">${esc(pl?pl.icon:'')} ${esc(pl?pl.name:'')}</span>`:''}</div><div class="lead-un">${l.username?'@'+esc(l.username):esc(l.phone||'—')}${agendorOn()&&l.agendorPersonId?' <span style="font-size:.63rem;color:#6EE7B7;font-weight:600;white-space:nowrap">☁ Agendor</span>':''}</div></div></div></td>
    <td><span class="badge" style="background:${stColor(l)}22;color:${stColor(l)};border:1px solid ${stColor(l)}44">${stLabel(l)}</span></td>
    <td>${l.niche?`<span class="tag">${esc(l.niche)}</span>`:'<span style="color:var(--t3)">—</span>'}</td>
    <td style="color:var(--t2);font-size:.73rem">${fmtDate(l.addedAt)}</td>
    <td style="font-size:.72rem;color:var(--t3);max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.notes||'—')}</td>
    <td><div class="tbl-acts">${agendorOn()?(l.agendorPersonId?`<button class="act-btn" data-agrm="${esc(l.id)}" style="color:#6EE7B7" title="Remover do Agendor (mantém no sistema)">☁ Tirar do Agendor</button>`:`<button class="act-btn" data-ag="${esc(l.id)}" style="color:#6EE7B7">→ Agendor</button>`):''}<button class="act-btn" data-edit="${esc(l.id)}">Editar</button><button class="act-btn act-del" data-del="${esc(l.id)}">Excluir</button></div></td></tr>`; }).join('')
    :`<tr><td colspan="${S.sel.mode?7:6}"><div class="empty-state"><div class="empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div><div class="empty-title">Nenhum lead encontrado</div><div class="empty-sub">Tente outros filtros ou cadastre um lead.</div></div></td></tr>`;
  let pag=''; if(pages>1){ pag+=`<button class="pag-btn" data-pg="${S.lf.page-1}" ${S.lf.page<=1?'disabled':''}>‹</button>`; for(let i=1;i<=pages;i++){ if(i===1||i===pages||Math.abs(i-S.lf.page)<=1)pag+=`<button class="pag-btn${i===S.lf.page?' active':''}" data-pg="${i}">${i}</button>`; else if(Math.abs(i-S.lf.page)===2)pag+='<span style="color:var(--t3);padding:0 3px">…</span>'; } pag+=`<button class="pag-btn" data-pg="${S.lf.page+1}" ${S.lf.page>=pages?'disabled':''}>›</button>`; }
  const from=(S.lf.page-1)*PAGE_SIZE+1,to=Math.min(S.lf.page*PAGE_SIZE,all.length);
  const stFilterPipeline=S.lf.pipeline?pipelineById(S.lf.pipeline):defaultPipeline();
  const stOptsSM=SM(stFilterPipeline);
  const stOpts=['',...STS(stFilterPipeline)].map(s=>`<option value="${s}" ${S.lf.status===s?'selected':''}>${s?(stOptsSM[s]&&stOptsSM[s].label||s):'Todos os status'}</option>`).join('');
  const tpOpts=[['','Todos os funis'],...S.pipelines.map(p=>[p.id,`${p.icon||''} ${p.name}`])].map(([v,l])=>`<option value="${v}" ${S.lf.pipeline===v?'selected':''}>${l}</option>`).join('');
  const niOpts=['',...niches].map(n=>`<option value="${esc(n)}" ${S.lf.niche===n?'selected':''}>${n||'Todos os nichos'}</option>`).join('');
  const soOpts=[['newest','Mais recentes'],['oldest','Mais antigos'],['name','Nome A–Z']].map(([v,l])=>`<option value="${v}" ${S.lf.sort===v?'selected':''}>${l}</option>`).join('');
  const periodLeads=inPeriod(S.leads,S.period); const nIn=periodLeads.filter(l=>!!l.agendorPersonId).length; const nOut=periodLeads.length-nIn;
  const agSegs=[['','Todos',periodLeads.length],['in','☁ No Agendor',nIn],['out','Fora do Agendor',nOut]].map(([v,l,n])=>`<div class="period-tab${S.lf.ag===v?' active':''}" data-leadag="${v}">${l} <span style="opacity:.6">(${n})</span></div>`).join('');
  const NOTE_PRESETS=['Perdido','Sem interesse','Sem retorno'];
  const noteChips=NOTE_PRESETS.map(t=>`<div class="period-tab${(S.lf.note||'').toLowerCase()===t.toLowerCase()?' active':''}" data-note="${esc(t)}">${t}</div>`).join('');
  $('content').innerHTML=`<div class="tbl-controls" style="margin-bottom:10px"><div class="period-tabs" id="leads-ag-tabs">${agSegs}</div></div><div class="tbl-controls">
    <div class="search-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input class="search-inp" id="ls-q" placeholder="Buscar por nome, @usuário, nicho…" value="${esc(S.lf.q)}"></div>
    <select class="flt-sel" id="ls-status">${stOpts}</select><select class="flt-sel" id="ls-tipo">${tpOpts}</select><select class="flt-sel" id="ls-niche">${niOpts}</select><select class="flt-sel" id="ls-sort">${soOpts}</select>
    <button class="btn btn-outline" id="imp-lead"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Importar</button>
    <button class="btn btn-primary" id="add-lead"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Cadastrar</button>
    ${selBar()}</div>
    ${S.sel.mode?`<div class="tbl-controls" style="margin-bottom:10px">
      <span style="font-size:.74rem;color:var(--t2);font-weight:600;white-space:nowrap">Mudar etapa dos selecionados:</span>
      <div class="period-tabs" id="leads-stage-bulk">
        <div class="period-tab" data-bulkstage="0">Novo Lead</div>
        <div class="period-tab" data-bulkstage="1">Chamado</div>
        <div class="period-tab" data-bulkstage="2">Respondeu</div>
        <div class="period-tab" data-bulkstage="last">Enviou Contato</div>
      </div>
    </div>`:''}
    <div class="tbl-controls" style="margin-bottom:10px">
      <div class="search-wrap" style="flex:0 1 260px;min-width:150px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg><input class="search-inp" id="ls-note" placeholder="Filtrar por nota (ex.: perdido)…" value="${esc(S.lf.note)}"></div>
      <div class="period-tabs" id="leads-note-chips">${noteChips}</div>
      ${S.lf.note?`<button class="btn btn-outline" id="ls-note-clear"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Limpar nota</button>`:''}
    </div>
    <div class="card"><div class="res-bar"><span>${all.length>0?`<strong>${from}–${to}</strong> de <strong>${all.length}</strong> leads`:'<strong>0</strong> leads'}</span><span style="color:var(--t3)">${S.leads.length} no total</span></div>
    <table class="data-tbl" id="leads-tbl"><thead><tr>${S.sel.mode?'<th class="sel-td"></th>':''}<th>Lead</th><th>Status</th><th>Nicho</th><th>Adicionado</th><th>Notas</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    ${pages>1?`<div class="pagination"><span>${all.length} leads</span><div class="pag-btns" id="pag-btns">${pag}</div></div>`:''}</div>`;
  $('ls-q').oninput=e=>{ S.lf.q=e.target.value; S.lf.page=1; renderLeads(); refocus('ls-q'); };
  $('ls-note').oninput=e=>{ S.lf.note=e.target.value; S.lf.page=1; renderLeads(); refocus('ls-note'); };
  $('leads-note-chips').onclick=e=>{ const t=e.target.closest('[data-note]'); if(!t)return; const v=t.dataset.note; S.lf.note=(S.lf.note||'').toLowerCase()===v.toLowerCase()?'':v; S.lf.page=1; renderLeads(); };
  $('ls-note-clear')&&($('ls-note-clear').onclick=()=>{ S.lf.note=''; S.lf.page=1; renderLeads(); });
  $('leads-ag-tabs').onclick=e=>{ const t=e.target.closest('[data-leadag]'); if(!t)return; S.lf.ag=t.dataset.leadag; S.lf.page=1; renderLeads(); };
  $('leads-stage-bulk')&&($('leads-stage-bulk').onclick=e=>{ const b=e.target.closest('[data-bulkstage]'); if(!b)return; const v=b.dataset.bulkstage; bulkSetLeadsStage(v==='last'?'last':parseInt(v)); });
  $('ls-status').onchange=e=>{ S.lf.status=e.target.value; S.lf.page=1; renderLeads(); };
  $('ls-tipo').onchange=e=>{ S.lf.pipeline=e.target.value; S.lf.status=''; S.lf.page=1; renderLeads(); };
  $('ls-niche').onchange=e=>{ S.lf.niche=e.target.value; S.lf.page=1; renderLeads(); };
  $('ls-sort').onchange=e=>{ S.lf.sort=e.target.value; renderLeads(); };
  $('add-lead').onclick=()=>leadForm();
  $('imp-lead').onclick=importLeads;
  $('pag-btns')&&($('pag-btns').onclick=e=>{ const b=e.target.closest('[data-pg]'); if(!b||b.disabled)return; S.lf.page=parseInt(b.dataset.pg); renderLeads(); });
  $('leads-tbl').onclick=e=>{ if(S.sel.mode){ const chk=e.target.closest('.rowchk'); const tr=e.target.closest('tr[data-id]'); if(chk){selToggle(chk.dataset.sel);renderLeads();return;} if(tr){selToggle(tr.dataset.id);renderLeads();return;} return; } const agrm=e.target.closest('[data-agrm]'),ag=e.target.closest('[data-ag]'),ed=e.target.closest('[data-edit]'),dl=e.target.closest('[data-del]'); if(agrm){removeLeadFromAgendor(agrm.dataset.agrm);return;} if(ag){sendLeadToAgendor(ag.dataset.ag);return;} if(dl){delLead(dl.dataset.del);return;} if(ed){leadForm(ed.dataset.edit);return;} const tr=e.target.closest('tr[data-id]'); if(tr)leadForm(tr.dataset.id); };
  bindSelBar(all.map(l=>l.id), renderLeads, bulkDeleteLeads);
}
function leadForm(id){
  const l=id?S.leads.find(x=>x.id===id):null;
  const curSt=(l&&l.status)||'novo';
  const curPl=leadPipeline(l)||defaultPipeline();
  const plOpts=S.pipelines.map(p=>`<option value="${p.id}" ${curPl&&curPl.id===p.id?'selected':''}>${esc(p.icon||'')} ${esc(p.name)}</option>`).join('');
  const stOptsFor=p=>STS(p).map(s=>`<option value="${s}" ${curSt===s?'selected':''}>${(SM(p)[s]||{}).label||s}</option>`).join('');
  const pipelineField=S.pipelines.length>1?`<div class="fld"><label>Funil</label><select id="f-pipeline">${plOpts}</select></div>`:'';
  const nicheField=S.niches.length?`<div class="fld"><label>Nicho</label><select id="f-niche"><option value="">— selecione —</option>${S.niches.map(n=>`<option value="${esc(n.name)}" ${(l&&l.niche)===n.name?'selected':''}>${esc(n.name)}</option>`).join('')}${(l&&l.niche)&&!S.niches.some(n=>n.name===l.niche)?`<option value="${esc(l.niche)}" selected>${esc(l.niche)} (antigo)</option>`:''}</select></div>`:`<div class="fld"><label>Nicho</label><input id="f-niche" value="${esc(l&&l.niche||'')}"></div>`;
  const extraFields=MOD().extraLeadFields||[];
  const extraHtml=extraFields.map(f=>{
    const val=(l&&l.customFields&&l.customFields[f.key])||'';
    if(f.type==='select') return `<div class="fld"><label>${esc(f.label)}</label><select id="f-x-${f.key}">${['',...f.options].map(o=>`<option value="${esc(o)}" ${val===o?'selected':''}>${o||'Selecione'}</option>`).join('')}</select></div>`;
    return `<div class="fld"><label>${esc(f.label)}</label><input id="f-x-${f.key}" value="${esc(val)}"></div>`;
  }).join('');
  openModal(`<div class="modal-ov"><div class="modal-box"><div class="modal-hd"><div><div class="modal-title">${id?'Editar Lead':'Cadastrar Lead'}</div><div class="modal-sub">${id?(l&&l.agendorPersonId&&agendorOn()?'Atualize os dados · <span style="color:#6EE7B7;font-size:.75rem">☁ Já no Agendor</span>':'Atualize os dados'):'Adicione manualmente'}</div></div><div class="x"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div></div>
    <div class="modal-bd"><div class="form-grid">
      <div class="fld full"><label>Nome</label><input id="f-name" value="${esc(l&&l.name||'')}" placeholder="Nome do contato"></div>
      <div class="fld"><label>@usuário</label><input id="f-user" value="${esc(l&&l.username||'')}" placeholder="usuario"></div>
      <div class="fld"><label>Telefone</label><input id="f-phone" value="${esc(l&&l.phone||'')}" placeholder="(11) 9..."></div>
      ${nicheField}
      ${pipelineField}
      <div class="fld"><label>Status</label><select id="f-status">${stOptsFor(curPl)}</select></div>
      ${extraHtml}
      <div class="fld full"><label>Observações</label><textarea id="f-notes" placeholder="Notas…">${esc(l&&l.notes||'')}</textarea></div>
    </div>${agendorOn()&&!(l&&l.agendorPersonId)?`<label style="display:flex;align-items:center;gap:9px;margin-top:10px;padding:10px 12px;background:rgba(110,231,183,.07);border:1px solid rgba(110,231,183,.2);border-radius:9px;cursor:pointer"><input type="checkbox" id="f-ag-exists" style="width:16px;height:16px;accent-color:#6EE7B7;cursor:pointer"><span style="font-size:.78rem;color:var(--t2)">☁ Lead já está no Agendor (não enviar novamente)</span></label>`:''}</div>
    <div class="modal-ft"><button class="btn btn-outline" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" id="f-save">${id?'Salvar':'Cadastrar'}</button></div></div></div>`);
  $('f-pipeline')&&($('f-pipeline').onchange=e=>{ const p=pipelineById(e.target.value); $('f-status').innerHTML=stOptsFor(p); });
  $('f-save').onclick=async()=>{
    const customFields=Object.fromEntries(extraFields.map(f=>[f.key, ($('f-x-'+f.key)&&$('f-x-'+f.key).value)||'']));
    const pipeline=pipelineById($('f-pipeline')?$('f-pipeline').value:(curPl&&curPl.id));
    const data={ name:$('f-name').value.trim(), username:$('f-user').value.trim().replace(/^@/,''), phone:$('f-phone').value.trim(), niche:$('f-niche').value.trim(), status:$('f-status').value, pipeline_id:pipeline&&pipeline.id, tipo:(pipeline&&pipeline.counts_as_empresario)?'empresario':'comum', notes:$('f-notes').value.trim(), customFields };
    if(!data.name&&!data.username){ toast('Informe nome ou @usuário','warn'); return; }
    const markAsInAgendor = !!($('f-ag-exists')&&$('f-ag-exists').checked);
    $('f-save').disabled=true;
    const prevStatus = id ? ((S.leads.find(x=>x.id===id)||{}).status) : null;
    let savedId=id;
    if(id){ const{error}=await sb.from('leads').update(leadToRow(data)).eq('id',id); if(error){toast(error.message,'error');return;} toast('Lead atualizado','success'); }
    else { data.source='manual'; const{data:ins,error}=await sb.from('leads').insert(leadToRow(data)).select('id').single(); if(error){toast(error.message,'error');return;} savedId=ins&&ins.id; toast('Lead cadastrado','success'); }
    if(markAsInAgendor && savedId) await sb.from('leads').update({agendor_person_id:'manual'}).eq('id',savedId);
    const converted=isLastStage(data.status,pipeline);
    closeModal(); await loadLeads(); if(converted||data.tipo==='empresario'){ await loadDeals(); if(savedId) await ensureDealForLead(savedId); } renderShell();
    if(converted && prevStatus!==data.status) notifyLeadContato(S.leads.find(x=>x.id===savedId)||data);
    if(converted && agendorOn() && agendorAutoOn() && savedId){ const lead=S.leads.find(x=>x.id===savedId); if(lead && !lead.agendorPersonId) sendLeadToAgendor(savedId,true); }
  };
}
function delLead(id){ const l=S.leads.find(x=>x.id===id);
  const hasAg = !!(l && agendorOn() && l.agendorPersonId);
  openModal(`<div class="modal-ov"><div class="modal-box"><div class="modal-hd"><div class="modal-title">Excluir Lead</div><div class="x"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div></div><div class="modal-bd"><p class="confirm-txt">Excluir <b>${esc(l&&(l.name||l.username)||'este lead')}</b>? Não pode ser desfeito.</p>${hasAg?`<label style="display:flex;align-items:center;gap:9px;margin-top:12px;padding:10px 12px;background:rgba(16,185,129,.07);border:1px solid rgba(16,185,129,.22);border-radius:9px;cursor:pointer"><input type="checkbox" id="d-ag" checked style="width:18px;height:18px;accent-color:#10B981;cursor:pointer"><span style="font-size:.78rem;color:var(--t2)">Remover também do Agendor (apaga a pessoa e o negócio que foram enviados por engano)</span></label>`:''}</div><div class="modal-ft"><button class="btn btn-outline" onclick="closeModal()">Cancelar</button><button class="btn btn-danger" id="d-ok">Excluir</button></div></div></div>`);
  $('d-ok').onclick=async()=>{
    $('d-ok').disabled=true;
    if(hasAg && $('d-ag') && $('d-ag').checked) await deleteFromAgendor(l);
    const{error}=await sb.from('leads').delete().eq('id',id);
    if(error){toast(error.message,'error');$('d-ok').disabled=false;return;}
    closeModal(); toast('Lead excluído','success'); await loadLeads(); await loadDeals(); renderShell();
  };
}

/* Normaliza uma chave de coluna (remove acentos, minúsculas, só alfanumérico) */
function normColKey(k){
  return String(k||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
}
const IMPORT_FIELD_ALIASES = {
  name:['nome','nomecompleto','name','lead','fullname'],
  username:['usuario','username','instagram','perfil','handle','insta','ig','usuarioinstagram'],
  phone:['telefone','phone','celular','whatsapp','fone','tel','contatotelefone','contato','numero'],
  email:['email','emailaddress'],
  niche:['nicho','niche','categoria','segmento'],
  notes:['notas','observacoes','observacao','obs','notes','comentarios','situacao'],
  cidade:['cidade','city'],
  estado:['estado','uf','state'],
  cnpj:['cnpj'],
  tipo:['tipo','type'],
  followers:['seguidores','followers'],
  following:['seguindo','following']
};
/* Converte um objeto de linha (colunas arbitrárias) num lead genérico.
   Planilhas reais variam muito: coluna do nome às vezes vem sem cabeçalho,
   e "Contato" costuma significar telefone, não nome — por isso o nome
   nunca é aceito se vier puramente numérico, e colunas não reconhecidas
   (situação, crédito, etc.) são preservadas em notes em vez de descartadas. */
function mapImportedRow(row){
  const out={};
  const keys=Object.keys(row).map(k=>({raw:k,norm:normColKey(k)}));
  const used=new Set();
  for(const field in IMPORT_FIELD_ALIASES){
    const aliases=IMPORT_FIELD_ALIASES[field];
    const found=keys.find(k=>aliases.includes(k.norm)&&!used.has(k.raw));
    if(found){ const v=row[found.raw]; if(v!==undefined&&v!==null&&String(v).trim()!==''){ out[field]=String(v).trim(); used.add(found.raw); } }
  }
  if(out.name && /^[+\d\s().-]+$/.test(out.name)){ if(!out.phone) out.phone=out.name; delete out.name; }
  if(!out.name){
    const blank=keys.find(k=>/^__empty/i.test(k.raw)&&!used.has(k.raw)&&/[a-zà-ÿ]/i.test(String(row[k.raw]||'')));
    if(blank){ out.name=String(row[blank.raw]).trim(); used.add(blank.raw); }
  }
  const extra=[];
  for(const k of keys){
    if(used.has(k.raw)||/^__empty/i.test(k.raw)) continue;
    const v=row[k.raw];
    if(v===undefined||v===null||String(v).trim()==='') continue;
    extra.push(`${k.raw}: ${String(v).trim()}`);
  }
  if(extra.length) out.notes=[out.notes,extra.join(' | ')].filter(Boolean).join(' | ');
  return out;
}
/* Extrai leads de um texto/HTML de tabela via SheetJS (csv/tsv/xlsx/xls/ods) */
function sheetToLeadRows(ws){
  const json=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
  return json.map(mapImportedRow).filter(r=>r.name||r.username);
}
/* Fallback para PDF: extrai texto e tenta achar @handles / telefones / emails linha a linha */
function pdfTextToLeadRows(text){
  const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const rows=[];
  const emailRe=/[\w.+-]+@[\w-]+\.[\w.-]+/;
  const phoneRe=/(?:\+?55)?\s*\(?\d{2}\)?\s*\d{4,5}-?\d{4}/;
  const handleRe=/@[\w.]{2,30}/;
  for(const line of lines){
    const handle=line.match(handleRe);
    const email=line.match(emailRe);
    const phone=line.match(phoneRe);
    if(!handle && !email) continue;
    const username=handle?handle[0].replace('@',''):'';
    let name=line;
    if(handle) name=name.replace(handle[0],'');
    if(email) name=name.replace(email[0],'');
    if(phone) name=name.replace(phone[0],'');
    name=name.replace(/[,;|\t]+/g,' ').trim();
    rows.push({ name:name||username, username, email:email?email[0]:'', phone:phone?phone[0]:'' });
  }
  return rows;
}
async function parseImportFile(f){
  const ext=(f.name.split('.').pop()||'').toLowerCase();
  if(ext==='json'){
    const p=JSON.parse(await f.text());
    const arr=Array.isArray(p)?p:Array.isArray(p.leads)?p.leads:null;
    return arr||[];
  }
  if(ext==='pdf'){
    const buf=await f.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:buf}).promise;
    let text='';
    for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i);
      const content=await page.getTextContent();
      const lines={};
      for(const it of content.items){ const y=Math.round(it.transform[5]); (lines[y]=lines[y]||[]).push(it.str); }
      text+=Object.keys(lines).sort((a,b)=>b-a).map(y=>lines[y].join(' ')).join('\n')+'\n';
    }
    return pdfTextToLeadRows(text);
  }
  if(ext==='html'||ext==='htm'){
    const text=await f.text();
    const doc=new DOMParser().parseFromString(text,'text/html');
    const table=doc.querySelector('table');
    if(!table) return [];
    const ws=XLSX.utils.table_to_sheet(table);
    return sheetToLeadRows(ws);
  }
  // xlsx, xls, ods, csv, tsv
  const buf=await f.arrayBuffer();
  const wb=XLSX.read(buf,{type:'array',cellDates:true});
  const ws=wb.Sheets[wb.SheetNames[0]];
  return sheetToLeadRows(ws);
}
function importLeads(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.json,.csv,.tsv,.xlsx,.xls,.ods,.html,.htm,.pdf';
  inp.onchange=async e=>{
    const f=e.target.files[0]; if(!f) return;
    let arr; try{ arr=await parseImportFile(f); }catch(err){ toast('Erro ao ler arquivo: '+err.message,'error'); return; }
    if(!arr||!arr.length){ toast('Arquivo inválido ou sem leads','error'); return; }
    const haveExt=new Set(S.leads.map(l=>l.extId).filter(Boolean));
    const haveUser=new Set(S.leads.map(l=>(l.username||'').toLowerCase()).filter(Boolean));
    const rows=[];
    for(const l of arr){
      if(!l||(!l.name&&!l.username)) continue;
      const extId=String(l.id||l.agendorDealId||'');
      const uk=String(l.username||'').toLowerCase();
      if((extId&&haveExt.has(extId))||(uk&&haveUser.has(uk))) continue;
      haveExt.add(extId); if(uk) haveUser.add(uk);
      const tipo=l.tipo||'comum';
      // Empresários já são contatos → entram no funil marcado como "conta como empresário" (se a org tiver um)
      const pipeline = tipo==='empresario' ? (S.pipelines.find(p=>p.counts_as_empresario)||defaultPipeline()) : defaultPipeline();
      const status = tipo==='empresario' ? (STS(pipeline)[0]||'a_contatar') : (l.status||STS(pipeline)[1]||STS(pipeline)[0]);
      rows.push({ name:l.name||'', username:uk||'', phone:l.phone||'', email:l.email||'', niche:l.niche||'', status, tipo, pipeline_id:pipeline&&pipeline.id, funil:l.funil||null, cidade:l.cidade||null, estado:l.estado||null, cnpj:l.cnpj||null, notes:l.notes||'', source:l.source||'import', ext_id:extId||null, added_at:l.addedAt||new Date().toISOString() });
    }
    if(!rows.length){ toast('Nada novo para importar (já estão no sistema)','warn'); return; }
    toast(`Importando ${rows.length} leads…`);
    for(let i=0;i<rows.length;i+=200){ const { error }=await sb.from('leads').insert(rows.slice(i,i+200)); if(error){ toast('Erro: '+error.message,'error'); return; } }
    await loadLeads(); await loadDeals(); await backfillEmpresarioDeals(); renderShell(); toast(`${rows.length} leads importados`,'success');
  };
  inp.click();
}

/* =====================================================================
   CRM
===================================================================== */
function renderCRM(){
  const allP=inPeriod(S.leads,S.period);
  const active=S.crmPipelineId?pipelineById(S.crmPipelineId):null;
  const cols=STS(active||defaultPipeline());
  const colSM=SM(active||defaultPipeline()), colSC=SC(active||defaultPipeline());
  let leads = active ? allP.filter(l=>(l.pipeline_id||(defaultPipeline()&&defaultPipeline().id))===active.id) : allP;
  const q=(S.crmQ||'').toLowerCase().trim();
  if(q) leads=leads.filter(l=>(l.name||'').toLowerCase().includes(q)||(l.username||'').toLowerCase().includes(q)||(l.phone||'').toLowerCase().includes(q)||(l.niche||'').toLowerCase().includes(q));
  const defCol = cols[0]||'novo';
  const bucket = l => { const s=l.status||defCol; return cols.includes(s)?s:defCol; };
  const segs=[['','Todos',allP.length],...S.pipelines.map(p=>[p.id,`${p.icon||''} ${p.name}`,allP.filter(l=>(l.pipeline_id||(defaultPipeline()&&defaultPipeline().id))===p.id).length])].map(([v,l,n])=>`<div class="period-tab${S.crmPipelineId===v?' active':''}" data-crmpl="${v}">${l} <span style="opacity:.6">(${n})</span></div>`).join('');
  const board=cols.map(st=>{ const items=leads.filter(l=>bucket(l)===st).sort((a,b)=>new Date(b.addedAt||0)-new Date(a.addedAt||0));
    const cards=items.length?items.map(l=>`<div class="crm-card${S.sel.mode&&S.sel.ids.has(l.id)?' sel-on':''}" draggable="${!S.sel.mode}" data-id="${esc(l.id)}"><div class="crm-card-top">${selChk(l.id)}<div class="avatar">${esc(ini(l.name||l.username))}</div><div style="min-width:0;flex:1"><div class="crm-card-nm">${esc(l.name||l.username||'—')}</div><div class="crm-card-un">${l.username?'@'+esc(l.username):esc(l.phone||'—')}</div></div></div><div class="crm-card-meta">${l.niche?`<span class="tag">${esc(l.niche)}</span>`:''}${l.phone?`<span class="info-chip">${esc(l.phone)}</span>`:''}${l.agendorPersonId&&agendorOn()?`<span class="info-chip" style="color:#6EE7B7">☁ Agendor</span>`:''}</div></div>`).join(''):'<div class="crm-card-empty">Arraste aqui</div>';
    return `<div class="crm-col" data-status="${st}"><div class="crm-col-hd"><span class="crm-col-dot" style="background:${colSC[st]}"></span><span class="crm-col-nm">${(colSM[st]||{}).label||st}</span><span class="crm-col-cnt">${items.length}</span></div><div class="crm-col-bd">${cards}</div></div>`; }).join('');
  const hint='Arraste os cartões entre as colunas. Ao chegar na última etapa, vira negociação e (se configurado) vai ao Agendor.';
  $('content').innerHTML=`<div class="tbl-controls"><div class="sec-title" style="margin:0;flex:1">Pipeline</div><div class="period-tabs" id="crm-tabs">${segs}</div><button class="btn btn-primary" id="crm-add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Cadastrar Lead</button></div><div class="tbl-controls" style="margin-bottom:10px"><div class="search-wrap" style="flex:0 1 280px;min-width:160px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input class="search-inp" id="crm-q" placeholder="Buscar no funil…" value="${esc(S.crmQ)}"></div><p class="sec-sub" style="margin:0;flex:1">${S.sel.mode?'Toque nos cartões para selecionar.':hint}</p>${selBar()}</div><div class="crm-board" id="crm-board">${leads.length?board:`<div style="grid-column:1/-1"><div class="empty-state"><div class="empty-title">${q?'Nenhum resultado':'Nenhum lead'}</div><div class="empty-sub">${q?`Nada encontrado para "${esc(S.crmQ)}".`:'Cadastre um lead para começar.'}</div></div></div>`}</div>`;
  $('crm-add').onclick=()=>leadForm();
  $('crm-q').oninput=e=>{ S.crmQ=e.target.value; renderCRM(); refocus('crm-q'); };
  $('crm-tabs').onclick=e=>{ const t=e.target.closest('[data-crmpl]'); if(!t)return; S.crmPipelineId=t.dataset.crmpl; selReset(); renderCRM(); };
  const board2=$('crm-board'); let dragId=null;
  board2.addEventListener('dragstart',e=>{ const c=e.target.closest('.crm-card'); if(!c)return; dragId=c.dataset.id; c.classList.add('dragging'); });
  board2.addEventListener('dragend',e=>{ const c=e.target.closest('.crm-card'); if(c)c.classList.remove('dragging'); document.querySelectorAll('.crm-col.dragover').forEach(x=>x.classList.remove('dragover')); });
  board2.addEventListener('dragover',e=>{ const col=e.target.closest('.crm-col'); if(col){ e.preventDefault(); col.classList.add('dragover'); } });
  board2.addEventListener('dragleave',e=>{ const col=e.target.closest('.crm-col'); if(col&&!col.contains(e.relatedTarget))col.classList.remove('dragover'); });
  board2.addEventListener('drop',async e=>{ const col=e.target.closest('.crm-col'); if(!col||!dragId)return; e.preventDefault(); const id=dragId; dragId=null; const ns=col.dataset.status; const l=S.leads.find(x=>x.id===id); if(l&&l.status!==ns){ l.status=ns; const{error}=await sb.from('leads').update({status:ns}).eq('id',id); if(error){ toast(error.message,'error'); } else { const lp=leadPipeline(l); toast(`Movido para "${(SM(lp)[ns]||{}).label||ns}"`,'success'); if(isLastStage(ns,lp)||l.tipo==='empresario'){ await loadDeals(); await ensureDealForLead(id); if(isLastStage(ns,lp)){ toast('Negociação criada na aba Negociações ☑','success'); notifyLeadContato(l); } if(agendorOn()&&agendorAutoOn()&&!l.agendorPersonId) sendLeadToAgendor(id,true); } } } renderCRM(); });
  board2.addEventListener('click',e=>{ const c=e.target.closest('.crm-card[data-id]'); if(!c)return; if(S.sel.mode){ selToggle(c.dataset.id); renderCRM(); return; } leadForm(c.dataset.id); });
  bindSelBar(leads.map(l=>l.id), renderCRM, bulkDeleteLeads);
}

// Garante que exista uma negociação para um lead que virou "contato".
// O trigger do banco já cria automaticamente; isto é um fallback caso a
// migração SQL (supabase-deals.sql) ainda não tenha sido executada.
async function ensureDealForLead(leadId){
  if(S.deals.some(d=>d.leadId===leadId)) return;
  const prospector=(S.profile&&(S.profile.name||S.profile.email))||null;
  const { error }=await sb.from('deals').upsert({ lead_id:leadId, prospector_name:prospector }, { onConflict:'lead_id', ignoreDuplicates:true });
  if(error){ console.warn('ensureDealForLead:',error.message); return; }
  await loadDeals();
}

/* =====================================================================
   CALLS
===================================================================== */
function callMetrics(calls){ const keys=CALL_OUT(); const c=Object.fromEntries(keys.map(k=>[k,0])); const fb=keys[0]; for(const k of calls){ const o=k.outcome||fb; if(c[o]!=null) c[o]++; else if(fb) c[fb]++; } return c; }
function filteredCalls(){ let calls=inPeriod(S.calls,S.period,'at'); const q=S.cf.q.toLowerCase().trim(); if(q)calls=calls.filter(k=>(k.name||'').toLowerCase().includes(q)||(k.phone||'').toLowerCase().includes(q)||(k.notes||'').toLowerCase().includes(q)); if(S.cf.outcome)calls=calls.filter(k=>(k.outcome||'nao_atendeu')===S.cf.outcome); return S.cf.sort==='oldest'?[...calls].sort((a,b)=>new Date(a.at||0)-new Date(b.at||0)):[...calls].sort((a,b)=>new Date(b.at||0)-new Date(a.at||0)); }
function renderCalls(){
  const all=filteredCalls(),periodCalls=inPeriod(S.calls,S.period,'at'),cm=callMetrics(periodCalls),total=periodCalls.length,good=cm.interessado+cm.fechado,rate=total?Math.round(good/total*100):0;
  const pages=Math.max(1,Math.ceil(all.length/PAGE_SIZE)); S.cf.page=Math.min(S.cf.page,pages); const slice=all.slice((S.cf.page-1)*PAGE_SIZE,S.cf.page*PAGE_SIZE);
  const kc=[ {lbl:'Ligações',val:total,sub:'no período',cls:'kk-c'},{lbl:'Interessados',val:cm.interessado,sub:'querem a oferta',cls:'kk-o'},{lbl:'A retornar',val:cm.retornar,sub:'callback',cls:'kk-r'},{lbl:'Aproveitamento',val:rate+'%',sub:'interesse+fechado',cls:'kk-n'} ].map(k=>`<div class="kpi-card ${k.cls}"><div class="kpi-lbl">${k.lbl}</div><div class="kpi-val">${k.val}</div><div class="kpi-sub">${k.sub}</div></div>`).join('');
  const comMap=COM();
  const rows=slice.length?slice.map(k=>{ const o=k.outcome||'nao_atendeu'; return `<tr data-id="${esc(k.id)}"${S.sel.mode&&S.sel.ids.has(k.id)?' style="background:rgba(99,102,241,.08)"':''}>${selCell(k.id)}<td><div class="lead-cell"><div class="avatar">${esc(ini(k.name||k.phone))}</div><div><div class="lead-nm">${esc(k.name||'—')}</div><div class="lead-un">${esc(k.phone||'—')}</div></div></div></td><td><span class="call-out co-${o}">${comMap[o]||o}</span></td><td style="color:var(--t2);font-size:.73rem">${k.duration?esc(k.duration)+' min':'—'}</td><td style="color:var(--t2);font-size:.73rem">${fmtDate(k.at)}</td><td style="font-size:.72rem;color:var(--t3);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k.notes||'—')}</td><td><div class="tbl-acts"><button class="act-btn" data-edit="${esc(k.id)}">Editar</button><button class="act-btn act-del" data-del="${esc(k.id)}">Excluir</button></div></td></tr>`; }).join('')
    :`<tr><td colspan="${S.sel.mode?7:6}"><div class="empty-state"><div class="empty-title">Nenhuma ligação registrada</div><div class="empty-sub">Clique em "Registrar Ligação".</div></div></td></tr>`;
  let pag=''; if(pages>1){ pag+=`<button class="pag-btn" data-pg="${S.cf.page-1}" ${S.cf.page<=1?'disabled':''}>‹</button>`; for(let i=1;i<=pages;i++)pag+=`<button class="pag-btn${i===S.cf.page?' active':''}" data-pg="${i}">${i}</button>`; pag+=`<button class="pag-btn" data-pg="${S.cf.page+1}" ${S.cf.page>=pages?'disabled':''}>›</button>`; }
  const outOpts=['',...CALL_OUT()].map(o=>`<option value="${o}" ${S.cf.outcome===o?'selected':''}>${o?comMap[o]:'Todos os resultados'}</option>`).join('');
  const soOpts=[['newest','Mais recentes'],['oldest','Mais antigas']].map(([v,l])=>`<option value="${v}" ${S.cf.sort===v?'selected':''}>${l}</option>`).join('');
  $('content').innerHTML=`<div class="kpi-grid">${kc}</div><div class="tbl-controls"><div class="search-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input class="search-inp" id="cs-q" placeholder="Buscar por nome, telefone, nota…" value="${esc(S.cf.q)}"></div><select class="flt-sel" id="cs-out">${outOpts}</select><select class="flt-sel" id="cs-sort">${soOpts}</select><button class="btn btn-primary" id="add-call"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Registrar Ligação</button>${selBar()}</div>
    <div class="card"><div class="res-bar"><span><strong>${all.length}</strong> ligação(ões)</span><span style="color:var(--t3)">${S.calls.length} no total</span></div><table class="data-tbl" id="calls-tbl"><thead><tr>${S.sel.mode?'<th class="sel-td"></th>':''}<th>Contato</th><th>Resultado</th><th>Duração</th><th>Data</th><th>Notas</th><th></th></tr></thead><tbody>${rows}</tbody></table>${pages>1?`<div class="pagination"><span>${all.length} ligações</span><div class="pag-btns" id="cpag">${pag}</div></div>`:''}</div>`;
  $('cs-q').oninput=e=>{ S.cf.q=e.target.value; S.cf.page=1; renderCalls(); refocus('cs-q'); };
  $('cs-out').onchange=e=>{ S.cf.outcome=e.target.value; S.cf.page=1; renderCalls(); };
  $('cs-sort').onchange=e=>{ S.cf.sort=e.target.value; renderCalls(); };
  $('add-call').onclick=()=>callForm();
  $('cpag')&&($('cpag').onclick=e=>{ const b=e.target.closest('[data-pg]'); if(!b||b.disabled)return; S.cf.page=parseInt(b.dataset.pg); renderCalls(); });
  $('calls-tbl').onclick=e=>{ if(S.sel.mode){ const chk=e.target.closest('.rowchk'); const tr=e.target.closest('tr[data-id]'); if(chk){selToggle(chk.dataset.sel);renderCalls();return;} if(tr){selToggle(tr.dataset.id);renderCalls();return;} return; } const ed=e.target.closest('[data-edit]'),dl=e.target.closest('[data-del]'); if(dl){delCall(dl.dataset.del);return;} if(ed)callForm(ed.dataset.edit); };
  bindSelBar(all.map(k=>k.id), renderCalls, bulkDeleteCalls);
}
function callForm(id){
  const call=id?S.calls.find(c=>c.id===id):null;
  const leadLabel=l=>`${l.name||l.username||'—'}${l.username?' (@'+l.username+')':''}${l.phone?' · '+l.phone:''}`;
  const sorted=[...S.leads].sort((a,b)=>(a.name||a.username||'').localeCompare(b.name||b.username||''));
  const listOpts=sorted.map(l=>`<option value="${esc(leadLabel(l))}"></option>`).join('');
  const preset=call&&call.leadId?S.leads.find(x=>x.id===call.leadId):null;
  const comMap2=COM();
  const outOpts=CALL_OUT().map(o=>`<option value="${o}" ${(call&&call.outcome||'interessado')===o?'selected':''}>${comMap2[o]}</option>`).join('');
  const dt=call&&call.at?new Date(call.at):new Date(); const dtLocal=new Date(dt.getTime()-dt.getTimezoneOffset()*60000).toISOString().slice(0,16);
  openModal(`<div class="modal-ov"><div class="modal-box"><div class="modal-hd"><div><div class="modal-title">${id?'Editar Ligação':'Registrar Ligação'}</div><div class="modal-sub">Resultado da chamada</div></div><div class="x"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div></div>
    <div class="modal-bd"><div class="form-grid">
      <div class="fld full"><label>🔎 Buscar lead (preenche sozinho)</label><input id="cf-search" list="cf-list" placeholder="Digite o nome…" autocomplete="off" value="${esc(preset?leadLabel(preset):'')}"><datalist id="cf-list">${listOpts}</datalist><input type="hidden" id="cf-lead" value="${esc(call&&call.leadId||'')}"></div>
      <div class="fld"><label>Nome</label><input id="cf-name" value="${esc(call&&call.name||'')}"></div>
      <div class="fld"><label>Telefone</label><input id="cf-phone" value="${esc(call&&call.phone||'')}"></div>
      <div class="fld"><label>Resultado</label><select id="cf-out">${outOpts}</select></div>
      <div class="fld"><label>Duração (min)</label><input id="cf-dur" type="number" min="0" value="${call&&call.duration!=null?call.duration:''}"></div>
      <div class="fld full"><label>Data e hora</label><input id="cf-at" type="datetime-local" value="${dtLocal}"></div>
      <div class="fld full"><label>Observações</label><textarea id="cf-notes">${esc(call&&call.notes||'')}</textarea></div>
    </div></div><div class="modal-ft"><button class="btn btn-outline" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" id="cf-save">${id?'Salvar':'Registrar'}</button></div></div></div>`);
  const lookup={}; sorted.forEach(l=>lookup[leadLabel(l)]=l);
  const apply=()=>{ const l=lookup[$('cf-search').value]; if(l){ $('cf-lead').value=l.id; $('cf-name').value=l.name||l.username||''; if(l.phone)$('cf-phone').value=l.phone; } else $('cf-lead').value=''; };
  $('cf-search').addEventListener('input',apply); $('cf-search').addEventListener('change',apply);
  $('cf-save').onclick=async()=>{
    const name=$('cf-name').value.trim(),phone=$('cf-phone').value.trim(); if(!name&&!phone){ toast('Informe nome ou telefone','warn'); return; }
    const atVal=$('cf-at').value;
    const data={ leadId:$('cf-lead').value||null, name, phone, outcome:$('cf-out').value, duration:parseInt($('cf-dur').value)||null, at:atVal?new Date(atVal).toISOString():new Date().toISOString(), notes:$('cf-notes').value.trim() };
    $('cf-save').disabled=true;
    let savedId=id;
    if(id){ const{error}=await sb.from('calls').update(callToRow(data)).eq('id',id); if(error){toast(error.message,'error');return;} toast('Ligação atualizada','success'); }
    else { const{data:ins,error}=await sb.from('calls').insert(callToRow(data)).select('id').single(); if(error){toast(error.message,'error');return;} savedId=ins&&ins.id; toast('Ligação registrada','success'); }
    closeModal(); await loadCalls(); renderShell();
    // Auto-envio ao Agendor para ligações interessadas/fechadas (roteia funil pelo tipo do lead vinculado)
    if(savedId && (data.outcome==='interessado'||data.outcome==='fechado') && agendorOn() && agendorAutoOn()) sendCallToAgendor(savedId,true);
  };
}
function delCall(id){ const c=S.calls.find(x=>x.id===id);
  openModal(`<div class="modal-ov"><div class="modal-box"><div class="modal-hd"><div class="modal-title">Excluir Ligação</div><div class="x"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div></div><div class="modal-bd"><p class="confirm-txt">Excluir a ligação de <b>${esc(c&&(c.name||c.phone)||'contato')}</b>?</p></div><div class="modal-ft"><button class="btn btn-outline" onclick="closeModal()">Cancelar</button><button class="btn btn-danger" id="cd-ok">Excluir</button></div></div></div>`);
  $('cd-ok').onclick=async()=>{ const{error}=await sb.from('calls').delete().eq('id',id); if(error){toast(error.message,'error');return;} closeModal(); toast('Ligação excluída','success'); await loadCalls(); renderShell(); };
}

/* =====================================================================
   NEGOCIAÇÕES (DEALS) — Pipeline de vendas de consórcio
===================================================================== */
function renderDeals(){
  const deals = inPeriod(S.deals, S.period, 'createdAt');
  const total = deals.length;
  const vendidos = deals.filter(d=>d.status===WON());
  const ativos   = deals.filter(d=>d.status!==WON()&&d.status!==LOST());
  const totalVenda = vendidos.reduce((acc,d)=>acc+(Number(d.cardValue)||0),0);
  const totalComm  = vendidos.reduce((acc,d)=>acc+(Number(d.commissionValue)||0),0);
  const kcs=[
    {lbl:'Total de negociações',val:total,sub:'no período',cls:'kk-c'},
    {lbl:'Em andamento',val:ativos.length,sub:'aguardando fechamento',cls:'kk-r'},
    {lbl:'Vendidos',val:vendidos.length,sub:`${total?Math.round(vendidos.length/total*100):0}% de conversão`,cls:'kk-o'},
    {lbl:'Volume vendido',val:totalVenda>0?fmtCurrency(totalVenda):'R$ 0',sub:`Comissões: ${totalComm>0?fmtCurrency(totalComm):'R$ 0'}`,cls:'kk-n'},
  ].map(k=>`<div class="kpi-card ${k.cls}"><div class="kpi-lbl">${k.lbl}</div><div class="kpi-val" style="font-size:${String(k.val).length>8?'1.25rem':'1.9rem'}">${k.val}</div><div class="kpi-sub">${k.sub}</div></div>`).join('');

  const dq=(S.dealQ||'').toLowerCase().trim();
  const boardDeals = dq ? deals.filter(d=>(d.leadName||'').toLowerCase().includes(dq)||(d.leadUsername||'').toLowerCase().includes(dq)||(d.leadPhone||'').toLowerCase().includes(dq)||(d.cardType||'').toLowerCase().includes(dq)||(d.prospectorName||'').toLowerCase().includes(dq)) : deals;
  const dealSc=DEAL_SC(), dealSm=DEAL_SM();
  const board = DEAL_STS().map(st=>{
    const items=boardDeals.filter(d=>d.status===st).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
    const cards=items.length?items.map(d=>{
      const nm=d.leadName||'—', un=d.leadUsername||'', ph=d.leadPhone||'';
      const dealLead=d.leadId?S.leads.find(l=>l.id===d.leadId):null;
      return `<div class="crm-card${S.sel.mode&&S.sel.ids.has(d.id)?' sel-on':''}" draggable="${!S.sel.mode}" data-id="${esc(d.id)}">
        <div class="crm-card-top">
          ${selChk(d.id)}
          <div class="avatar" style="background:${dealSc[d.status]}">${esc(ini(nm))}</div>
          <div style="min-width:0;flex:1">
            <div class="crm-card-nm">${esc(nm)}${dealLead&&dealLead.agendorPersonId&&agendorOn()?'<span style="font-size:.6rem;color:#6EE7B7;font-weight:600;margin-left:4px">☁ Agendor</span>':''}</div>
            <div class="crm-card-un">${un?'@'+esc(un):''}${un&&ph?' · ':''}${ph?esc(ph):''}</div>
          </div>
        </div>
        <div class="crm-card-meta" style="flex-direction:column;align-items:flex-start;gap:5px;margin-top:8px">
          ${d.cardType?`<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <span class="tag" style="background:rgba(99,102,241,.15);color:#A5B4FC;border-color:rgba(99,102,241,.3)">${esc(d.cardType)}</span>
            ${d.cardValue?`<span style="font-size:.71rem;font-weight:600;color:var(--t2)">${fmtCurrency(d.cardValue)}</span>`:''}
          </div>`:''}
          ${d.commissionValue||d.commissionPct?`<div style="font-size:.7rem;color:#6EE7B7;font-weight:500">Comissão: ${d.commissionValue?fmtCurrency(d.commissionValue):''}${d.commissionPct?` (${d.commissionPct}%)`:''}</div>`:''}
          ${d.status===WON()?(d.commissionPaid?`<span class="tag" style="background:rgba(16,185,129,.16);color:#6EE7B7;border-color:rgba(16,185,129,.3)">💰 Comissão paga</span>`:`<span class="tag" style="background:rgba(245,158,11,.14);color:#FCD34D;border-color:rgba(245,158,11,.3)">⏳ Comissão a pagar</span>`):''}
          ${d.prospectorName?`<div style="font-size:.68rem;color:var(--t3)">👤 ${esc(d.prospectorName)}</div>`:''}
        </div>
      </div>`;
    }).join(''):'<div class="crm-card-empty">Arraste aqui</div>';
    return `<div class="crm-col" data-status="${st}"><div class="crm-col-hd"><span class="crm-col-dot" style="background:${dealSc[st]}"></span><span class="crm-col-nm">${dealSm[st].label}</span><span class="crm-col-cnt">${items.length}</span></div><div class="crm-col-bd">${cards}</div></div>`;
  }).join('');

  $('content').innerHTML=`
    <div class="kpi-grid">${kcs}</div>
    <div class="tbl-controls"><div class="search-wrap" style="flex:0 1 280px;min-width:160px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input class="search-inp" id="deal-q" placeholder="Buscar negociação…" value="${esc(S.dealQ)}"></div><p class="sec-sub" style="margin:0;flex:1">${S.sel.mode?'Toque nos cartões para selecionar.':'Arraste entre colunas para mudar o status, ou clique no card para editar.'}</p>${selBar()}</div>
    <div style="overflow-x:auto;margin:0 -2px">
      <div class="crm-board" id="deal-board" style="grid-template-columns:repeat(${DEAL_STS().length},minmax(190px,1fr));min-width:${DEAL_STS().length*190}px">
        ${total===0?`<div style="grid-column:1/-1"><div class="empty-state"><div class="empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div><div class="empty-title">Nenhuma negociação ainda</div><div class="empty-sub">Quando um lead marcar "Enviou Contato" no CRM, a negociação aparece aqui automaticamente.</div></div></div>`:(dq&&!boardDeals.length)?`<div style="grid-column:1/-1"><div class="empty-state"><div class="empty-title">Nenhum resultado</div><div class="empty-sub">Nada encontrado para "${esc(S.dealQ)}".</div></div></div>`:board}
      </div>
    </div>`;

  const board2=$('deal-board'); if(!board2)return;
  let dragId=null;
  board2.addEventListener('dragstart',e=>{ const c=e.target.closest('.crm-card'); if(!c)return; dragId=c.dataset.id; c.classList.add('dragging'); });
  board2.addEventListener('dragend',e=>{ const c=e.target.closest('.crm-card'); if(c)c.classList.remove('dragging'); board2.querySelectorAll('.crm-col.dragover').forEach(x=>x.classList.remove('dragover')); });
  board2.addEventListener('dragover',e=>{ const col=e.target.closest('.crm-col'); if(col){ e.preventDefault(); col.classList.add('dragover'); } });
  board2.addEventListener('dragleave',e=>{ const col=e.target.closest('.crm-col'); if(col&&!col.contains(e.relatedTarget))col.classList.remove('dragover'); });
  board2.addEventListener('drop',async e=>{
    const col=e.target.closest('.crm-col'); if(!col||!dragId)return; e.preventDefault();
    const ns=col.dataset.status; const deal=S.deals.find(x=>x.id===dragId);
    if(deal&&deal.status!==ns){
      const patch={status:ns,updated_at:new Date().toISOString()};
      if((ns===WON()||ns===LOST())&&!deal.closedAt) patch.closed_at=new Date().toISOString();
      if(ns!==WON()&&ns!==LOST()) patch.closed_at=null;
      const{error}=await sb.from('deals').update(patch).eq('id',dragId);
      if(error){ toast(error.message,'error'); }
      else { deal.status=ns; deal.closedAt=patch.closed_at||null; toast(`→ ${DEAL_SM()[ns].label}`,'success'); }
    }
    dragId=null; renderDeals();
  });
  board2.addEventListener('click',e=>{ const c=e.target.closest('.crm-card[data-id]'); if(!c)return; if(S.sel.mode){ selToggle(c.dataset.id); renderDeals(); return; } dealForm(c.dataset.id); });
  $('deal-q').oninput=e=>{ S.dealQ=e.target.value; renderDeals(); refocus('deal-q'); };
  bindSelBar(boardDeals.map(d=>d.id), renderDeals, bulkDeleteDeals);
}

function dealForm(id){
  const d=S.deals.find(x=>x.id===id); if(!d)return;
  const nm=d.leadName||'—', ph=d.leadPhone||'';
  const m=MOD();
  const stOpts=DEAL_STS().map(s=>`<option value="${s}" ${d.status===s?'selected':''}>${DEAL_SM()[s].label}</option>`).join('');
  const ctOpts=['',...CARD_TYPES()].map(t=>`<option value="${esc(t)}" ${d.cardType===t?'selected':''}>${t||'Selecione o tipo'}</option>`).join('');
  openModal(`<div class="modal-ov"><div class="modal-box" style="max-width:520px"><div class="modal-hd">
    <div>
      <div class="modal-title">Negociação · ${esc(nm)}</div>
      <div class="modal-sub">${ph?'📱 '+esc(ph):''} ${d.prospectorName?'· Prospectado por: <b>'+esc(d.prospectorName)+'</b>':''}</div>
    </div>
    <div class="x"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>
    </div>
    <div class="modal-bd"><div class="form-grid">
      <div class="fld full"><label>Status da Negociação</label><select id="df-status">${stOpts}</select></div>
      <div class="fld full"><label>${esc(m.labels.cardTypeLabel)}</label><select id="df-cardtype">${ctOpts}</select></div>
      <div class="fld"><label>${esc(m.labels.cardValueLabel)} (R$)</label><input id="df-cardval" type="text" inputmode="decimal" value="${numberToMoney(d.cardValue)}" placeholder="0,00"></div>
      <div class="fld"><label>Comissão (R$)</label><input id="df-commval" type="text" inputmode="decimal" value="${numberToMoney(d.commissionValue)}" placeholder="0,00"></div>
      <div class="fld full"><label>Comissão (%)</label><input id="df-commpct" type="number" min="0" max="100" step="0.01" value="${d.commissionPct!=null?d.commissionPct:getGoals().commissionPct}" placeholder="Ex.: 2"></div>
      <div class="fld full" id="df-date-wrap" style="display:${(d.status===WON()||d.status===LOST())?'flex':'none'}">
        <label>Data da venda/negociação</label>
        <input id="df-closeddate" type="date" value="${d.closedAt?isoDate(d.closedAt):''}">
      </div>
      <div class="fld full"><label>Observações</label><textarea id="df-notes" placeholder="Anotações sobre a negociação…">${esc(d.notes||'')}</textarea></div>
    </div>
    <label id="df-paid-wrap" style="display:${d.status===WON()?'flex':'none'};align-items:center;gap:10px;margin-top:12px;padding:11px 13px;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.25);border-radius:10px;cursor:pointer">
      <input type="checkbox" id="df-paid" ${d.commissionPaid?'checked':''} style="width:19px;height:19px;accent-color:#10B981;cursor:pointer">
      <span><span style="font-weight:700;font-size:.84rem;color:#10B981">💰 Comissão paga</span><br><span style="font-size:.7rem;color:var(--t3)">Marque quando a comissão desta venda já tiver sido paga</span></span>
    </label>
    <div style="font-size:.72rem;color:var(--t3);margin-top:10px">
      Criado em ${fmtDate(d.createdAt)}${d.closedAt?' · Fechado em '+fmtDate(d.closedAt):''}
    </div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-danger btn-sm" id="df-del" style="margin-right:auto">Excluir</button>
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="df-save">Salvar</button>
    </div></div></div>`);

  maskMoneyInput($('df-cardval')); maskMoneyInput($('df-commval'));
  // Auto-calcular comissão R$ a partir do valor da carta × % (padrão vem de Metas,
  // ajustável por negociação). Só recalcula enquanto o usuário não editar a
  // comissão manualmente — a partir daí o valor digitado por ele prevalece.
  let commTouched = d.commissionValue!=null;
  $('df-commval').addEventListener('input', ()=>{ commTouched=true; });
  const calcComm=()=>{
    if(commTouched) return;
    const pct=parseFloat($('df-commpct').value)||0;
    const val=moneyToNumber($('df-cardval').value)||0;
    if(pct>0&&val>0) $('df-commval').value=numberToMoney(val*pct/100);
  };
  $('df-commpct').addEventListener('input',calcComm);
  $('df-cardval').addEventListener('input',calcComm);
  calcComm();
  // mostra "Comissão paga" e "Data da venda" só quando a negociação estiver fechada (vendida/perdida)
  $('df-status').addEventListener('change',e=>{
    const isClose=e.target.value===WON()||e.target.value===LOST();
    const w=$('df-paid-wrap'); if(w) w.style.display=e.target.value===WON()?'flex':'none';
    const dw=$('df-date-wrap'); if(dw) dw.style.display=isClose?'flex':'none';
  });

  $('df-del').onclick=()=>delDeal(id);
  $('df-save').onclick=async()=>{
    const status=$('df-status').value;
    const cardType=$('df-cardtype').value||null;
    const cardValue=moneyToNumber($('df-cardval').value);
    const commissionValue=moneyToNumber($('df-commval').value);
    const commissionPct=$('df-commpct').value;
    const notes=$('df-notes').value.trim();
    const isClosing=status===WON()||status===LOST();
    const closedDateVal=$('df-closeddate')?$('df-closeddate').value:'';
    const closedAt=isClosing?(closedDateVal?new Date(closedDateVal+'T12:00:00').toISOString():(d.closedAt||new Date().toISOString())):null;
    const commissionPaid = status===WON() && $('df-paid') && $('df-paid').checked;
    const paidAt = commissionPaid ? (d.paidAt||new Date().toISOString()) : null;
    const patch=dealToRow({status,cardType,cardValue,commissionValue,commissionPct,commissionPaid,paidAt,notes,closedAt});
    $('df-save').disabled=true;
    const{error}=await sb.from('deals').update(patch).eq('id',id);
    if(error){ toast(error.message,'error'); $('df-save').disabled=false; return; }
    Object.assign(d,{status,cardType,cardValue,commissionValue,commissionPct:commissionPct?Number(commissionPct):null,commissionPaid,paidAt,notes,closedAt});
    closeModal(); toast('Negociação atualizada!','success'); renderDeals();
  };
}

function delDeal(id){
  const d=S.deals.find(x=>x.id===id);
  openModal(`<div class="modal-ov"><div class="modal-box"><div class="modal-hd"><div class="modal-title">Excluir Negociação</div><div class="x"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div></div><div class="modal-bd"><p class="confirm-txt">Excluir a negociação de <b>${esc(d&&(d.leadName||'este lead'))}</b>? O lead não será excluído.</p></div><div class="modal-ft"><button class="btn btn-outline" onclick="closeModal()">Cancelar</button><button class="btn btn-danger" id="dd-ok">Excluir</button></div></div></div>`);
  $('dd-ok').onclick=async()=>{ const{error}=await sb.from('deals').delete().eq('id',id); if(error){toast(error.message,'error');return;} S.deals=S.deals.filter(x=>x.id!==id); closeModal(); toast('Negociação excluída','success'); renderDeals(); };
}

/* =====================================================================
   METAS (GOALS) — motivação da equipe (mensais, compartilhadas no espaço)
===================================================================== */
function getGoals(){ const g=(S.org&&S.org.settings&&S.org.settings.goals)||{}; return { contacts:Number(g.contacts)||0, sales:Number(g.sales)||0, revenue:Number(g.revenue)||0, commission:Number(g.commission)||0, leadDailyMin:g.leadDailyMin!=null?Number(g.leadDailyMin):50, leadDailyMax:g.leadDailyMax!=null?Number(g.leadDailyMax):120, callsWeekly:Number(g.callsWeekly)||0, payDayRate:g.payDayRate!=null?Number(g.payDayRate):25, payTargetPerDay:g.payTargetPerDay!=null?Number(g.payTargetPerDay):50, commissionPct:g.commissionPct!=null?Number(g.commissionPct):0.1 }; }

// Cálculo do valor a pagar na semana ao prospector.
// Modelo: paga-se "payDayRate" por dia ao prospectar "payTargetPerDay" leads do Instagram.
// Acima/abaixo da meta é proporcional: cada lead vale payDayRate/payTargetPerDay.
// Ex.: 25/dia p/ 50 leads → R$0,50/lead; 120 leads num dia = R$60. Soma por dia da semana.
function weeklyPay(){
  const g=getGoals(); const { ws,we }=weekRange();
  const inW=iso=>{ if(!iso)return false; const d=new Date(iso); return d>=ws&&d<we; };
  const dayRate=g.payDayRate||0, target=g.payTargetPerDay||0;
  const perLead = target>0 ? dayRate/target : 0;
  const wkLeads=S.leads.filter(l=>(l.tipo||'comum')!=='empresario' && inW(l.addedAt));
  const prospectLeads=wkLeads.length;
  const prospectPay=prospectLeads*perLead;
  const unpaid=(S.deals||[]).filter(d=>d.status===WON() && !d.commissionPaid)
    .map(d=>({ name:d.leadName||d.leadUsername||d.cardType||'Venda', value:Number(d.commissionValue)||0, closedAt:d.closedAt }));
  const unpaidTotal=unpaid.reduce((s,d)=>s+d.value,0);
  return { ws, we, dayRate, target, perLead, prospectLeads, prospectPay, unpaid, unpaidTotal, total:prospectPay+unpaidTotal };
}
function monthRange(){ const n=new Date(); return { s:new Date(n.getFullYear(),n.getMonth(),1), e:new Date(n.getFullYear(),n.getMonth()+1,1) }; }
// offset=0 → semana atual; offset=-1 → semana anterior; etc. (usado pela aba Relatórios p/ navegar semanas passadas)
function weekRange(offset=0){ const n=new Date(); n.setHours(0,0,0,0); const dow=(n.getDay()+6)%7; const ws=new Date(n); ws.setDate(n.getDate()-dow+offset*7); const we=new Date(ws); we.setDate(ws.getDate()+7); return { ws, we }; }
function motivMsg(pct,target){
  if(!target) return ['Defina uma meta para acompanhar o progresso.','var(--t3)'];
  if(pct>=100) return ['🎉 Meta batida! Sensacional, continue voando!','#10B981'];
  if(pct>=75)  return ['🔥 Quase lá! Falta pouquinho para bater!','#F59E0B'];
  if(pct>=50)  return ['💪 Passou da metade! Bora fechar!','#6366F1'];
  if(pct>=25)  return ['🚀 Bom ritmo, siga firme!','#6366F1'];
  return ['✨ Cada contato conta — comece agora!','#8B5CF6'];
}

function renderGoals(){
  const g=getGoals();
  const view=S.goalsView||'week';
  const toggle=`<div class="period-tabs"><div class="period-tab${view==='week'?' active':''}" data-gview="week">Semanal</div><div class="period-tab${view==='month'?' active':''}" data-gview="month">Mensal</div></div>`;
  const body = view==='week' ? goalsWeekly(g) : goalsMonthly(g);
  $('content').innerHTML=`
    <div class="tbl-controls">
      <div style="flex:1"><div class="sec-title" style="margin:0">Metas</div><div class="sec-sub" style="margin:2px 0 0">${view==='week'?(MOD().features.weeklyPay?'Pagamento semanal da equipe — leads de prospecção e ligações efetivas.':'Atividade semanal — leads de prospecção e ligações efetivas.'):'Metas do mês — vendas, faturamento e comissão.'}</div></div>
      ${toggle}
      <button class="btn btn-primary" id="goals-edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>Definir metas</button>
    </div>
    ${body}`;
  $('goals-edit').onclick=()=>goalsForm();
  document.querySelectorAll('[data-gview]').forEach(b=>b.onclick=()=>{ S.goalsView=b.dataset.gview; renderGoals(); });
}

function goalsWeekly(g){
  const { ws,we }=weekRange();
  const inW=iso=>{ if(!iso)return false; const d=new Date(iso); return d>=ws&&d<we; };
  const wkLeads=S.leads.filter(l=>(l.tipo||'comum')!=='empresario' && inW(l.addedAt));
  const totalLeads=wkLeads.length;
  const dayNames=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  const perDay=Array.from({length:7},(_,i)=>{ const ds=new Date(ws); ds.setDate(ds.getDate()+i); const de=new Date(ds); de.setDate(de.getDate()+1); return wkLeads.filter(l=>{ const t=new Date(l.addedAt); return t>=ds&&t<de; }).length; });
  const min=g.leadDailyMin||50, max=g.leadDailyMax||120;
  const todayIdx=(new Date().getDay()+6)%7;
  const barMax=Math.max(max,...perDay,1);
  const hitMin=perDay.filter(c=>c>=min).length;
  const bars=perDay.map((c,i)=>{
    const col=c>=max?'#F59E0B':c>=min?'#10B981':c>0?'#EF4444':'var(--surf4)';
    const h=Math.max(Math.round(c/barMax*100),c>0?6:2);
    const today=i===todayIdx;
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px">
      <div style="font-size:.66rem;font-weight:700;color:${c>0?'var(--t2)':'var(--t3)'}">${c}</div>
      <div style="width:100%;max-width:34px;height:92px;background:var(--surf2);border-radius:6px;display:flex;align-items:flex-end;overflow:hidden">
        <div style="width:100%;height:${h}%;background:${col};border-radius:6px;transition:height .4s"></div>
      </div>
      <div style="font-size:.62rem;color:${today?'var(--p)':'var(--t3)'};font-weight:${today?'700':'500'}">${dayNames[i]}</div>
    </div>`;
  }).join('');
  const effCalls=S.calls.filter(c=>inW(c.at) && (c.outcome||'nao_atendeu')!=='nao_atendeu');
  const totalEff=effCalls.length;
  const callsGoal=g.callsWeekly||0;
  const callPct=callsGoal>0?Math.min(100,Math.round(totalEff/callsGoal*100)):0;
  const wkLabel=`${ws.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} a ${new Date(we-1).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}`;
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px">
    <div class="card" style="padding:18px;border-left:3px solid #6366F1">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
        <div><div style="font-weight:700;font-size:.95rem">📸 Leads do Instagram</div><div style="font-size:.72rem;color:var(--t3)">semana ${wkLabel} · pagamento por leads</div></div>
        <div style="text-align:right"><div style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:1.6rem;line-height:1;color:#6366F1">${totalLeads}</div><div style="font-size:.7rem;color:var(--t3)">na semana</div></div>
      </div>
      <div style="display:flex;gap:6px;align-items:flex-end">${bars}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
        <span style="font-size:.72rem;color:var(--t2)"><b style="color:#10B981">${hitMin}/7</b> dias bateram o mínimo</span>
        <span style="font-size:.7rem;color:var(--t3)">meta/dia: <b style="color:#10B981">${min}</b>–<b style="color:#F59E0B">${max}</b></span>
      </div>
      <div style="display:flex;gap:13px;margin-top:9px;font-size:.63rem;color:var(--t3);flex-wrap:wrap">
        <span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#EF4444;vertical-align:middle"></i> abaixo de ${min}</span>
        <span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#10B981;vertical-align:middle"></i> ${min} ou mais</span>
        <span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#F59E0B;vertical-align:middle"></i> ${max} ou mais</span>
      </div>
    </div>
    <div class="card" style="padding:18px;border-left:3px solid #F59E0B">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
        <div><div style="font-weight:700;font-size:.95rem">📞 Ligações efetivas</div><div style="font-size:.72rem;color:var(--t3)">atendidas (com ou sem interesse)</div></div>
        <div style="text-align:right"><div style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:1.6rem;line-height:1;color:#F59E0B">${totalEff}</div><div style="font-size:.7rem;color:var(--t3)">${callsGoal>0?'de '+callsGoal:'na semana'}</div></div>
      </div>
      ${callsGoal>0?`<div style="background:var(--surf2);border-radius:20px;height:12px;overflow:hidden"><div style="width:${callPct}%;height:100%;background:linear-gradient(90deg,#F59E0B,#F59E0Bbb);border-radius:20px;transition:width .5s"></div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:9px"><span style="font-size:.76rem;font-weight:600;color:${callPct>=100?'#10B981':'#F59E0B'}">${callPct>=100?'🎉 Meta semanal batida!':callPct>=50?'💪 Mais da metade!':'🚀 Bora ligar!'}</span><span style="font-size:.82rem;font-weight:800;color:#F59E0B">${callPct}%</span></div>`
      :`<div style="font-size:.74rem;color:var(--t3);padding:6px 0">Defina uma meta semanal de ligações em <b>Definir metas</b> para acompanhar o progresso.</div>`}
      <div style="font-size:.66rem;color:var(--t3);margin-top:11px;padding-top:9px;border-top:1px solid var(--border)">Efetiva = a pessoa atendeu (interessado, retornar, sem interesse ou fechou). "Não atendeu" não conta.</div>
    </div>
  </div>`;
}

function goalsMonthly(g){
  const { s,e }=monthRange();
  const inM=iso=>{ if(!iso)return false; const d=new Date(iso); return d>=s&&d<e; };
  const contatosM = S.deals.filter(d=>inM(d.createdAt)).length;
  const vendidosM = S.deals.filter(d=>d.status===WON()&&inM(d.closedAt));
  const vendasM   = vendidosM.length;
  const faturM    = vendidosM.reduce((a,d)=>a+(Number(d.cardValue)||0),0);
  const commM     = vendidosM.reduce((a,d)=>a+(Number(d.commissionValue)||0),0);
  const now=new Date(); const last=new Date(now.getFullYear(),now.getMonth()+1,0);
  const daysLeft=Math.max(1,last.getDate()-now.getDate()+1);
  const monthLabel=now.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});

  const defs=[
    { key:'contacts',   label:'Contatos conquistados', hint:'leads que enviaram o contato', color:'#6366F1', money:false, cur:contatosM, target:g.contacts,
      icon:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>' },
    { key:'sales',      label:'Vendas fechadas', hint:'negociações marcadas como vendido', color:'#10B981', money:false, cur:vendasM, target:g.sales,
      icon:'<polyline points="20 6 9 17 4 12"/>' },
    { key:'revenue',    label:'Faturamento (cartas vendidas)', hint:'soma do valor das cartas vendidas', color:'#F59E0B', money:true, cur:faturM, target:g.revenue,
      icon:'<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
    { key:'commission', label:'Comissão acumulada', hint:'comissões das vendas do mês', color:'#8B5CF6', money:true, cur:commM, target:g.commission,
      icon:'<path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4z"/>' },
  ];

  const defined=defs.filter(d=>d.target>0).length;
  const done=defs.filter(d=>d.target>0&&d.cur>=d.target).length;
  const heroIcon = defined&&done===defined ? '🏆' : done>0 ? '🔥' : '🎯';
  const heroTitle = defined ? `${done} de ${defined} metas batidas` : 'Defina as metas do mês';
  const heroSub = !defined ? 'Clique em "Definir metas" para começar a acompanhar o progresso da equipe.'
    : done===defined ? 'Todas as metas concluídas! Equipe imparável. 🚀'
    : done>0 ? `Faltam ${defined-done} para completar o mês. Vocês conseguem!`
    : `Restam ${daysLeft} dias no mês. Foco total no resultado!`;

  const hero=`<div class="card" style="padding:20px;margin-bottom:16px;background:linear-gradient(135deg,rgba(99,102,241,.16),rgba(16,185,129,.10));border:1px solid rgba(99,102,241,.28)">
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div style="font-size:2.1rem;line-height:1">${heroIcon}</div>
      <div style="flex:1;min-width:160px">
        <div style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:1.1rem">${heroTitle}</div>
        <div style="font-size:.82rem;color:var(--t2);margin-top:3px">${heroSub}</div>
      </div>
    </div>
  </div>`;

  const cards=defs.map(d=>{
    const target=Number(d.target)||0;
    const pct=target>0?Math.min(100,Math.round(d.cur/target*100)):0;
    const remaining=Math.max(0,target-d.cur);
    const curTxt=d.money?fmtCurrency(d.cur):fmtNum(d.cur);
    const tgtTxt=d.money?fmtCurrency(target):fmtNum(target);
    const remTxt=d.money?fmtCurrency(remaining):fmtNum(remaining);
    const [msg,mc]=motivMsg(pct,target);
    const perDay=(!d.money&&target>0&&remaining>0)?Math.ceil(remaining/daysLeft):0;
    let foot='';
    if(target>0&&remaining>0) foot=`<div style="font-size:.73rem;color:var(--t2);margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.06)">Falta <b style="color:var(--t1)">${remTxt}</b> para a meta${perDay?` · ~<b style="color:${d.color}">${perDay}</b>/dia nos ${daysLeft} dias restantes`:''}</div>`;
    else if(target>0) foot=`<div style="font-size:.73rem;color:#10B981;margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.06)">✓ Meta concluída este mês!</div>`;
    return `<div class="card" style="padding:18px;margin-bottom:14px;border-left:3px solid ${d.color}">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <div style="width:42px;height:42px;border-radius:11px;background:${d.color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="${d.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d.icon}</svg></div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.95rem">${d.label}</div>
          <div style="font-size:.72rem;color:var(--t3)">${d.hint}</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:1.5rem;line-height:1;color:${d.color}">${curTxt}</div>
          <div style="font-size:.72rem;color:var(--t3)">de ${tgtTxt}</div>
        </div>
      </div>
      <div style="background:rgba(255,255,255,.06);border-radius:20px;height:12px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,${d.color},${d.color}bb);border-radius:20px;transition:width .5s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:9px;gap:8px">
        <span style="font-size:.78rem;font-weight:600;color:${mc}">${msg}</span>
        <span style="font-size:.85rem;font-weight:800;color:${d.color}">${pct}%</span>
      </div>
      ${foot}
    </div>`;
  }).join('');

  return `<div style="font-size:.72rem;color:var(--t3);text-transform:capitalize;margin-bottom:10px">Mês de ${monthLabel} · zeram a cada mês</div>${hero}<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px">${cards}</div>`;
}

function goalsForm(){
  const g=getGoals();
  openModal(`<div class="modal-ov"><div class="modal-box" style="max-width:480px"><div class="modal-hd">
    <div><div class="modal-title">Definir metas do mês</div><div class="modal-sub">Valem para toda a equipe do espaço</div></div>
    <div class="x"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>
    </div>
    <div class="modal-bd">
      <div style="font-size:.66rem;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Semanal · atividade de prospecção</div>
      <div class="form-grid">
        <div class="fld"><label>Leads/dia — mínimo</label><input id="gf-leadmin" type="number" min="0" value="${g.leadDailyMin}" placeholder="50"></div>
        <div class="fld"><label>Leads/dia — máximo</label><input id="gf-leadmax" type="number" min="0" value="${g.leadDailyMax}" placeholder="120"></div>
        <div class="fld full"><label>Ligações efetivas / semana</label><input id="gf-callsweek" type="number" min="0" value="${g.callsWeekly||''}" placeholder="Ex.: 150"></div>
      </div>
      <div style="display:${MOD().features.weeklyPay?'block':'none'}">
        <div style="font-size:.66rem;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.05em;margin:14px 0 8px">Cálculo do pagamento (prospecção)</div>
        <div class="form-grid">
          <div class="fld"><label>Valor por dia (R$)</label><input id="gf-pay-rate" type="text" inputmode="decimal" value="${numberToMoney(g.payDayRate)}" placeholder="25,00"></div>
          <div class="fld"><label>Leads/dia p/ esse valor</label><input id="gf-pay-target" type="number" min="1" value="${g.payTargetPerDay}" placeholder="50"></div>
        </div>
        <div style="font-size:.68rem;color:var(--t3);margin-top:6px">Ex.: R$25/dia por 50 leads = R$0,50/lead. 120 leads num dia = R$60. O dashboard soma a semana e adiciona comissões de vendas ainda não pagas.</div>
      </div>
      <div style="height:1px;background:var(--border);margin:14px 0"></div>
      <div style="font-size:.66rem;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Comissão padrão</div>
      <div class="form-grid">
        <div class="fld full"><label>% padrão sobre o valor da venda</label><input id="gf-commpct" type="number" min="0" max="100" step="0.01" value="${g.commissionPct}" placeholder="Ex.: 0.1"></div>
      </div>
      <div style="font-size:.68rem;color:var(--t3);margin-top:6px">Usada para calcular a comissão automaticamente ao cadastrar uma negociação (venda) — dá pra ajustar em cada negociação individualmente.</div>
      <div style="height:1px;background:var(--border);margin:14px 0"></div>
      <div style="font-size:.66rem;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Mensal</div>
      <div class="form-grid">
        <div class="fld"><label>Meta de contatos</label><input id="gf-contacts" type="number" min="0" value="${g.contacts||''}" placeholder="Ex.: 40"></div>
        <div class="fld"><label>Meta de vendas</label><input id="gf-sales" type="number" min="0" value="${g.sales||''}" placeholder="Ex.: 5"></div>
        <div class="fld full"><label>Meta de faturamento (R$)</label><input id="gf-revenue" type="text" inputmode="decimal" value="${g.revenue?numberToMoney(g.revenue):''}" placeholder="500.000,00"></div>
        <div class="fld full"><label>Meta de comissão (R$)</label><input id="gf-commission" type="text" inputmode="decimal" value="${g.commission?numberToMoney(g.commission):''}" placeholder="10.000,00"></div>
      </div>
      <div style="font-size:.72rem;color:var(--t3);margin-top:8px">Deixe em branco (ou 0) para não acompanhar aquela meta.</div>
    </div>
    <div class="modal-ft"><button class="btn btn-outline" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" id="gf-save">Salvar metas</button></div></div></div>`);
  maskMoneyInput($('gf-pay-rate')); maskMoneyInput($('gf-revenue')); maskMoneyInput($('gf-commission'));
  $('gf-save').onclick=async()=>{
    const newGoals={ contacts:parseInt($('gf-contacts').value)||0, sales:parseInt($('gf-sales').value)||0, revenue:moneyToNumber($('gf-revenue').value)||0, commission:moneyToNumber($('gf-commission').value)||0, leadDailyMin:parseInt($('gf-leadmin').value)||0, leadDailyMax:parseInt($('gf-leadmax').value)||0, callsWeekly:parseInt($('gf-callsweek').value)||0, payDayRate:moneyToNumber($('gf-pay-rate').value)||0, payTargetPerDay:parseInt($('gf-pay-target').value)||50, commissionPct:parseFloat($('gf-commpct').value)||0.1 };
    const settings={ ...(S.org.settings||{}), goals:newGoals };
    $('gf-save').disabled=true;
    const{error}=await sb.from('orgs').update({ settings }).eq('id',S.org.id);
    if(error){ toast(error.message,'error'); $('gf-save').disabled=false; return; }
    S.org.settings=settings; closeModal(); toast('Metas atualizadas!','success'); renderGoals();
  };
}

/* =====================================================================
   RELATÓRIOS — histórico permanente (nada some quando a semana vira):
   pagamento semanal por membro da equipe, leads/ligações semana a semana
   e relatório livre por venda/cliente.
===================================================================== */
const REL_VIEWS = [
  { k:'pay',    label:'Pagamento semanal' },
  { k:'leads',  label:'Leads por semana' },
  { k:'calls',  label:'Ligações por semana' },
  { k:'vendas', label:'Relatório de vendas' },
];
const isoDate = d => new Date(d).toISOString().slice(0,10);
const fmtDateOnly = s => { if(!s) return '—'; const [y,m,dd]=String(s).split('-'); return `${dd}/${m}/${y}`; };
const memberLabel = m => (m&&(m.name||m.email))||'—';

// Métricas de uma semana [ws,we) para prospecção (leads) e comissões (deals vendidos),
// opcionalmente filtradas por quem prospectou/vendeu (memberId = leads/deals.created_by).
function weekReport(ws, we, memberId){
  const inW = iso => { if(!iso) return false; const d=new Date(iso); return d>=ws && d<we; };
  const g=getGoals(); const dayRate=g.payDayRate||0, target=g.payTargetPerDay||0;
  const perLead = target>0 ? dayRate/target : 0;
  const wkLeads = S.leads.filter(l=>(l.tipo||'comum')!=='empresario' && inW(l.addedAt) && (!memberId||l.createdBy===memberId));
  const prospectLeads = wkLeads.length;
  const prospectPay = prospectLeads*perLead;
  const closedThisWeek = (S.deals||[]).filter(d=>d.status===WON() && inW(d.closedAt) && (!memberId||d.createdBy===memberId));
  const nameOf = d => d.leadName||d.leadUsername||d.cardType||'Venda';
  const pending = closedThisWeek.filter(d=>!d.commissionPaid).map(d=>({ id:d.id, name:nameOf(d), value:Number(d.commissionValue)||0, closedAt:d.closedAt }));
  const paid = closedThisWeek.filter(d=>d.commissionPaid).map(d=>({ id:d.id, name:nameOf(d), value:Number(d.commissionValue)||0, paidAt:d.paidAt }));
  const pendingTotal = pending.reduce((s,d)=>s+d.value,0);
  return { prospectLeads, prospectPay, pending, paid, pendingTotal, total:prospectPay+pendingTotal, dealIds:pending.map(d=>d.id) };
}

function renderRelatorios(){
  if(!REL_VIEWS.some(v=>v.k===S.relView)) S.relView='pay';
  const showPay = MOD().features.weeklyPay;
  if(S.relView==='pay' && !showPay) S.relView='leads';
  const views = showPay ? REL_VIEWS : REL_VIEWS.filter(v=>v.k!=='pay');
  const tabs = views.map(v=>`<div class="period-tab${S.relView===v.k?' active':''}" data-relv="${v.k}">${v.label}</div>`).join('');
  $('content').innerHTML = `
    <div class="tbl-controls">
      <div style="flex:1"><div class="sec-title" style="margin:0">Relatórios</div><div class="sec-sub" style="margin:2px 0 0">Histórico permanente — nada some quando a semana vira.</div></div>
      <div class="period-tabs">${tabs}</div>
    </div>
    <div id="rel-body"></div>`;
  document.querySelectorAll('[data-relv]').forEach(b=>b.onclick=()=>{ S.relView=b.dataset.relv; renderRelatorios(); });
  ({ pay:renderRelPay, leads:()=>renderRelWeekly('leads'), calls:()=>renderRelWeekly('calls'), vendas:renderRelVendas }[S.relView]||renderRelPay)();
}

function renderRelPay(){
  if(!S.members.length){ $('rel-body').innerHTML='<div class="card" style="padding:24px;text-align:center;color:var(--t3);font-size:.8rem">Nenhum membro na equipe ainda.</div>'; return; }
  if(!S.relMemberId || !S.members.some(m=>m.id===S.relMemberId)) S.relMemberId=(S.session&&S.session.user&&S.session.user.id)||S.members[0].id;
  const off=S.relWeekOffset||0;
  const { ws, we }=weekRange(off);
  const wkLbl=`${ws.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} a ${new Date(we-1).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})}`;
  const rep=weekReport(ws, we, S.relMemberId);
  const saved=S.weeklyPayments.find(p=>p.memberId===S.relMemberId && p.weekStart===isoDate(ws));
  const memberSel=S.members.length>1?`<select class="flt-sel" id="rel-member">${S.members.map(m=>`<option value="${esc(m.id)}" ${m.id===S.relMemberId?'selected':''}>${esc(memberLabel(m))}</option>`).join('')}</select>`:'';
  const rowsHtml=(list,icon,color,dateLbl)=>list.map(d=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:.72rem;padding:5px 0;border-bottom:1px dashed var(--border)"><span style="color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${icon} ${esc(d.name)}${d[dateLbl]?` <span style="color:var(--t3)">(${fmtDate(d[dateLbl])})</span>`:''}</span><span style="color:${color};font-weight:700;white-space:nowrap">${fmtCurrency(d.value)}</span></div>`).join('');
  const pendRows=rep.pending.length?rowsHtml(rep.pending,'⏳','#FCD34D','closedAt'):'<div style="font-size:.72rem;color:var(--t3);padding:4px 0">Nenhuma comissão pendente nesta semana.</div>';
  const paidRows=rowsHtml(rep.paid,'✅','#6EE7B7','paidAt');
  $('rel-body').innerHTML=`
    <div class="card" style="padding:20px;border-left:3px solid ${saved?'#10B981':'#F59E0B'}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" id="rel-prev">‹</button>
          <div><div style="font-weight:800;font-size:.95rem">Semana ${wkLbl}</div><div style="font-size:.72rem;color:var(--t3)">${off===0?'semana atual':off<0?`${-off} semana(s) atrás`:`daqui a ${off} semana(s)`}</div></div>
          <button class="btn btn-outline btn-sm" id="rel-next" ${off>=0?'disabled':''}>›</button>
          ${off!==0?'<button class="btn btn-outline btn-sm" id="rel-today">Hoje</button>':''}
        </div>
        ${memberSel}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:14px">
        <div style="background:var(--surf2);border-radius:9px;padding:12px 14px"><div style="font-size:.72rem;color:var(--t3);margin-bottom:3px">Prospecção · ${rep.prospectLeads} leads</div><div style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:1.3rem;color:#6366F1">${fmtCurrency(rep.prospectPay)}</div></div>
        <div style="background:var(--surf2);border-radius:9px;padding:12px 14px"><div style="font-size:.72rem;color:var(--t3);margin-bottom:3px">Comissões pendentes</div><div style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:1.3rem;color:#F59E0B">${fmtCurrency(rep.pendingTotal)}</div></div>
        <div style="background:var(--surf2);border-radius:9px;padding:12px 14px"><div style="font-size:.72rem;color:var(--t3);margin-bottom:3px">Total a receber</div><div style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:1.3rem;color:#10B981">${fmtCurrency(rep.total)}</div></div>
      </div>
      <div style="margin-bottom:14px"><div style="font-size:.68rem;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Comissões da semana</div>${pendRows}${paidRows}</div>
      ${saved
        ? `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:11px 13px;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.25);border-radius:10px"><span style="font-weight:700;font-size:.84rem;color:#10B981">✅ Pagamento confirmado</span><span style="font-size:.74rem;color:var(--t3)">${fmtCurrency(saved.total)} · confirmado em ${fmtDate(saved.createdAt)}</span></div>`
        : `<button class="btn btn-primary" id="rel-confirm" ${rep.total<=0?'disabled':''}>Confirmar pagamento da semana (${fmtCurrency(rep.total)})</button>`}
    </div>
    <div class="card" style="padding:18px;margin-top:16px">
      <div class="card-title" style="margin-bottom:10px">Histórico de pagamentos confirmados</div>
      ${renderPayHistory(S.relMemberId)}
    </div>`;
  $('rel-prev').onclick=()=>{ S.relWeekOffset=off-1; renderRelPay(); };
  $('rel-next').onclick=()=>{ if(off<0){ S.relWeekOffset=off+1; renderRelPay(); } };
  const todayBtn=$('rel-today'); if(todayBtn) todayBtn.onclick=()=>{ S.relWeekOffset=0; renderRelPay(); };
  const sel=$('rel-member'); if(sel) sel.onchange=e=>{ S.relMemberId=e.target.value; renderRelPay(); };
  const cf=$('rel-confirm'); if(cf) cf.onclick=()=>confirmWeeklyPayment(ws, we, S.relMemberId, rep);
}
function renderPayHistory(memberId){
  const rows=S.weeklyPayments.filter(p=>p.memberId===memberId).sort((a,b)=>b.weekStart.localeCompare(a.weekStart));
  if(!rows.length) return '<div style="font-size:.74rem;color:var(--t3)">Nenhum pagamento confirmado ainda.</div>';
  return rows.map(p=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:.76rem;padding:8px 0;border-bottom:1px solid var(--border)"><span>${fmtDateOnly(p.weekStart)} a ${fmtDateOnly(p.weekEnd)}</span><span style="color:var(--t3);font-size:.7rem">${p.prospectLeads} leads · confirmado em ${fmtDate(p.createdAt)}</span><span style="font-weight:700;color:#10B981">${fmtCurrency(p.total)}</span></div>`).join('');
}
// "Confirmar pagamento" marca as comissões pendentes da semana como pagas (mesmo
// campo commission_paid usado no formulário de negociação) e grava um snapshot
// permanente em weekly_payments — daí em diante o valor nunca mais desaparece,
// mesmo que a semana vire ou os leads/deals mudem de outra forma.
async function confirmWeeklyPayment(ws, we, memberId, rep){
  const btn=$('rel-confirm'); if(btn) btn.disabled=true;
  const now=new Date().toISOString();
  if(rep.dealIds.length){
    const { error }=await sb.from('deals').update({ commission_paid:true, paid_at:now }).in('id',rep.dealIds);
    if(error){ toast(error.message,'error'); if(btn)btn.disabled=false; return; }
    rep.dealIds.forEach(id=>{ const d=S.deals.find(x=>x.id===id); if(d){ d.commissionPaid=true; d.paidAt=now; } });
  }
  const member=S.members.find(m=>m.id===memberId);
  const row={ org_id:S.org.id, member_id:memberId, member_name:memberLabel(member), week_start:isoDate(ws), week_end:isoDate(new Date(we-1)),
    prospect_leads:rep.prospectLeads, prospect_pay:rep.prospectPay, commission_pay:rep.pendingTotal, total:rep.total, deal_ids:rep.dealIds,
    created_by:(S.session&&S.session.user&&S.session.user.id)||null };
  const { data, error }=await sb.from('weekly_payments').upsert(row,{ onConflict:'org_id,member_id,week_start' }).select('*').single();
  if(error){ toast(error.message,'error'); if(btn)btn.disabled=false; return; }
  S.weeklyPayments=S.weeklyPayments.filter(p=>!(p.memberId===memberId&&p.weekStart===row.week_start));
  S.weeklyPayments.push(weeklyPaymentFromRow(data));
  toast('Pagamento confirmado!','success');
  renderRelPay();
}

// Contagem semana a semana de leads/ligações — usa os dados já carregados
// (têm data própria desde sempre), então dá pra olhar qualquer semana passada.
function renderRelWeekly(kind){
  const source = kind==='leads' ? S.leads.filter(l=>(l.tipo||'comum')!=='empresario') : S.calls;
  const dateKey = kind==='leads' ? 'addedAt' : 'at';
  const label = kind==='leads' ? 'Leads' : 'Ligações';
  const weeksBack = S.relWeeksBack||12;
  const rows=[];
  for(let i=0;i<weeksBack;i++){
    const { ws, we }=weekRange(-i);
    const count=source.filter(x=>{ if(!x[dateKey]) return false; const d=new Date(x[dateKey]); return d>=ws&&d<we; }).length;
    rows.push({ ws, we, count });
  }
  const maxV=Math.max(...rows.map(r=>r.count),1);
  const listHtml=rows.map(r=>{
    const w=Math.round(r.count/maxV*100);
    const lbl=`${r.ws.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} a ${new Date(r.we-1).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})}`;
    return `<div class="funnel-row" style="grid-template-columns:160px 1fr 42px"><div class="funnel-lbl">${lbl}</div><div class="funnel-track"><div class="funnel-fill" style="width:${w}%;background:#6366F1;opacity:.82"><span>${r.count>0?r.count:''}</span></div></div><div class="funnel-cnt">${r.count}</div></div>`;
  }).join('');
  $('rel-body').innerHTML=`
    <div class="card" style="padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><div class="card-title" style="margin:0">${label} por semana</div><span style="font-size:.72rem;color:var(--t3)">últimas ${weeksBack} semanas</span></div>
      <div class="funnel-wrap">${listHtml}</div>
      <button class="btn btn-outline btn-sm" id="rel-more" style="margin-top:14px">Carregar mais semanas</button>
    </div>`;
  $('rel-more').onclick=()=>{ S.relWeeksBack=weeksBack+12; renderRelWeekly(kind); };
}

// Relatório livre por venda/cliente (deals.report) — editável a qualquer momento.
function renderRelVendas(){
  const q=(S.relQ||'').toLowerCase().trim();
  const deals = q ? S.deals.filter(d=>(d.leadName||'').toLowerCase().includes(q)||(d.leadUsername||'').toLowerCase().includes(q)||(d.cardType||'').toLowerCase().includes(q)) : S.deals;
  const sorted=[...deals].sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
  const rows = sorted.length ? sorted.map(d=>{
    const nm=d.leadName||d.leadUsername||'—';
    const stLbl=DEAL_SM()[d.status]?DEAL_SM()[d.status].label:d.status;
    const stColor2=DEAL_SC()[d.status]||'#64748B';
    return `<div class="card" style="padding:16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <div><div style="font-weight:700;font-size:.86rem">${esc(nm)}</div><div style="font-size:.7rem;color:var(--t3)">${d.leadPhone?esc(d.leadPhone)+' · ':''}${d.cardType?esc(d.cardType)+' · ':''}<span style="color:${stColor2}">${esc(stLbl)}</span></div></div>
        <div style="text-align:right;font-size:.72rem;color:var(--t3)">${d.cardValue?fmtCurrency(d.cardValue):''}${d.commissionValue?' · comissão '+fmtCurrency(d.commissionValue):''}</div>
      </div>
      <div class="fld"><label>Relatório da venda</label><textarea data-report="${esc(d.id)}" placeholder="Anotações, histórico de negociação, follow-ups…">${esc(d.report||'')}</textarea></div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn btn-primary btn-sm" data-savereport="${esc(d.id)}">Salvar relatório</button></div>
    </div>`;
  }).join('') : '<div class="empty-state"><div class="empty-title">Nenhuma venda encontrada</div><div class="empty-sub">Vendas aparecem aqui automaticamente quando um lead vira negociação.</div></div>';
  $('rel-body').innerHTML=`
    <div class="search-wrap" style="margin-bottom:14px;max-width:340px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input class="search-inp" id="rel-vq" placeholder="Buscar cliente/venda…" value="${esc(S.relQ||'')}"></div>
    ${rows}`;
  $('rel-vq').oninput=e=>{ S.relQ=e.target.value; renderRelVendas(); refocus('rel-vq'); };
  $('rel-body').onclick=async e=>{
    const b=e.target.closest('[data-savereport]'); if(!b) return;
    const id=b.dataset.savereport; const ta=$('rel-body').querySelector(`[data-report="${id}"]`); if(!ta) return;
    b.disabled=true; b.textContent='Salvando…';
    const { error }=await sb.from('deals').update({ report:ta.value }).eq('id',id);
    if(error){ toast(error.message,'error'); b.disabled=false; b.textContent='Salvar relatório'; return; }
    const d=S.deals.find(x=>x.id===id); if(d) d.report=ta.value;
    toast('Relatório salvo!','success'); b.disabled=false; b.textContent='Salvar relatório';
  };
}

/* =====================================================================
   AGENDOR — envio via proxy (Cloudflare Worker, URL global do sistema em
   config.js). Roteia pelo funil (org_pipelines) ao qual o lead pertence.
===================================================================== */
function agendorOn(){ return !!(S.org && (S.org.agendor_token||'').trim()); }
function agendorAutoOn(){ return !(S.org && S.org.settings && S.org.settings.agendorAuto===false); }

async function agendorRequest(path, method='GET', body=null){
  const token=(S.org&&S.org.agendor_token||'').trim();
  if(!token) throw new Error('Token do Agendor não configurado');
  const proxy=(CFG.AGENDOR_PROXY_URL||'').trim().replace(/\/+$/,'');
  const base=proxy||AGENDOR_BASE; // o Worker já aponta para /v3
  const res=await fetch(base+path,{ method, headers:{ 'Authorization':'Token '+token, 'Content-Type':'application/json' }, body: body?JSON.stringify(body):undefined });
  let json=null; try{ json=await res.json(); }catch(e){}
  if(!res.ok){ const msg=json&&json.errors ? (Array.isArray(json.errors)?json.errors.join('; '):JSON.stringify(json.errors)) : ('HTTP '+res.status); throw new Error(msg); }
  return json;
}
function agendorCorsHint(m){ if(/Failed to fetch|NetworkError|CORS/i.test(m)) toast('Bloqueio de CORS — o Worker do proxy precisa estar publicado (config.js).','warn'); }

// Nome bonito para o Agendor: "Nome Real (@usuario)". Evita repetir quando
// o nome ainda está igual ao @ (dados antigos da extensão).
function agendorDisplayName(lead){
  const nm=(lead.name||'').trim();
  const un=(lead.username||'').trim().replace(/^@/,'');
  if(nm && un && nm.toLowerCase()!==un.toLowerCase()) return `${nm} (@${un})`;
  if(nm) return nm;
  if(un) return `@${un}`;
  return 'Lead IGProspect';
}

// Decide o funil/etapa do Agendor conforme o FUNIL (pipeline) do lead —
// cada pipeline tem seu próprio mapeamento (org_pipelines.agendor_map).
function agendorStageFor(lead){
  const p=leadPipeline(lead);
  return (p&&p.agendor_map)||null;
}

async function loadAgendorFunnels(){
  const btn=$('ag-load-funnels'); if(btn) btn.disabled=true;
  try{
    const res=await agendorRequest('/funnels');
    const data=(res&&res.data)||res||[];
    const flat=[];
    for(const f of data){ const stages=f.dealStages||f.stages||[]; for(const st of stages){ flat.push({ funnelId:f.id, funnelName:f.name||('Funil '+f.id), stageId:st.id, stageName:st.name||('Etapa '+st.id) }); } }
    S._funnelStages=flat;
    if(!flat.length) toast('Nenhum funil/etapa retornado pelo Agendor','warn');
    else toast(`${flat.length} etapas carregadas de ${data.length} funil(is)`,'success');
    renderSettings();
  }catch(err){ toast('Falha ao carregar funis: '+err.message,'error'); agendorCorsHint(err.message); }
  finally{ if(btn) btn.disabled=false; }
}

async function testAgendor(){
  const btn=$('ag-test'); if(btn) btn.disabled=true;
  try{ const me=await agendorRequest('/users/me'); const nm=(me&&me.data&&(me.data.name||me.data.email))||'conta'; toast('Conexão OK · '+nm,'success'); }
  catch(err){ toast('Falha na conexão: '+err.message,'error'); agendorCorsHint(err.message); }
  finally{ if(btn) btn.disabled=false; }
}

// Cria pessoa + negócio no funil roteado pelo tipo. Salva ids no lead.
async function sendLeadToAgendor(id, silent=false){
  const lead=S.leads.find(l=>l.id===id); if(!lead) return;
  if(!agendorOn()){ if(!silent){ toast('Configure o token do Agendor nas Configurações','warn'); S.route='settings'; renderShell(); } return; }
  const map=agendorStageFor(lead);
  const tipoLbl=(leadPipeline(lead)&&leadPipeline(lead).name)||'Negócios';
  if(!map||!map.stageId){ if(!silent){ toast(`Defina o destino no Agendor do funil "${tipoLbl}" nas Configurações`,'warn'); S.route='settings'; renderShell(); } return; }
  lead.agendorStatus='pending'; if(S.route==='leads') renderShell();
  try{
    const contact={};
    if(lead.phone) contact.mobile=lead.phone;
    if(lead.username) contact.instagram=lead.username;
    if(lead.email) contact.email=lead.email;
    const displayName=agendorDisplayName(lead);
    const personPayload={ name: displayName, description:[ lead.niche?`Nicho: ${lead.niche}`:'', lead.notes?`Obs: ${lead.notes}`:'', 'Origem: IGProspect' ].filter(Boolean).join('\n') };
    if(Object.keys(contact).length) personPayload.contact=contact;
    const person=await agendorRequest('/people','POST',personPayload);
    const personId=(person&&person.data&&person.data.id)||(person&&person.id);
    let dealId=null;
    if(personId){ const deal=await agendorRequest(`/people/${personId}/deals`,'POST',{ title:displayName, dealStage:map.stageId, funnel:map.funnelId, description:`Enviado pelo IGProspect (funil ${map.funnelName}).` }); dealId=(deal&&deal.data&&deal.data.id)||(deal&&deal.id)||null; }
    await sb.from('leads').update({ agendor_person_id:personId?String(personId):null, agendor_deal_id:dealId?String(dealId):null, agendor_funnel:map.funnelName, agendor_status:'ok' }).eq('id',id);
    Object.assign(lead,{ agendorPersonId:personId, agendorDealId:dealId, agendorFunnel:map.funnelName, agendorStatus:'ok' });
    toast(`Enviado ao Agendor → funil ${map.funnelName} ✓`,'success');
  }catch(err){
    lead.agendorStatus='failed';
    try{ await sb.from('leads').update({ agendor_status:'failed' }).eq('id',id); }catch(e){}
    toast('Falha ao enviar ao Agendor: '+err.message,'error'); agendorCorsHint(err.message);
  }
  if(S.route==='leads'||S.route==='crm') renderShell();
}

// Remove a pessoa (e o negócio) do Agendor. Retorna true se removeu.
async function deleteFromAgendor(lead){
  if(!lead || !agendorOn() || !lead.agendorPersonId) return false;
  try{
    if(lead.agendorDealId){ try{ await agendorRequest('/deals/'+lead.agendorDealId,'DELETE'); }catch(e){} }
    await agendorRequest('/people/'+lead.agendorPersonId,'DELETE');
    return true;
  }catch(err){ toast('Falha ao remover do Agendor: '+err.message,'warn'); agendorCorsHint(err.message); return false; }
}
// Tira o lead APENAS do Agendor, mantendo-o no sistema
function removeLeadFromAgendor(id){
  const l=S.leads.find(x=>x.id===id); if(!l) return;
  openModal(`<div class="modal-ov"><div class="modal-box"><div class="modal-hd"><div class="modal-title">Tirar do Agendor</div><div class="x"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div></div><div class="modal-bd"><p class="confirm-txt">Remover <b>${esc(l.name||l.username||'este lead')}</b> do Agendor? <b>Ele continua no sistema</b> — só sai do Agendor.</p></div><div class="modal-ft"><button class="btn btn-outline" onclick="closeModal()">Cancelar</button><button class="btn btn-danger" id="agrm-ok">Tirar do Agendor</button></div></div></div>`);
  $('agrm-ok').onclick=async()=>{
    $('agrm-ok').disabled=true;
    const ok=await deleteFromAgendor(l);
    if(ok){
      await sb.from('leads').update({ agendor_person_id:null, agendor_deal_id:null, agendor_funnel:null, agendor_status:null }).eq('id',id);
      Object.assign(l,{ agendorPersonId:null, agendorDealId:null, agendorFunnel:null, agendorStatus:null });
      toast('Removido do Agendor — mantido no sistema','success');
    }
    closeModal(); renderShell();
  };
}

async function sendCallToAgendor(id, silent=false){
  const call=S.calls.find(c=>c.id===id); if(!call) return;
  if(!agendorOn()){ if(!silent){ toast('Configure o token do Agendor nas Configurações','warn'); S.route='settings'; renderShell(); } return; }
  try{
    const personPayload={ name: call.name||call.phone||'Lead IGProspect', description:'Lead da prospecção IGProspect.' };
    if(call.phone) personPayload.contact={ mobile:call.phone };
    const person=await agendorRequest('/people','POST',personPayload);
    const personId=(person&&person.data&&person.data.id)||(person&&person.id);
    // negócio no funil conforme o tipo do lead vinculado (empresário→Empresários, comum→Negócios)
    const linked=call.leadId?S.leads.find(l=>l.id===call.leadId):null;
    const map=agendorStageFor(linked||{});
    if(personId&&map&&map.stageId){ try{ await agendorRequest(`/people/${personId}/deals`,'POST',{ title:(call.name||'Lead')+' — '+map.funnelName, dealStage:map.stageId, funnel:map.funnelId, description:`Ligação interessada (IGProspect) · funil ${map.funnelName}.` }); }catch(e){} }
    if(personId){ const when=call.at||new Date().toISOString(); const txt=`Ligação (${COM()[call.outcome]||call.outcome})`+(call.duration?` · ${call.duration} min`:'')+(call.notes?` — ${call.notes}`:''); try{ await agendorRequest(`/people/${personId}/tasks`,'POST',{ text:txt, type:'Ligação', dueDate:when, done:true }); }catch(e){} }
    toast('Ligação enviada ao Agendor ✓','success');
  }catch(err){ toast('Falha ao enviar ligação ao Agendor: '+err.message,'error'); agendorCorsHint(err.message); }
}

/* =====================================================================
   EQUIPE — mural/chat interno do espaço (mensagens com nome de quem enviou)
===================================================================== */
function renderTeam(){
  const me = S.session && S.session.user && S.session.user.id;
  const list = S.messages.length ? S.messages.map(m=>{
    const own = m.userId && me && m.userId===me;
    const t = m.at?new Date(m.at):new Date();
    const time = t.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    return `<div class="msg-row${own?' own':''}">
      ${own?'':`<div class="avatar msg-av">${esc(ini(m.author))}</div>`}
      <div class="msg-bub">
        ${own?'':`<div class="msg-author">${esc(m.author||'—')}</div>`}
        <div class="msg-body">${esc(m.body)}</div>
        <div class="msg-time">${time}${own?` · <span class="msg-del" data-delmsg="${esc(m.id)}">excluir</span>`:''}</div>
      </div>
    </div>`;
  }).join('') : `<div class="empty-state" style="margin:auto"><div class="empty-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><div class="empty-title">Nenhuma mensagem ainda</div><div class="empty-sub">Seja o primeiro a falar com a equipe 👋</div></div>`;
  $('content').innerHTML=`
    <div class="chat-wrap">
      <div class="chat-list" id="chat-list">${list}</div>
      <div class="chat-input">
        <input id="msg-input" class="search-inp" placeholder="Escreva uma mensagem para a equipe…" maxlength="1000" autocomplete="off">
        <button class="btn btn-primary" id="msg-send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Enviar</button>
      </div>
    </div>`;
  const cl=$('chat-list'); if(cl) cl.scrollTop=cl.scrollHeight;
  $('msg-send').onclick=sendMessage;
  const mi=$('msg-input'); if(mi){ mi.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMessage(); } }); mi.focus(); }
  $('chat-list').onclick=e=>{ const d=e.target.closest('[data-delmsg]'); if(d) delMessage(d.dataset.delmsg); };
  startTeamPoll();
}
async function sendMessage(){
  const mi=$('msg-input'); if(!mi) return;
  const body=(mi.value||'').trim(); if(!body) return;
  mi.value=''; mi.disabled=true;
  const author=(S.profile&&(S.profile.name||S.profile.email))||'Usuário';
  const { data, error }=await sb.from('messages').insert({ body, author_name:author }).select('*').single();
  mi.disabled=false; mi.focus();
  if(error){ toast(error.message,'error'); mi.value=body; return; }
  if(data && !S.messages.some(x=>x.id===data.id)) S.messages.push(msgFromRow(data));
  pushNotify({ title:`💬 ${author}`, body:body.length>120?body.slice(0,117)+'…':body, url:'/', tag:'chat' });
  renderTeam();
}
async function delMessage(id){
  const { error }=await sb.from('messages').delete().eq('id',id);
  if(error){ toast(error.message,'error'); return; }
  S.messages=S.messages.filter(m=>m.id!==id); renderTeam();
}

let msgChannel=null;
function subscribeMessages(){
  if(!sb || !S.org || msgChannel) return;
  msgChannel = sb.channel('msgs-'+S.org.id)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages', filter:`org_id=eq.${S.org.id}` }, payload=>{
      const m=payload.new; if(!m || S.messages.some(x=>x.id===m.id)) return;
      S.messages.push(msgFromRow(m));
      if(S.route==='team'){ renderTeam(); }
      else { S.unread=(S.unread||0)+1; const el=document.querySelector('[data-route="team"]'); if(el){ let b=el.querySelector('.nav-badge'); if(!b){ b=document.createElement('span'); b.className='nav-badge'; b.style.background='rgba(16,185,129,.22)'; b.style.color='#6EE7B7'; el.appendChild(b);} b.textContent=S.unread; } }
    })
    .subscribe();
}
let teamPoll=null;
function startTeamPoll(){
  if(teamPoll) clearInterval(teamPoll);
  teamPoll=setInterval(async()=>{
    if(S.route!=='team'){ clearInterval(teamPoll); teamPoll=null; return; }
    const before=S.messages.length?S.messages[S.messages.length-1].id:null;
    await loadMessages();
    const after=S.messages.length?S.messages[S.messages.length-1].id:null;
    if(before!==after) renderTeam();
  }, 15000);
}

/* =====================================================================
   NOTIFICAÇÕES PUSH (Web Push — chega na tela do celular mesmo fechado)
===================================================================== */
const VAPID_PUB = (window.IGP_CONFIG && IGP_CONFIG.VAPID_PUBLIC_KEY) || '';
let swReg = null;
function pushSupported(){ return typeof navigator!=='undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!VAPID_PUB; }
function pushPerm(){ return (typeof Notification!=='undefined') ? Notification.permission : 'unsupported'; }
function urlB64ToUint8(b64){ const pad='='.repeat((4-b64.length%4)%4); const s=(b64+pad).replace(/-/g,'+').replace(/_/g,'/'); const raw=atob(s); return Uint8Array.from([...raw].map(c=>c.charCodeAt(0))); }
async function registerSW(){ if(!pushSupported()) return null; if(swReg&&swReg.active) return swReg; try{ await navigator.serviceWorker.register('sw.js'); swReg=await navigator.serviceWorker.ready; return swReg; }catch(e){ console.warn('SW:',e); return null; } }
async function ensurePushSubscription(){
  if(!pushSupported() || pushPerm()!=='granted' || !S.org) return;
  const reg=await registerSW(); if(!reg) return;
  try{
    let sub=await reg.pushManager.getSubscription();
    if(!sub) sub=await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlB64ToUint8(VAPID_PUB) });
    const j=sub.toJSON();
    await sb.from('push_subscriptions').upsert({ endpoint:sub.endpoint, p256dh:j.keys.p256dh, auth:j.keys.auth, user_agent:navigator.userAgent, org_id:S.org.id }, { onConflict:'endpoint' });
  }catch(e){ console.warn('push sub:',e); }
}
async function enablePush(){
  if(!pushSupported()){ toast('Este navegador não suporta notificações push. No iPhone, adicione o site à Tela de Início primeiro.','warn'); return; }
  let perm=pushPerm();
  if(perm!=='granted') perm=await Notification.requestPermission();
  if(perm!=='granted'){ toast('Permissão de notificação negada','warn'); if(S.route==='settings') renderShell(); return; }
  await ensurePushSubscription();
  toast('Notificações ativadas neste aparelho ✓','success');
  if(S.route==='settings') renderShell();
}
async function disablePush(){
  try{ const reg=await registerSW(); const sub=reg&&await reg.pushManager.getSubscription(); if(sub){ await sb.from('push_subscriptions').delete().eq('endpoint',sub.endpoint); await sub.unsubscribe(); } }catch(e){ console.warn(e); }
  toast('Notificações desativadas neste aparelho','info');
  if(S.route==='settings') renderShell();
}
// Dispara push para a equipe (a Edge Function exclui automaticamente quem chamou). Falha em silêncio.
async function pushNotify(payload){ try{ await sb.functions.invoke('notify',{ body:payload }); }catch(e){ console.warn('notify:',e); } }
// Lead virou "Enviou Contato" → avisa a equipe.
function notifyLeadContato(lead){
  if(!lead) return;
  const who = lead.name || (lead.username?('@'+lead.username):'') || 'Um lead';
  const at  = lead.username ? ` (@${lead.username})` : '';
  pushNotify({ title:'📲 Lead enviou contato!', body:`${who}${at} enviou o contato. Bora atender!`, url:'/', tag:'contato' });
}
window.enablePush=enablePush; window.disablePush=disablePush;

/* =====================================================================
   SELETOR DE EQUIPES — mesmo login pode pertencer a várias organizações
===================================================================== */
async function renderOrgSwitcher(){
  openModal(`<div class="modal-ov"><div class="modal-box" style="max-width:420px"><div class="modal-hd"><div><div class="modal-title">Minhas equipes</div><div class="modal-sub">Troque de equipe ou crie/entre em outra</div></div><div class="x"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div></div>
    <div class="modal-bd"><div id="org-sw-list" style="display:flex;flex-direction:column;gap:8px"><div style="font-size:.8rem;color:var(--t3)">Carregando…</div></div></div>
    <div class="modal-ft"><button class="btn btn-outline" onclick="closeModal()">Fechar</button><button class="btn btn-primary" id="org-sw-add">+ Criar ou entrar em outra equipe</button></div></div></div>`);
  $('org-sw-add').onclick=()=>{ closeModal(); renderOnboard(); };
  const { data:orgs, error }=await sb.rpc('my_orgs');
  if(!$('org-sw-list')) return; // modal já foi fechado
  if(error){ $('org-sw-list').innerHTML=`<div style="font-size:.8rem;color:#EF4444">${esc(error.message)}</div>`; return; }
  $('org-sw-list').innerHTML=(orgs||[]).map(o=>`
    <button class="btn ${o.is_current?'btn-primary':'btn-outline'}" data-org="${esc(o.id)}" style="justify-content:space-between;display:flex;align-items:center" ${o.is_current?'disabled':''}>
      <span>${esc(o.name)}</span><span style="font-size:.68rem;opacity:.75">${o.is_current?'atual':(o.role==='owner'?'dono(a)':'membro')}</span>
    </button>`).join('') || '<div style="font-size:.8rem;color:var(--t3)">Nenhuma equipe encontrada.</div>';
  $('org-sw-list').querySelectorAll('[data-org]').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    const { error }=await sb.rpc('switch_org',{ p_org_id:b.dataset.org });
    if(error){ toast(error.message,'error'); b.disabled=false; return; }
    closeModal(); toast('Equipe trocada','success'); await boot();
  });
}

/* =====================================================================
   SETTINGS
===================================================================== */
// Editor genérico de lista de etapas (funil de lead, negociação ou desfechos de
// ligação) — reordenar, renomear, recolorir, adicionar e remover. Usado só pelo
// dono (a UI que chama isto já checa owner antes de exibir o botão "Editar").
function stageEditorModal(title, stages, save){
  let list=(stages&&stages.length?stages:[]).map(s=>({...s}));
  const render=()=>{
    const rows=list.length?list.map((s,i)=>`<div class="stg-row" data-i="${i}" style="gap:8px;align-items:center">
      <input type="color" class="se-color" data-i="${i}" value="${s.color||'#6366F1'}" style="width:32px;height:32px;border:none;background:none;cursor:pointer;padding:0">
      <input class="stg-input se-label" data-i="${i}" value="${esc(s.label)}" style="flex:1">
      <button class="act-btn" data-up="${i}" ${i===0?'disabled':''} title="Subir">↑</button>
      <button class="act-btn" data-down="${i}" ${i===list.length-1?'disabled':''} title="Descer">↓</button>
      <button class="act-btn act-del" data-rm="${i}" title="Remover">✕</button>
    </div>`).join(''):'<div class="empty-sub">Nenhuma etapa ainda.</div>';
    openModal(`<div class="modal-ov"><div class="modal-box"><div class="modal-hd"><div class="modal-title">${esc(title)}</div><div class="x"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div></div>
      <div class="modal-bd"><div style="display:flex;flex-direction:column;gap:8px">${rows}</div>
      <button class="btn btn-outline btn-sm" id="se-add" style="margin-top:12px">+ Adicionar etapa</button>
      </div>
      <div class="modal-ft"><button class="btn btn-outline" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" id="se-save">Salvar</button></div>
      </div></div>`);
    document.querySelectorAll('.se-label').forEach(inp=>inp.oninput=e=>{ list[+e.target.dataset.i].label=e.target.value; });
    document.querySelectorAll('.se-color').forEach(inp=>inp.oninput=e=>{ list[+e.target.dataset.i].color=e.target.value; });
    document.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.up; [list[i-1],list[i]]=[list[i],list[i-1]]; render(); });
    document.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.down; [list[i+1],list[i]]=[list[i],list[i+1]]; render(); });
    document.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{ list.splice(+b.dataset.rm,1); render(); });
    $('se-add').onclick=()=>{ const label=(prompt('Nome da nova etapa:')||'').trim(); if(!label) return; list.push({key:slugify(label)+'_'+Math.random().toString(36).slice(2,6),label,short:label,color:'#6366F1'}); render(); };
    $('se-save').onclick=async()=>{ $('se-save').disabled=true; list.forEach((s,i)=>{ s.order=i; s.short=s.short||s.label; }); const ok=await save(list); if(ok!==false) closeModal(); else $('se-save').disabled=false; };
  };
  render();
}

function renderSettings(){
  const owner=S.profile&&S.profile.org_role==='owner';
  const curTheme=currentTheme();
  $('content').innerHTML=`<div class="stg">
    <div class="stg-card"><div class="stg-hd"><div class="stg-hd-ico" style="background:rgba(99,102,241,.14)"><svg viewBox="0 0 24 24" fill="none" stroke="#A5B4FC" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div><div><div class="st-title">Seu espaço</div><div class="st-sub">${esc(S.org&&S.org.name||'—')} · você é ${owner?'dono(a)':'membro'}</div></div></div>
      <div class="stg-bd"><div class="stg-row"><div class="stg-ri"><div class="stg-ri-t">Código de convite</div><div class="stg-ri-s">Passe para um colega entrar no mesmo espaço</div></div><span class="code-pill">${esc(S.org&&S.org.join_code||'—')}</span></div>
        <div class="stg-row"><div class="stg-ri"><div class="stg-ri-t">Módulo de profissão</div><div class="stg-ri-s">${MOD().icon} ${esc(MOD().name)} · define funil, termos e campos usados no sistema</div></div>${owner?`<select class="stg-input" id="st-module" style="max-width:200px">${(window.IGP_MODULE_ORDER||[]).map(id=>`<option value="${id}" ${id===MOD().id?'selected':''}>${window.IGP_MODULES[id].icon} ${window.IGP_MODULES[id].name}</option>`).join('')}</select>`:''}</div></div></div>
    ${owner?`<div class="stg-card"><div class="stg-hd"><div class="stg-hd-ico" style="background:rgba(99,102,241,.14)"><svg viewBox="0 0 24 24" fill="none" stroke="#A5B4FC" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div><div><div class="st-title">Equipe</div><div class="st-sub">Só donos podem remover membros ou promover outros donos</div></div></div>
      <div class="stg-bd">
        ${S.members.map(m=>{
          const isMe=m.id===S.session.user.id, isOwner=m.org_role==='owner';
          return `<div class="stg-row"><div class="stg-ri"><div class="stg-ri-t">${esc(m.name||m.email||'—')}${isMe?' <span class="tag">você</span>':''}${isOwner?' <span class="tag" style="color:#FCD34D;background:rgba(245,158,11,.14);border-color:rgba(245,158,11,.3)">dono</span>':''}</div><div class="stg-ri-s">${esc(m.email||'')}</div></div>
            <div class="tbl-acts" style="opacity:1">${(!isOwner)?`<button class="act-btn" data-promote="${esc(m.id)}">★ Tornar dono</button>`:''}${(!isMe)?`<button class="act-btn act-del" data-remove="${esc(m.id)}">Remover</button>`:''}</div></div>`;
        }).join('')||'<div class="empty-sub">Nenhum outro membro ainda.</div>'}
      </div></div>`:''}
    <div class="stg-card"><div class="stg-hd"><div class="stg-hd-ico" style="background:rgba(139,92,246,.14)"><svg viewBox="0 0 24 24" fill="none" stroke="#C084FC" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg></div><div><div class="st-title">Aparência</div><div class="st-sub">Tema do sistema · salvo neste aparelho</div></div></div>
      <div class="stg-bd"><div class="theme-seg">
        <button class="theme-opt${curTheme==='dark'?' active':''}" data-theme-set="dark"><span class="theme-prev tp-dark"><i></i><b></b></span><span>Escuro</span></button>
        <button class="theme-opt${curTheme==='light'?' active':''}" data-theme-set="light"><span class="theme-prev tp-light"><i></i><b></b></span><span>Claro</span></button>
      </div></div></div>
    ${(()=>{ const perm=pushPerm(); const sup=pushSupported(); const on=perm==='granted';
      const statusTxt = !sup ? 'Não disponível neste navegador' : perm==='granted' ? 'Ativadas neste aparelho ✓' : perm==='denied' ? 'Bloqueadas — libere nas configurações do navegador' : 'Desativadas neste aparelho';
      const btn = !sup ? '' : on ? `<button class="btn btn-outline btn-sm" id="st-push-off">Desativar</button>` : perm==='denied' ? '' : `<button class="btn btn-primary btn-sm" id="st-push-on">Ativar notificações</button>`;
      const iosHint = `<div style="font-size:.72rem;color:var(--t2);margin-top:8px;padding:9px 11px;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.2);border-radius:8px">📱 <b>No iPhone:</b> abra o site no Safari, toque em Compartilhar → <b>Adicionar à Tela de Início</b>, abra pelo ícone novo e então ative as notificações. Sem isso o iOS não entrega push.</div>`;
      return `<div class="stg-card"><div class="stg-hd"><div class="stg-hd-ico" style="background:rgba(244,114,182,.14)"><svg viewBox="0 0 24 24" fill="none" stroke="#F472B6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div><div><div class="st-title">Notificações</div><div class="st-sub">Avisa a equipe quando um lead envia contato ou chega mensagem nova</div></div></div>
        <div class="stg-bd"><div class="stg-row"><div class="stg-ri"><div class="stg-ri-t">Notificações neste aparelho</div><div class="stg-ri-s">${statusTxt}</div></div>${btn}</div>${iosHint}</div></div>`;
    })()}
    <div class="stg-card"><div class="stg-hd"><div class="stg-hd-ico" style="background:rgba(16,185,129,.12)"><svg viewBox="0 0 24 24" fill="none" stroke="#6EE7B7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></div><div><div class="st-title">Integração Agendor</div><div class="st-sub">Envia leads e ligações ao CRM · compartilhada no espaço</div></div></div>
      <div class="stg-bd">
      ${!owner?`<div class="stg-row"><div class="stg-ri"><div class="stg-ri-t">Status</div><div class="stg-ri-s">${agendorOn()?'☁ Conectado ao Agendor':'Não configurado'}</div></div></div><div class="stg-ri-s">Só o dono da equipe pode editar a integração com o Agendor.</div>`:`
        <div class="stg-field"><label class="stg-label">Token da API</label><input class="stg-input" type="password" id="st-token" value="${esc(S.org&&S.org.agendor_token||'')}" placeholder="Cole o token"></div>
        <div class="stg-row"><div class="stg-ri"><div class="stg-ri-t">Envio automático</div><div class="stg-ri-s">Ao chegar na última etapa de um funil, envia sozinho ao Agendor</div></div><label style="cursor:pointer"><input type="checkbox" id="st-auto" ${agendorAutoOn()?'checked':''} style="width:20px;height:20px;cursor:pointer;accent-color:#10B981"></label></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" id="st-save">Salvar integração</button><button class="btn btn-outline" id="ag-test">Testar conexão</button></div>
        <div style="height:1px;background:rgba(255,255,255,.06);margin:4px 0"></div>
        <div class="stg-ri-t">Roteamento por funil</div>
        <div class="stg-ri-s" style="margin-bottom:8px">Cada funil de lead (aba Personalização) pode apontar para um funil/etapa diferente do Agendor.</div>
        <button class="btn btn-outline btn-sm" id="ag-load-funnels" style="align-self:flex-start">↻ Carregar funis do Agendor</button>
        ${S.pipelines.map(p=>{ const cv=p.agendor_map?`${p.agendor_map.funnelId}:${p.agendor_map.stageId}`:''; const opts=`<option value="">— selecione —</option>`+S._funnelStages.map(f=>{ const v=`${f.funnelId}:${f.stageId}`; return `<option value="${v}" ${v===cv?'selected':''}>${esc(f.funnelName)} · ${esc(f.stageName)}</option>`; }).join(''); return S._funnelStages.length?`<div class="stg-field"><label class="stg-label">${esc(p.icon||'')} ${esc(p.name)} →</label><select class="stg-input ag-map-pl" data-pl="${p.id}">${opts}</select></div>`:`<div class="stg-ri-s">${esc(p.icon||'')} ${esc(p.name)} → ${p.agendor_map?esc(p.agendor_map.funnelName+' · '+p.agendor_map.stageName):'não definido'}</div>`; }).join('')}
        ${S._funnelStages.length?`<button class="btn btn-primary btn-sm" id="ag-save-map" style="align-self:flex-start">Salvar mapeamento</button>`:''}
        <div style="font-size:.72rem;color:var(--t2);margin-top:6px;padding:9px 11px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:8px">⚠️ O navegador bloqueia chamadas diretas à API do Agendor (CORS) — por isso o envio passa por um proxy (Cloudflare Worker) já configurado no sistema.</div>
      `}
      </div></div>
    ${owner?`<div class="stg-card"><div class="stg-hd"><div class="stg-hd-ico" style="background:rgba(99,102,241,.14)"><svg viewBox="0 0 24 24" fill="none" stroke="#A5B4FC" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div><div><div class="st-title">Personalização</div><div class="st-sub">Funis, nichos, negociações e ligações do seu jeito · só o dono edita</div></div></div>
      <div class="stg-bd">
        <div class="stg-ri-t">Funis de Lead</div>
        <div class="stg-ri-s" style="margin-bottom:8px">Cada funil tem suas próprias etapas. Leads pertencem a um funil (ex.: "Instagram", "Empresários", "Indicação").</div>
        ${S.pipelines.map(p=>`<div class="stg-row" data-pl="${p.id}"><div class="stg-ri"><div class="stg-ri-t">${esc(p.icon||'')} ${esc(p.name)}${p.is_default?' <span class="tag">padrão</span>':''}</div><div class="stg-ri-s">${STS(p).length} etapa(s)</div></div><div class="tbl-acts">${!p.is_default?`<button class="act-btn" data-pl-default="${p.id}">★ Tornar padrão</button>`:''}<button class="act-btn" data-pl-edit="${p.id}">Editar etapas</button><button class="act-btn" data-pl-rename="${p.id}">Renomear</button><button class="act-btn act-del" data-pl-del="${p.id}">Excluir</button></div></div>`).join('')||'<div class="empty-sub">Nenhum funil ainda.</div>'}
        <button class="btn btn-outline btn-sm" id="pl-add" style="align-self:flex-start;margin-top:6px">+ Novo funil</button>
        <div style="height:1px;background:rgba(255,255,255,.06);margin:10px 0"></div>
        <div class="stg-ri-t">Nichos</div>
        <div class="stg-ri-s" style="margin-bottom:8px">Lista fechada — a equipe escolhe entre estas opções ao cadastrar um lead.</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${S.niches.map(n=>`<span class="tag" data-niche="${n.id}" style="cursor:pointer" title="Remover">${esc(n.name)} ✕</span>`).join('')||'<span class="empty-sub">Nenhum nicho cadastrado.</span>'}</div>
        <div style="display:flex;gap:8px"><input class="stg-input" id="niche-add-inp" placeholder="Novo nicho… (Enter para adicionar)" style="flex:1;max-width:280px"><button class="btn btn-outline btn-sm" id="niche-add-btn">Adicionar</button></div>
        <div style="height:1px;background:rgba(255,255,255,.06);margin:10px 0"></div>
        <div class="stg-row"><div class="stg-ri"><div class="stg-ri-t">Etapas de Negociação</div><div class="stg-ri-s">${DEAL_STS().length} etapa(s) · usadas na aba Negociações</div></div><button class="btn btn-outline btn-sm" id="deal-stages-edit">Editar</button></div>
        <div class="stg-row"><div class="stg-ri"><div class="stg-ri-t">Desfechos de Ligação</div><div class="stg-ri-s">${CALL_OUT().length} opção(ões) · usadas na aba Ligações</div></div><button class="btn btn-outline btn-sm" id="call-out-edit">Editar</button></div>
      </div></div>`:''}
    <div class="stg-card"><div class="stg-hd"><div class="stg-hd-ico" style="background:rgba(236,72,153,.14)"><svg viewBox="0 0 24 24" fill="none" stroke="#F472B6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div><div><div class="st-title">Extensão do Instagram</div><div class="st-sub">Detecta perfis e adiciona leads direto do Instagram para o seu espaço</div></div></div>
      <div class="stg-bd">
        <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn btn-primary" href="igprospect-extension.zip" download>⬇ Baixar extensão</a></div>
        <div style="font-size:.8rem;color:var(--t2);margin-top:10px;padding:11px 13px;background:rgba(236,72,153,.08);border:1px solid rgba(236,72,153,.2);border-radius:8px;line-height:1.6">
          <b>Como instalar (Chrome/Edge):</b><br>
          1. Baixe e descompacte o arquivo .zip<br>
          2. Acesse <code>chrome://extensions</code><br>
          3. Ative o <b>Modo do desenvolvedor</b> (canto superior direito)<br>
          4. Clique em <b>Carregar sem compactação</b> e selecione a pasta descompactada<br>
          5. Abra o Instagram — a extensão já aparece nos perfis
        </div>
      </div></div>
    <div class="stg-card"><div class="stg-hd"><div class="stg-hd-ico" style="background:rgba(139,92,246,.14)"><svg viewBox="0 0 24 24" fill="none" stroke="#C084FC" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div><div class="st-title">Conta</div><div class="st-sub">${esc(S.profile&&S.profile.email||'')}</div></div></div>
      <div class="stg-bd">
        <div class="stg-field"><label class="stg-label">Seu nome de usuário</label><input class="stg-input" id="st-name" value="${esc(S.profile&&S.profile.name||'')}" placeholder="Como você quer aparecer" maxlength="60" style="max-width:340px"></div>
        <div class="stg-ri-s" style="margin-bottom:10px">É assim que seu nome aparece para a equipe (recados, lista de membros, etc.).</div>
        <div class="stg-row"><div class="stg-ri"><div class="stg-ri-t">${S.leads.length} leads · ${S.calls.length} ligações neste espaço</div></div><div class="tbl-acts" style="opacity:1"><button class="btn btn-primary btn-sm" id="st-name-save">Salvar nome</button><button class="btn btn-outline btn-sm" id="st-logout">Sair</button></div></div>
      </div></div>
  </div>`;
  $('st-save')&&($('st-save').onclick=async()=>{ const settings={ ...(S.org.settings||{}), agendorAuto: $('st-auto')?$('st-auto').checked:true }; const patch={ agendor_token:$('st-token').value.trim(), settings }; const{error}=await sb.from('orgs').update(patch).eq('id',S.org.id); if(error){toast(error.message,'error');return;} S.org={...S.org,...patch}; toast('Integração salva','success'); });
  $('ag-test')&&($('ag-test').onclick=testAgendor);
  $('ag-load-funnels')&&($('ag-load-funnels').onclick=loadAgendorFunnels);
  $('ag-save-map')&&($('ag-save-map').onclick=async()=>{
    const parse=v=>{ if(!v) return null; const [fid,sid]=v.split(':'); const f=S._funnelStages.find(x=>String(x.funnelId)===fid&&String(x.stageId)===sid); return f?{funnelId:f.funnelId,stageId:f.stageId,funnelName:f.funnelName,stageName:f.stageName}:null; };
    const sels=[...document.querySelectorAll('.ag-map-pl')];
    for(const sel of sels){ const agendor_map=parse(sel.value); const{error}=await sb.from('org_pipelines').update({agendor_map}).eq('id',sel.dataset.pl); if(error){toast(error.message,'error');return;} }
    await loadPipelines(); toast('Mapeamento salvo ✓','success'); renderSettings();
  });
  $('st-module')&&($('st-module').onchange=async e=>{
    const module_id=e.target.value;
    const{error}=await sb.from('orgs').update({module_id}).eq('id',S.org.id);
    if(error){toast(error.message,'error');return;}
    S.org={...S.org,module_id}; toast('Módulo atualizado','success'); renderShell();
  });
  // ---- Personalização (owner-only) ----
  $('pl-add')&&($('pl-add').onclick=async()=>{
    const name=(prompt('Nome do novo funil (ex.: "Indicação"):')||'').trim(); if(!name) return;
    const order_idx=S.pipelines.length;
    const stages=[{key:'novo',label:'Novo',short:'Novo',color:'#64748B',order:0},{key:'concluido',label:'Concluído',short:'Concluído',color:'#10B981',order:1}];
    const{error}=await sb.from('org_pipelines').insert({org_id:S.org.id,name,icon:'📋',order_idx,stages});
    if(error){toast(error.message,'error');return;} await loadPipelines(); toast('Funil criado','success'); renderSettings();
  });
  document.querySelectorAll('[data-pl-edit]').forEach(b=>b.onclick=()=>{
    const p=S.pipelines.find(x=>x.id===b.dataset.plEdit); if(!p)return;
    stageEditorModal(`Etapas do funil "${p.name}"`, STS(p).length?stagesOf(p):[], async list=>{
      const{error}=await sb.from('org_pipelines').update({stages:list}).eq('id',p.id);
      if(error){toast(error.message,'error');return false;} await loadPipelines(); toast('Etapas salvas','success'); renderShell(); return true;
    });
  });
  document.querySelectorAll('[data-pl-rename]').forEach(b=>b.onclick=async()=>{
    const p=S.pipelines.find(x=>x.id===b.dataset.plRename); if(!p)return;
    const name=(prompt('Novo nome do funil:',p.name)||'').trim(); if(!name||name===p.name) return;
    const{error}=await sb.from('org_pipelines').update({name}).eq('id',p.id);
    if(error){toast(error.message,'error');return;} await loadPipelines(); renderSettings();
  });
  document.querySelectorAll('[data-pl-default]').forEach(b=>b.onclick=async()=>{
    const id=b.dataset.plDefault;
    await sb.from('org_pipelines').update({is_default:false}).eq('org_id',S.org.id);
    const{error}=await sb.from('org_pipelines').update({is_default:true}).eq('id',id);
    if(error){toast(error.message,'error');return;} await loadPipelines(); toast('Funil padrão atualizado','success'); renderSettings();
  });
  document.querySelectorAll('[data-pl-del]').forEach(b=>b.onclick=async()=>{
    const p=S.pipelines.find(x=>x.id===b.dataset.plDel); if(!p)return;
    if(S.pipelines.length<=1){ toast('Mantenha ao menos um funil','warn'); return; }
    if(S.leads.some(l=>l.pipeline_id===p.id)){ toast('Mova os leads deste funil antes de excluí-lo','warn'); return; }
    if(!confirm(`Excluir o funil "${p.name}"?`)) return;
    const{error}=await sb.from('org_pipelines').delete().eq('id',p.id);
    if(error){toast(error.message,'error');return;} await loadPipelines(); toast('Funil excluído','success'); renderSettings();
  });
  const addNiche=async()=>{
    const name=($('niche-add-inp').value||'').trim(); if(!name) return;
    const order_idx=S.niches.length;
    const{error}=await sb.from('org_niches').insert({org_id:S.org.id,name,order_idx});
    if(error){toast(error.message,'error');return;} await loadNiches(); renderSettings();
  };
  $('niche-add-btn')&&($('niche-add-btn').onclick=addNiche);
  $('niche-add-inp')&&($('niche-add-inp').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); addNiche(); } }));
  document.querySelectorAll('[data-niche]').forEach(el=>el.onclick=async()=>{
    const{error}=await sb.from('org_niches').delete().eq('id',el.dataset.niche);
    if(error){toast(error.message,'error');return;} await loadNiches(); renderSettings();
  });
  $('deal-stages-edit')&&($('deal-stages-edit').onclick=()=>{
    stageEditorModal('Etapas de Negociação', dealStagesRaw(), async list=>{
      const won=list.some(s=>s.key===WON())?WON():list[list.length-1].key;
      const lost=list.some(s=>s.key===LOST())?LOST():null;
      const{error}=await sb.from('org_deal_stages').upsert({org_id:S.org.id,stages:list,won_stage:won,lost_stage:lost,card_types:CARD_TYPES()},{onConflict:'org_id'});
      if(error){toast(error.message,'error');return false;} await loadDealStagesCfg(); toast('Etapas salvas','success'); renderShell(); return true;
    });
  });
  $('call-out-edit')&&($('call-out-edit').onclick=()=>{
    stageEditorModal('Desfechos de Ligação', callOutcomesRaw(), async list=>{
      const{error}=await sb.from('org_call_outcomes').upsert({org_id:S.org.id,outcomes:list},{onConflict:'org_id'});
      if(error){toast(error.message,'error');return false;} await loadCallOutcomesCfg(); toast('Desfechos salvos','success'); renderShell(); return true;
    });
  });
  $('st-logout').onclick=igpLogout;
  $('st-name-save')&&($('st-name-save').onclick=async()=>{
    const name=$('st-name').value.trim();
    if(!name){ toast('Digite um nome','error'); return; }
    const{error}=await sb.from('profiles').update({name}).eq('id',S.session.user.id);
    if(error){toast(error.message,'error');return;}
    S.profile={...S.profile,name};
    const mi=S.members.findIndex(m=>m.id===S.session.user.id); if(mi>=0) S.members[mi]={...S.members[mi],name};
    toast('Nome atualizado','success'); renderShell();
  });
  $('st-push-on')&&($('st-push-on').onclick=enablePush);
  $('st-push-off')&&($('st-push-off').onclick=disablePush);
  document.querySelectorAll('[data-theme-set]').forEach(b=>b.onclick=()=>setTheme(b.dataset.themeSet));
  // ---- Equipe (owner-only): promover a dono / remover membro ----
  document.querySelectorAll('[data-promote]').forEach(b=>b.onclick=async()=>{
    const m=S.members.find(x=>x.id===b.dataset.promote); if(!m)return;
    if(!confirm(`Tornar ${m.name||m.email} dono também da equipe?`)) return;
    b.disabled=true;
    const{error}=await sb.rpc('promote_team_member',{p_user_id:m.id});
    if(error){ toast(error.message,'error'); b.disabled=false; return; }
    m.org_role='owner'; toast('Membro promovido a dono!','success'); renderSettings();
  });
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{
    const m=S.members.find(x=>x.id===b.dataset.remove); if(!m)return;
    openModal(`<div class="modal-ov"><div class="modal-box" style="max-width:430px"><div class="modal-hd"><div><div class="modal-title">Remover ${esc(m.name||m.email||'membro')}</div><div class="modal-sub">Ação permanente</div></div><div class="x"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div></div><div class="modal-bd"><p class="confirm-txt">Tem certeza que deseja remover <b>${esc(m.name||m.email||'este membro')}</b> da equipe? Ela(e) perde o acesso a este espaço imediatamente, mas os leads/vendas já cadastrados por ela(e) continuam aqui.</p></div><div class="modal-ft"><button class="btn btn-outline" onclick="closeModal()">Cancelar</button><button class="btn btn-danger" id="rm-ok">Remover</button></div></div></div>`);
    $('rm-ok').onclick=async()=>{
      $('rm-ok').disabled=true;
      const{error}=await sb.rpc('remove_team_member',{p_user_id:m.id});
      if(error){ toast(error.message,'error'); $('rm-ok').disabled=false; return; }
      S.members=S.members.filter(x=>x.id!==m.id); closeModal(); toast('Membro removido da equipe','success'); renderSettings();
    };
  });
}

/* =====================================================================
   ADMIN
===================================================================== */
async function renderAdmin(){
  $('content').innerHTML=`<div class="sec-title">Painel Administrativo</div><div class="sec-sub">Espaços e usuários da plataforma.</div><div id="adm">Carregando…</div>`;
  const { data:orgs, error:e1 }=await sb.rpc('admin_orgs');
  const { data:users, error:e2 }=await sb.rpc('admin_users');
  if(e1||e2){ $('adm').innerHTML=`<div class="empty-state"><div class="empty-title">Erro</div><div class="empty-sub">${esc((e1||e2).message)}</div></div>`; return; }
  const orgRows=(orgs||[]).map(o=>`<tr data-s="${esc(((o.name||'')+' '+(o.join_code||'')).toLowerCase())}"><td><b>${esc(o.name)}</b></td><td>${o.members}</td><td>${o.leads}</td><td>${o.calls}</td><td><span class="tag">${esc(o.join_code)}</span></td><td><div class="tbl-acts"><button class="act-btn" data-featorg="${o.id}" data-featname="${esc(o.name)}">Módulos</button><button class="act-btn act-del" data-delorg="${o.id}">Excluir</button></div></td></tr>`).join('')||'<tr><td colspan="6"><div class="empty-state"><div class="empty-sub">Nenhum espaço</div></div></td></tr>';
  const userRows=(users||[]).map(u=>`<tr data-s="${esc(((u.name||'')+' '+(u.email||'')+' '+(u.org_name||'')).toLowerCase())}"><td><div class="lead-nm">${esc(u.name||'—')}</div><div class="lead-un">${esc(u.email||'')}</div></td><td>${esc(u.org_name||'—')}</td><td>${esc(u.org_role||'')}</td><td><span class="badge ${u.status==='active'?'b-contato':u.status==='pending'?'b-novo':'b-respondeu'}">${u.status}</span></td><td><div class="tbl-acts">${u.platform_role==='admin'?'<span class="tag">admin</span>':`<button class="act-btn" data-block="${u.id}" data-st="${u.status}">${u.status==='pending'?'Aprovar':u.status==='active'?'Bloquear':'Liberar'}</button><button class="act-btn act-del" data-deluser="${u.id}">Excluir</button>`}</div></td></tr>`).join('');
  const searchBox=(id,ph,val)=>`<div class="search-wrap" style="flex:0 1 240px;min-width:140px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input class="search-inp" id="${id}" placeholder="${ph}" value="${esc(val||'')}"></div>`;
  $('adm').innerHTML=`<div class="card" style="margin-bottom:16px"><div class="res-bar"><span><strong>${(orgs||[]).length}</strong> espaços</span>${searchBox('adm-org-q','Buscar espaço…',S.admOrgQ)}</div><table class="data-tbl" id="adm-orgs"><thead><tr><th>Espaço</th><th>Membros</th><th>Leads</th><th>Ligações</th><th>Código</th><th></th></tr></thead><tbody>${orgRows}</tbody></table></div>
    <div class="card"><div class="res-bar"><span><strong>${(users||[]).length}</strong> usuários</span>${searchBox('adm-user-q','Buscar usuário…',S.admUserQ)}</div><table class="data-tbl" id="adm-users"><thead><tr><th>Usuário</th><th>Espaço</th><th>Papel</th><th>Status</th><th></th></tr></thead><tbody>${userRows}</tbody></table></div>
    <div id="adm-feat"></div>`;
  $('adm').querySelectorAll('[data-block]').forEach(b=>b.onclick=async()=>{ const ns=b.dataset.st==='active'?'blocked':'active'; const{error}=await sb.from('profiles').update({status:ns}).eq('id',b.dataset.block); if(error){toast(error.message,'error');return;} toast('Usuário '+(ns==='blocked'?'bloqueado':'liberado'),'success'); renderAdmin(); });
  $('adm').querySelectorAll('[data-delorg]').forEach(b=>b.onclick=async()=>{ if(!confirm('Excluir este espaço permanentemente? Todos os leads, ligações, negociações e mensagens da equipe serão apagados. Esta ação não pode ser desfeita.'))return; const{error}=await sb.rpc('admin_delete_org',{p_org_id:b.dataset.delorg}); if(error){toast(error.message,'error');return;} toast('Espaço excluído','success'); renderAdmin(); });
  $('adm').querySelectorAll('[data-featorg]').forEach(b=>b.onclick=()=>renderOrgFeatures(b.dataset.featorg, b.dataset.featname));
  $('adm').querySelectorAll('[data-deluser]').forEach(b=>b.onclick=async()=>{ if(!confirm('Excluir este usuário permanentemente? A conta e o acesso dele serão removidos (leads e ligações que ele criou permanecem na equipe). Esta ação não pode ser desfeita.'))return; const{error}=await sb.rpc('admin_delete_user',{p_user_id:b.dataset.deluser}); if(error){toast(error.message,'error');return;} toast('Usuário excluído','success'); renderAdmin(); });
  const admFilter=(inp,tbl)=>{ const q=($(inp).value||'').toLowerCase().trim(); $(tbl).querySelectorAll('tbody tr[data-s]').forEach(tr=>{ tr.style.display=(!q||tr.dataset.s.includes(q))?'':'none'; }); };
  $('adm-org-q').oninput=e=>{ S.admOrgQ=e.target.value; admFilter('adm-org-q','adm-orgs'); };
  $('adm-user-q').oninput=e=>{ S.admUserQ=e.target.value; admFilter('adm-user-q','adm-users'); };
  admFilter('adm-org-q','adm-orgs'); admFilter('adm-user-q','adm-users');
}

// Painel de módulos liberados para UMA equipe (abre abaixo das tabelas).
async function renderOrgFeatures(orgId, orgName){
  const box=$('adm-feat'); if(!box) return;
  box.innerHTML=`<div class="card" style="margin-top:16px"><div class="res-bar"><span>Módulos de <strong>${esc(orgName||'')}</strong></span></div><div id="adm-feat-list">Carregando…</div></div>`;
  box.scrollIntoView({behavior:'smooth',block:'nearest'});
  const { data:feats, error }=await sb.rpc('admin_org_features',{p_org_id:orgId});
  if(error){ $('adm-feat-list').innerHTML=`<div class="empty-state"><div class="empty-sub">${esc(error.message)}</div></div>`; return; }
  const rows=(feats||[]).map(f=>`<tr><td>${esc(f.label)}${f.is_override?'':' <span class="lead-un">(padrão)</span>'}</td><td><div class="tbl-acts"><button class="act-btn ${f.enabled?'act-del':''}" data-feattoggle="${esc(f.key)}" data-cur="${f.enabled?'1':'0'}">${f.enabled?'Desligar':'Ligar'}</button></div></td></tr>`).join('');
  $('adm-feat-list').innerHTML=`<table class="data-tbl"><thead><tr><th>Módulo / Aba</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  $('adm-feat-list').querySelectorAll('[data-feattoggle]').forEach(b=>b.onclick=async()=>{ const ns=b.dataset.cur!=='1'; const{error}=await sb.rpc('admin_set_org_feature',{p_org_id:orgId,p_key:b.dataset.feattoggle,p_enabled:ns}); if(error){toast(error.message,'error');return;} toast('Módulo '+(ns?'liberado':'ocultado')+' para '+orgName,'success'); renderOrgFeatures(orgId,orgName); });
}

/* =====================================================================
   PONTE COM A EXTENSÃO (sincroniza leads do Instagram → Supabase)
===================================================================== */
let bridgeBound=false, bridgeBusy=false, bridgePending=null;
function bindBridge(){
  if(bridgeBound) return; bridgeBound=true;
  window.addEventListener('message', ev=>{
    if(ev.source!==window) return;
    const d=ev.data; if(!d||d.source!=='igp-extension') return;
    if(d.type==='leads') importExtensionLeads(d.leads);
  });
  window.postMessage({ source:'igp-dashboard', type:'request-leads' }, '*');
}
async function importExtensionLeads(incoming){
  if(!Array.isArray(incoming) || !incoming.length || !S.org) return;
  if(bridgeBusy){ bridgePending=incoming; return; }   // já sincronizando → guarda o último e processa depois
  bridgeBusy=true;
  try{
    // Mapas para localizar leads já existentes (por id da extensão ou @usuário)
    const byExt=new Map(), byUser=new Map();
    S.leads.forEach(l=>{ if(l.extId) byExt.set(String(l.extId),l); const u=(l.username||'').toLowerCase(); if(u) byUser.set(u,l); });
    const rows=[]; let updated=0; const becameContato=[];
    for(const raw of incoming){
      if(!raw||(!raw.name&&!raw.username)) continue;
      const extId=String(raw.id||'');
      const uk=String(raw.username||'').toLowerCase();
      const existing=(extId&&byExt.get(extId)) || (uk&&byUser.get(uk)) || null;
      if(existing){
        // Lead já existe: atualiza status (se avançou) e telefone (se chegou um novo).
        // Resolve o caso de marcar "Enviou Contato" na extensão e não refletir aqui.
        const oldIdx=STS().indexOf(existing.status||'novo');
        const newIdx=STS().indexOf(raw.status||'novo');
        const patch={};
        if(newIdx>oldIdx) patch.status=raw.status;
        if(raw.phone && raw.phone!==(existing.phone||'')) patch.phone=raw.phone;
        // Corrige nome antigo que ficou igual ao @, ou corrompido com "(@outro)", quando a extensão manda o nome real
        const exU=(existing.username||'').toLowerCase(), exNclean=(existing.name||'').trim(), exN=exNclean.toLowerCase();
        const exForeign=exNclean.match(/\(@([A-Za-z0-9._]+)\)/);
        const exCorrupted=!!exForeign && exForeign[1].toLowerCase()!==exU;
        const nameIsHandle = !existing.name || exN===exU || exN==='@'+exU || exCorrupted;
        if(raw.name && raw.name.toLowerCase()!==uk && nameIsHandle && raw.name.trim()!==(existing.name||'')) patch.name=raw.name.trim();
        if(Object.keys(patch).length){
          const { error }=await sb.from('leads').update(patch).eq('id',existing.id);
          if(!error){ Object.assign(existing,patch); updated++; if(patch.status&&isLastStage(patch.status,leadPipeline(existing))) becameContato.push(existing.id); }
        }
        continue;
      }
      const notes=[ raw.mutualFriends?`Amigos em comum: ${raw.mutualFriends}`:'', raw.notes||'', raw.profileUrl?`Perfil: ${raw.profileUrl}`:'' ].filter(Boolean).join(' · ');
      // A extensão sempre fala o vocabulário fixo do funil padrão (novo/chamado/respondeu/contato) —
      // por isso todo lead vindo dela entra no pipeline is_default da org.
      const extPipeline=defaultPipeline();
      const extStatus=(extPipeline&&STS(extPipeline).includes(raw.status))?raw.status:(STS(extPipeline)[0]||'novo');
      const row={ name:raw.name||'', username:uk||'', phone:raw.phone||'', niche:raw.niche||'', status:extStatus, tipo:'comum', pipeline_id:extPipeline&&extPipeline.id, source:'extensao', ext_id:extId, added_at:raw.addedAt||new Date().toISOString(), notes };
      rows.push(row);
      if(extId) byExt.set(extId,row); if(uk) byUser.set(uk,row);
    }
    let changed=updated>0;
    if(rows.length){
      const { error }=await sb.from('leads').insert(rows);
      if(error){ console.warn('sync ext:',error.message); } else { changed=true; }
    }
    if(changed){
      await loadLeads(); await loadDeals();
      // garante negociação para todo lead que está em "contato" (novos ou atualizados)
      for(const l of S.leads){ if(isLastStage(l.status,leadPipeline(l))||l.tipo==='empresario') await ensureDealForLead(l.id); }
      renderShell();
      for(const cid of becameContato){ notifyLeadContato(S.leads.find(x=>x.id===cid)); }
      const parts=[];
      if(rows.length) parts.push(`${rows.length} novo(s)`);
      if(updated) parts.push(`${updated} atualizado(s)`);
      toast(`Extensão sincronizada: ${parts.join(' · ')}`,'success');
    }
  } finally {
    bridgeBusy=false;
    if(bridgePending){ const p=bridgePending; bridgePending=null; importExtensionLeads(p); }
  }
}

/* =====================================================================
   BOOT
===================================================================== */
async function boot(){
  if(!sb){ renderAuth(); return; }
  const { data:{ session } }=await sb.auth.getSession(); S.session=session;
  if(!session){ renderAuth(); return; }
  const { data:prof }=await sb.from('profiles').select('*').eq('id',session.user.id).single();
  S.profile=prof;
  if(prof&&prof.status==='blocked'){ $('app').classList.remove('show'); $('onboard').classList.add('hidden'); $('auth').classList.remove('hidden'); $('auth-card').innerHTML=`<div class="auth-h">Acesso bloqueado</div><div class="auth-sub">Fale com o administrador.</div><button class="btn-block" onclick="igpLogout()">Sair</button>`; return; }
  if(prof&&prof.status==='pending'){ $('app').classList.remove('show'); $('onboard').classList.add('hidden'); $('auth').classList.remove('hidden'); $('auth-card').innerHTML=`<div class="auth-h">Cadastro em análise</div><div class="auth-sub">Seu acesso está aguardando aprovação do administrador.</div><button class="btn-block" onclick="igpLogout()">Sair</button>`; return; }
  if(!prof||!prof.org_id){ renderOnboard(); return; }
  const { data:org }=await sb.from('orgs').select('*').eq('id',prof.org_id).single(); S.org=org;
  await loadFeatures();
  await loadOrgConfig(); await loadLeads(); await normalizeEmpresarios(); await loadCalls(); await loadDeals(); await backfillEmpresarioDeals(); await loadMessages(); await loadMembers(); await loadWeeklyPayments(); renderShell();
  bindBridge();
  subscribeMessages();
  ensurePushSubscription();   // re-inscreve este aparelho se já tem permissão
}
// Conserta empresários antigos que entraram com status de prospecção (chamado etc.) → "A Contatar".
// Roda uma vez; depois que todos estão normalizados vira no-op.
async function normalizeEmpresarios(){
  const bad=S.leads.filter(l=>l.tipo==='empresario' && STS().includes(l.status));
  if(!bad.length) return;
  const ids=bad.map(l=>l.id);
  for(let i=0;i<ids.length;i+=200){ const { error }=await sb.from('leads').update({status:'a_contatar'}).in('id',ids.slice(i,i+200)); if(error){ console.warn('normalizeEmpresarios:',error.message); return; } }
  bad.forEach(l=>l.status='a_contatar');
}
// Garante que todo empresário tenha uma negociação na aba Negociações
// (a venda/comissão é registrada lá, igual aos leads do Instagram).
async function backfillEmpresarioDeals(){
  const have=new Set(S.deals.map(d=>d.leadId));
  const missing=S.leads.filter(l=>l.tipo==='empresario' && !have.has(l.id));
  if(!missing.length) return;
  const prospector=(S.profile&&(S.profile.name||S.profile.email))||null;
  const rows=missing.map(l=>({ lead_id:l.id, prospector_name:prospector }));
  for(let i=0;i<rows.length;i+=200){ const { error }=await sb.from('deals').upsert(rows.slice(i,i+200),{ onConflict:'lead_id', ignoreDuplicates:true }); if(error){ console.warn('backfillEmpresarioDeals:',error.message); return; } }
  await loadDeals();
}
async function igpLogout(){ if(sb)await sb.auth.signOut(); location.reload(); }
window.igpLogout=igpLogout;
document.addEventListener('DOMContentLoaded',()=>{ $('logout').onclick=igpLogout; boot(); });
if(document.readyState!=='loading'){ if($('logout'))$('logout').onclick=igpLogout; boot(); }
