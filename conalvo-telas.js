// Conalvo — telas do painel: Relatórios, Equipe, Configurações (por assunto,
// com Pagamento por equipe e Minha conta), Administração enxuta e telas de
// acesso (login, carregamento, seleção/troca de equipe, sem equipe).
// Carregado ANTES de app.js, que chama window.__conalvoInstalar() antes do
// primeiro desenho. Tudo aqui lê e grava só a equipe ativa (S.org) pelo
// cliente Supabase do app; as regras de permissão continuam no banco.
(function () {
  window.__conalvoInstalar = function () {
    // ── Navegação: sem Ligações; Negociações só no Consórcio ──
    const featOnOriginal = featOn;
    // Prospecção: só Dashboard, Metas, Leads, Relatórios, Equipe e Configurações (sem Negociações nem CRM)
    window.featOn = k => { if (k === 'calls') return false; if ((k === 'deals' || k === 'crm') && modoConalvo() === 'prospeccao') return false; return featOnOriginal(k); };
    const i = BOTTOM_NAV_KEYS.indexOf('calls'); if (i >= 0) BOTTOM_NAV_KEYS.splice(i, 1, 'goals');
    const infoOriginal = TAB_INFO_GET;
    window.TAB_INFO_GET = () => Object.assign(infoOriginal(), {
      goals: ['Metas', modoConalvo() === 'consorcio' ? 'Atividade, contatos e resultados comerciais' : 'Metas de prospecção da equipe'],
      relatorios: ['Relatórios', modoConalvo() === 'consorcio' ? 'Atividade mensal, comissões e pagamentos' : 'Atividade de prospecção por período e membro'],
      team: ['Equipe', 'Membros, acesso e recados'],
      settings: ['Configurações', 'Esta equipe e a sua conta'],
      admin: ['Administração', 'Equipes, pedidos de aprovação e diagnóstico'],
    });
    const renderTeamRecados = renderTeam;    // conversa interna original
    window.renderTeam = () => telaEquipe(renderTeamRecados);
    window.renderSettings = telaConfiguracoes;
    window.renderRelatorios = telaRelatorios;
    window.renderAdmin = telaAdmin;
    // telas de acesso no visual Conalvo
    window.renderAuth = telaLogin;
    window.authLoading = telaCarregando;
    window.renderOnboard = telaSemEquipe;
    window.renderOrgSelectScreen = telaSelecaoEquipe;
    window.renderOrgSwitcher = janelaTrocaEquipe;
  };

  // ── utilidades ──
  const contaAtual = () => (S.session && S.session.user && S.session.user.id) || null;
  const dono = () => !!(S.profile && S.profile.org_role === 'owner');
  const consorcio = () => modoConalvo() === 'consorcio';
    const membroNome = id => { const m = S.members.find(x => x.id === id); return m ? memberLabel(m) : '—'; };
  const seg = (itens, ativo, attr) => `<div class="gl-seg cv-seg">${itens.map(([k, r]) => `<button class="${ativo === k ? 'is-on' : ''}" ${attr}="${k}">${esc(r)}</button>`).join('')}</div>`;
  const cabecalho = (titulo, sub, semModo) => `<div class="gl-head"><div><div class="gl-title">${esc(titulo)}</div><div class="gl-sub">${esc(sub)}</div></div>${semModo ? '' : `<span class="cv-modo">${consorcio() ? 'Consórcio' : 'Prospecção'}</span>`}</div>`;
  const pendente = (titulo, texto) => `<div class="cv-pend"><b>${esc(titulo)}</b><span>${esc(texto)}</span></div>`;
  const iniEquipe = n => ini(String(n || '').replace(/\([^)]*\)/g, ' ').trim() || n);
  const nomeModulo = m => m === 'consorcio' ? 'Consórcio' : 'Prospecção';
  const LOGO = '<img src="conalvo-alvo.png" alt="" width="26" height="26">';
  const marca = (sub) => `<div class="cv-marca"><div class="cv-marca-ico">${LOGO}</div><div><div class="cv-marca-n">Conalvo</div><div class="cv-marca-s">${esc(sub || 'Prospecção e consórcio')}</div></div></div>`;
  const somaDiasIso = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return localIsoDate(d); };
  // cores das etapas da configuração do funil principal da equipe
  function corDaAcao(tipo) {
    const st = stagesOf(defaultPipeline()); const n = s => normLabel(s.label);
    const achar = { chamado: () => st[1], follow_up: () => st.find(s => n(s).includes('follow')), respondeu: () => st.find(s => n(s).includes('respond')),
      contato: () => st.find(s => ['contato', 'enviou_contato'].includes(s.key) || ['enviou contato', 'contato enviado', 'contato'].includes(n(s))), seguido: () => null }[tipo];
    const e = achar && achar(); return (e && e.color) || '#B8892B';
  }
  const ROT = { chamado: 'Chamados', follow_up: 'Follow-ups', respondeu: 'Respostas', contato: 'Contatos', seguido: 'Seguidos' };

  // Período e membro COMPARTILHADOS com Metas (S.goalsFrom/To/MemberId): os dois mostram o mesmo recorte.
  function filtrosPeriodo() {
    if (!S.goalsFrom || !S.goalsTo) applyGoalsPreset('month');
    if (S.goalsMemberId && !S.members.some(m => m.id === S.goalsMemberId)) S.goalsMemberId = '';
    const mb = monthBoundsStr(-1);
    const wk = goalsPresetBounds('week'), mo = goalsPresetBounds('month');
    const on = (a, b) => S.goalsFrom === a && S.goalsTo === b;
    return `<div class="gl-filters">
      <div class="fld"><label>De</label><input type="date" id="cv-de" value="${esc(S.goalsFrom)}"></div>
      <div class="fld"><label>Até</label><input type="date" id="cv-ate" value="${esc(S.goalsTo)}"></div>
      <div class="fld"><label>Membro</label><select class="flt-sel" id="cv-membro"><option value="">Toda a equipe</option>${S.members.map(m => `<option value="${esc(m.id)}" ${m.id === S.goalsMemberId ? 'selected' : ''}>${esc(memberLabel(m))}</option>`).join('')}</select></div>
      <div class="gl-seg"><button class="${on(wk.from, wk.to) ? 'is-on' : ''}" data-cvp="week">Esta semana</button><button class="${on(mo.from, mo.to) ? 'is-on' : ''}" data-cvp="month">Este mês</button><button class="${on(mb.from, mb.to) ? 'is-on' : ''}" data-cvp="last">Mês passado</button></div>
    </div><div class="cv-nota">Mesmo período e membro da aba Metas.</div>`;
  }
  function ligarFiltros(redesenhar) {
    $('cv-de').onchange = e => { S.goalsFrom = e.target.value; redesenhar(); };
    $('cv-ate').onchange = e => { S.goalsTo = e.target.value; redesenhar(); };
    $('cv-membro').onchange = e => { S.goalsMemberId = e.target.value; redesenhar(); };
    document.querySelectorAll('[data-cvp]').forEach(b => b.onclick = () => { if (b.dataset.cvp === 'last') { const m = monthBoundsStr(-1); S.goalsFrom = m.from; S.goalsTo = m.to; } else applyGoalsPreset(b.dataset.cvp); redesenhar(); });
  }

  // ===================================================== RELATÓRIOS
  // Sem o antigo "Relatório de vendas" (diário de anotações): as observações
  // já gravadas nas negociações continuam no banco e no formulário da venda.
  function viewsRelatorio() {
    if (!consorcio()) return [['atividade', 'Relatório mensal']];
    const v = [['atividade', 'Relatório mensal'], ['comissoes', 'Comissões'], ['pay', 'Pagamento por período']];
    if ((S.payPlans || []).some(p => p.model === 'fixo_comissao')) v.push(['mensal', 'Fechamento mensal']);
    return v;
  }
  function telaRelatorios() {
    const views = viewsRelatorio();
    if (!views.some(v => v[0] === S.relView)) S.relView = 'atividade';
    $('content').innerHTML = `<div class="gl">${cabecalho('Relatórios', consorcio() ? 'Atividade real da equipe, comissões e pagamentos.' : 'Atividade real da equipe por período e membro.')}
      ${seg(views, S.relView, 'data-relv')}<div id="rel-body"></div></div>`;
    document.querySelectorAll('[data-relv]').forEach(b => b.onclick = () => { S.relView = b.dataset.relv; telaRelatorios(); });
    ({ atividade: relAtividade, comissoes: relComissoes, pay: renderRelPay, mensal: renderRelMensal }[S.relView] || relAtividade)();
  }

  function relAtividade() {
    const body = $('rel-body');
    const topo = filtrosPeriodo();
    const ev = eventosPeriodo(S.goalsFrom, S.goalsTo);
    if (ev.estado === 'carregando') { body.innerHTML = topo + '<div class="gl-card cv-carregando">Carregando atividade…</div>'; return ligarFiltros(telaRelatorios); }
    if (ev.estado === 'pendente') { body.innerHTML = topo + pendente('Atividade ainda não disponível', dono() ? ev.motivo : 'Os números de atividade ainda não estão disponíveis para esta equipe.'); return ligarFiltros(telaRelatorios); }
    const mid = S.goalsMemberId, cont = contarEventos(ev.linhas, mid), T = cont.total;
    const from = new Date(S.goalsFrom + 'T00:00:00'), toExcl = new Date(S.goalsTo + 'T00:00:00'); toExcl.setDate(toExcl.getDate() + 1);
    // mesma definição de "Leads prospectados" da aba Metas
    const adicionados = S.leads.filter(l => (l.tipo || 'comum') !== 'empresario' && l.addedAt && new Date(l.addedAt) >= from && new Date(l.addedAt) < toExcl && (!mid || l.createdBy === mid)).length;
    const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
    const kpi = (r, v, extra, cor) => `<div class="cv-kpi"><span><i style="background:${cor || '#B8892B'}"></i>${r}</span><b>${fmtNum(v)}</b>${extra ? `<small>${extra}</small>` : ''}</div>`;
    const kpiNaoReg = (r, txt) => `<div class="cv-kpi cv-kpi-pend"><span>${r}</span><b>—</b><small>${txt || 'ainda não registrado'}</small></div>`;
    const inicioBR = ev.inicio ? localIsoDate(new Date(ev.inicio)) : null;
    const incompleto = inicioBR && inicioBR > S.goalsFrom ? `<div class="cv-nota cv-alerta">O registro de ações começou em ${fmtDateOnly(inicioBR)}. Dias anteriores ficam sem contagem confiável — nada é estimado.</div>` : '';
    // evolução: por dia (até 31 dias) ou por semana
    const dias = Math.max(1, Math.round((toExcl - from) / 86400000)), porSemana = dias > 31;
    const baldes = []; for (let d = new Date(from); d < toExcl; d.setDate(d.getDate() + (porSemana ? 7 : 1))) baldes.push(new Date(d));
    // só as ações que o banco registra (ver tiposRegistrados em app.js)
    const reg = ev.tipos || new Set(['chamado', 'follow_up']);
    // ações com evento próprio no registro; Contatos vêm da entrada na etapa (abaixo)
    const tipos = ['chamado', 'follow_up', 'respondeu'].filter(t => reg.has(t));
    const naoReg = ['respondeu'].filter(t => !reg.has(t));
    // Contatos sem o evento "contato": pela data registrada de entrada em "Enviou contato" (stage_dates)
    // Contatos: pela data em que o banco gravou a entrada em "Enviou contato" (stage_dates, por
    // trigger), que vale para o painel, a 1.10.4 e a 1.11 — o evento "contato" da X-02 só
    // existe para o envio feito pela extensão 1.11 e deixaria de fora quem move pelo painel.
    const contatosEtapa = contatosPorEtapa(S.goalsFrom, S.goalsTo, S.goalsMemberId);
    const serie = baldes.map(ini => { const fim = new Date(ini); fim.setDate(fim.getDate() + (porSemana ? 7 : 1)); const o = Object.fromEntries(tipos.map(t => [t, 0]));
      for (const [dia, c] of Object.entries(cont.porDia)) { const d = new Date(dia + 'T12:00:00'); if (d >= ini && d < fim) tipos.forEach(t => { o[t] += c[t] || 0; }); } return { ini, ...o }; });
    const max = Math.max(1, ...serie.flatMap(s => tipos.map(t => s[t])));
    const barras = serie.map(s => `<div class="cv-col" data-tip="${esc(fmtDateOnly(localIsoDate(s.ini)))}${porSemana ? ' (semana)' : ''}: ${tipos.map(t => `${ROT[t]} ${s[t]}`).join(' · ')}">
        <div class="cv-col-bars">${tipos.map(t => `<i style="height:${Math.round(s[t] / max * 100)}%;background:${corDaAcao(t)}"></i>`).join('')}</div>
        <span>${porSemana ? fmtDateOnly(localIsoDate(s.ini)).slice(0, 5) : s.ini.getDate()}</span></div>`).join('');
    // por membro (só com "Toda a equipe")
    const porMembro = !mid && S.members.length ? `<section class="gl-card"><div class="cv-h3">Por membro</div><div class="cv-tabela"><div class="cv-tr cv-th"><span>Membro</span>${tipos.map(t => `<span>${ROT[t]}</span>`).join('')}</div>
        ${S.members.map(m => { const c = contarEventos(ev.linhas, m.id).total; return `<div class="cv-tr"><span>${esc(memberLabel(m))}</span>${tipos.map(t => `<span>${fmtNum(c[t])}</span>`).join('')}</div>`; }).join('')}</div></section>` : '';
    body.innerHTML = topo + incompleto + `
      <section class="gl-card"><div class="cv-kpis">
        ${kpi('Leads cadastrados', adicionados, '', '#64748B')}
        ${reg.has('seguido') ? kpi('Seguidos', T.seguido, 'marcados na extensão', '#64748B') : kpiNaoReg('Seguidos', 'indisponível')}
        ${kpi('Chamados', T.chamado, '', corDaAcao('chamado'))}
        ${kpi('Follow-ups', T.follow_up, '', corDaAcao('follow_up'))}
        ${reg.has('respondeu') ? kpi('Respostas registradas', T.respondeu, `${pct(T.respondeu, T.chamado)} dos chamados`, corDaAcao('respondeu')) : kpiNaoReg('Respostas registradas')}
        ${kpi('Contatos', contatosEtapa, `entrada em "Enviou contato" · ${pct(contatosEtapa, T.chamado)} dos chamados`, corDaAcao('contato'))}
      </div>
      <div class="cv-nota">Contado pelo registro de ações (data de Brasília e responsável). "Respostas registradas" = leads que alguém moveu para a etapa "Respondeu" (no painel ou na extensão), no máximo uma por lead por dia. Não é leitura automática das mensagens do Instagram, e pular a etapa não conta. "Leads cadastrados" não é o mesmo que seguir o perfil: "Seguidos" só conta o que for marcado na extensão 1.11.${naoReg.length ? ' Respostas ainda não são registradas neste banco: nenhum número é estimado.' : ''} Contatos: leads que entraram em "Enviou contato" no período, pela data gravada pelo banco nessa etapa.</div></section>
      <section class="gl-card"><div class="cv-h3">Evolução no período · ${porSemana ? 'por semana' : 'por dia'}</div>
        <div class="cv-legenda">${tipos.map(t => `<span><i style="background:${corDaAcao(t)}"></i>${ROT[t]}</span>`).join('')}</div>
        <div class="cv-grafico">${barras}</div></section>
      ${porMembro}
      ${consorcio() ? vendasFechadas() : ''}`;
    ligarFiltros(telaRelatorios);
  }
  // Consórcio: vendas fechadas no período (toda venda registrada aqui vem da
  // prospecção — sem classificação extra de origem). O tempo até a venda só
  // aparece com datas confiáveis; hoje a data da venda é digitada no
  // formulário e pode ser editada, então ele fica "indisponível".
  function vendasFechadas() {
    const from = new Date(S.goalsFrom + 'T00:00:00'), toExcl = new Date(S.goalsTo + 'T00:00:00'); toExcl.setDate(toExcl.getDate() + 1);
    const mid = S.goalsMemberId;
    const vendas = S.deals.filter(d => d.status === WON() && d.closedAt && new Date(d.closedAt) >= from && new Date(d.closedAt) < toExcl && (!mid || d.createdBy === mid));
    const credito = vendas.reduce((a, d) => a + (Number(d.cardValue) || 0), 0);
    return `<section class="gl-card"><div class="cv-h3">Vendas fechadas</div>
      <div class="cv-kpis cv-kpis-3">
        <div class="cv-kpi"><span><i class="cv-ponto-ink"></i>Vendas no período</span><b>${fmtNum(vendas.length)}</b><small>negociações marcadas como vendidas</small></div>
        <div class="cv-kpi"><span><i style="background:#B8892B"></i>Crédito vendido</span><b>${fmtCurrency(credito)}</b><small>soma das cartas</small></div>
        <div class="cv-kpi cv-kpi-pend"><span>Tempo da 1ª abordagem à venda</span><b>—</b><small>indisponível</small></div>
      </div>
      <div class="cv-nota">O tempo até a venda só será mostrado quando a data da venda for registrada pelo sistema no momento em que ela acontece. Hoje essa data é digitada no formulário e pode ser alterada, então nenhum número é estimado.</div>
      ${vendas.length ? `<div class="cv-tabela" style="margin-top:10px"><div class="cv-tr cv-th cv-tr3"><span>Venda</span><span>Membro</span><span>Data da venda</span></div>${vendas.map(d => `<div class="cv-tr cv-tr3"><span>${esc(d.leadName || d.leadUsername || 'Venda')}</span><span>${esc(membroNome(d.createdBy))}</span><span>${fmtDate(d.closedAt)}</span></div>`).join('')}</div>` : '<div class="cv-vazio">Nenhuma venda fechada no período.</div>'}
    </section>`;
  }

  function relComissoes() {
    const body = $('rel-body');
    if (S.comPeriodo === undefined) S.comPeriodo = 'tudo';
    const topo = filtrosPeriodo() + seg([['tudo', 'Todas as vendas'], ['periodo', 'Vendas do período']], S.comPeriodo, 'data-comp');
    const mid = S.goalsMemberId;
    const from = new Date(S.goalsFrom + 'T00:00:00'), toExcl = new Date(S.goalsTo + 'T00:00:00'); toExcl.setDate(toExcl.getDate() + 1);
    const vendidas = S.deals.filter(d => d.status === WON() && (!mid || d.createdBy === mid) && (S.comPeriodo === 'tudo' || (d.closedAt && new Date(d.closedAt) >= from && new Date(d.closedAt) < toExcl)));
    const aReceber = vendidas.filter(d => !d.commissionPaid), pagas = vendidas.filter(d => d.commissionPaid);
    const soma = l => l.reduce((a, d) => a + (Number(d.commissionValue) || 0), 0);
    const linha = (d, pago) => `<div class="cv-tr cv-tr4"><span>${esc(d.leadName || d.leadUsername || 'Venda')}<small>${esc(membroNome(d.createdBy))}</small></span><span>${fmtDate(d.closedAt)}</span><span>${d.cardValue ? fmtCurrency(d.cardValue) : '—'}</span><span><b>${d.commissionValue != null ? fmtCurrency(d.commissionValue) : '—'}</b>${pago && d.paidAt ? `<small>paga em ${fmtDate(d.paidAt)}</small>` : ''}</span></div>`;
    const cab = `<div class="cv-tr cv-th cv-tr4"><span>Venda</span><span>Data</span><span>Crédito</span><span>Comissão</span></div>`;
    const pagamentos = S.weeklyPayments.filter(p => !mid || p.memberId === mid).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    body.innerHTML = topo + `
      <div class="cv-kpis cv-kpis-2"><div class="cv-kpi"><span><i style="background:#B8892B"></i>A receber</span><b>${fmtCurrency(soma(aReceber))}</b><small>${aReceber.length} venda(s)</small></div>
        <div class="cv-kpi"><span><i class="cv-ponto-ink"></i>Pagas</span><b>${fmtCurrency(soma(pagas))}</b><small>${pagas.length} venda(s)</small></div></div>
      <div class="cv-nota">Valores gravados em cada negociação marcada como Vendida. Nada é recalculado, e marcar como paga não tira a venda do histórico.</div>
      <section class="gl-card"><div class="cv-h3">A receber</div>${aReceber.length ? `<div class="cv-tabela">${cab}${aReceber.map(d => linha(d, false)).join('')}</div>` : '<div class="cv-vazio">Nenhuma comissão a receber.</div>'}</section>
      <section class="gl-card"><div class="cv-h3">Pagas</div>${pagas.length ? `<div class="cv-tabela">${cab}${pagas.map(d => linha(d, true)).join('')}</div>` : '<div class="cv-vazio">Nenhuma comissão paga.</div>'}</section>
      <section class="gl-card"><div class="cv-h3">Pagamentos registrados</div>${pagamentos.length ? `<div class="cv-tabela"><div class="cv-tr cv-th cv-tr4"><span>Membro</span><span>Período</span><span>Comissões</span><span>Total</span></div>${pagamentos.map(p => `<div class="cv-tr cv-tr4"><span>${esc(p.memberName || membroNome(p.memberId))}</span><span>${fmtDateOnly(p.weekStart)} a ${fmtDateOnly(p.weekEnd)}</span><span>${fmtCurrency(p.commissionPay)}</span><span><b>${fmtCurrency(p.total)}</b></span></div>`).join('')}</div>` : '<div class="cv-vazio">Nenhum pagamento registrado.</div>'}</section>`;
    ligarFiltros(telaRelatorios);
    document.querySelectorAll('[data-comp]').forEach(b => b.onclick = () => { S.comPeriodo = b.dataset.comp; telaRelatorios(); });
  }

  // ===================================================== EQUIPE
  // Membros, funções, convite e o nome da equipe (dono). Entrar em outra
  // equipe e pedir equipe nova ficam em Configurações → Minha conta.
  function telaEquipe(recados) {
    if (!S.equipeView) S.equipeView = 'membros';
    const abas = seg([['membros', 'Membros e acesso'], ['recados', 'Recados']], S.equipeView, 'data-eqv');
    if (S.equipeView === 'recados') {
      recados();
      $('content').insertAdjacentHTML('afterbegin', `<div class="gl" style="margin-bottom:12px">${cabecalho('Equipe', S.org.name)}${abas}</div>`);
      document.querySelectorAll('[data-eqv]').forEach(b => b.onclick = () => { S.equipeView = b.dataset.eqv; renderShell(); });
      return;
    }
    const souDono = dono();
    const membros = S.members.map(m => {
      const eu = S.session && m.id === S.session.user.id, ehDono = m.org_role === 'owner';
      return `<div class="cv-membro"><div class="cv-av">${esc(ini(m.name || m.email))}</div><div class="cv-mi"><b>${esc(m.name || '—')}${eu ? ' <span class="cv-tag">você</span>' : ''}</b>${souDono ? `<small>${esc(m.email || '')}</small>` : ''}</div>
        <span class="cv-funcao ${ehDono ? 'is-dono' : ''}">${ehDono ? 'Dono' : 'Membro'}</span>
        ${souDono && !eu ? `<div class="cv-acoes">${ehDono ? '' : `<button class="btn btn-outline btn-sm" data-promover="${esc(m.id)}">Tornar dono</button>`}<button class="btn btn-outline btn-sm" data-remover="${esc(m.id)}">Remover</button></div>` : ''}</div>`;
    }).join('');
    $('content').innerHTML = `<div class="gl">${cabecalho('Equipe', S.org.name)}${abas}
      ${souDono ? `<section class="gl-card"><div class="cv-h3">Nome da equipe</div>
        <div class="cv-linha"><input class="cv-input" id="cv-org-nome" maxlength="60" value="${esc(S.org.name)}" aria-label="Nome da equipe"><button class="gl-btn-gold" id="cv-org-nome-salvar">Salvar nome</button></div>
        <div class="cv-nota" id="cv-org-nome-msg">É assim que a equipe aparece para todos os membros. Só o dono altera.</div></section>` : ''}
      <section class="gl-card"><div class="cv-h3">Membros · ${S.members.length}</div><div class="cv-membros">${membros}</div>
        <div class="cv-nota">Funções: o <b>dono</b> convida, define metas e pagamento e cuida das integrações; o <b>membro</b> prospecta, registra ações e vê os resultados da equipe.</div></section>
      <section class="gl-card"><div class="cv-h3">Convidar para esta equipe</div>${souDono
        ? `<div class="cv-codigo"><code>${esc(S.org.join_code || '—')}</code><button class="btn btn-outline btn-sm" id="cv-copiar">Copiar código</button></div><div class="cv-nota">Quem usar este código entra como <b>membro</b>. Só o dono vê o código.</div>`
        : '<div class="cv-nota">Para convidar alguém, peça o código de convite ao dono da equipe.</div>'}
        <div class="cv-nota" style="margin-top:8px">Para entrar em outra equipe ou pedir uma equipe nova, use <a class="cv-link" id="cv-ir-conta">Configurações → Minha conta</a>.</div></section>
    </div>`;
    document.querySelectorAll('[data-eqv]').forEach(b => b.onclick = () => { S.equipeView = b.dataset.eqv; renderShell(); });
    document.querySelectorAll('[data-promover]').forEach(b => b.onclick = () => promoverMembro(b));
    document.querySelectorAll('[data-remover]').forEach(b => b.onclick = () => removerMembro(b));
    $('cv-ir-conta').onclick = () => irParaConta();
    const cp = $('cv-copiar'); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(S.org.join_code || ''); toast('Código copiado.', 'success'); } catch (_) { toast('Não foi possível copiar.', 'error'); } };
    const sv = $('cv-org-nome-salvar'); if (sv) sv.onclick = salvarNomeEquipe;
  }
  // Tornar dono / remover: as mesmas RPCs do painel anterior; o banco confere
  // que quem pede é dono da equipe ativa e que o membro é dela.
  async function promoverMembro(b) {
    const m = S.members.find(x => x.id === b.dataset.promover); if (!m) return;
    if (b.dataset.armado !== '1') { b.dataset.armado = '1'; b.textContent = `Confirmar: ${memberLabel(m)} vira dono`; return; }
    b.disabled = true;
    const { error } = await sb.rpc('promote_team_member', { p_user_id: m.id });
    if (error) { toast(error.message, 'error'); b.disabled = false; return; }
    m.org_role = 'owner'; toast(`${memberLabel(m)} agora também é dono da equipe.`, 'success'); renderShell();
  }
  function removerMembro(b) {
    const m = S.members.find(x => x.id === b.dataset.remover); if (!m) return;
    openModal(`<div class="modal-ov"><div class="modal-box gl-modal" style="max-width:440px"><div class="modal-hd"><div><div class="modal-title">Remover ${esc(memberLabel(m))}</div><div class="modal-sub">${esc(S.org.name)}</div></div><div class="x" onclick="closeModal()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div></div>
      <div class="modal-bd"><div class="cv-nota">A pessoa perde o acesso a esta equipe. Os leads, negociações e pagamentos que ela registrou continuam na equipe. Ela só volta com o código de convite.</div></div>
      <div class="modal-ft"><button class="btn btn-outline" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" id="cv-rm-ok">Remover da equipe</button></div></div></div>`);
    $('cv-rm-ok').onclick = async () => {
      $('cv-rm-ok').disabled = true;
      const { error } = await sb.rpc('remove_team_member', { p_user_id: m.id });
      if (error) { toast(error.message, 'error'); $('cv-rm-ok').disabled = false; return; }
      S.members = S.members.filter(x => x.id !== m.id); closeModal(); toast('Membro removido da equipe.', 'success'); renderShell();
    };
  }
  window.ConalvoTelas = { promoverMembro, removerMembro };   // usado pelos testes (tests/telas-conalvo.test.js)
  // Mesma permissão do banco de hoje (policy orgs_update: só o dono da equipe).
  async function salvarNomeEquipe() {
    const nome = ($('cv-org-nome').value || '').replace(/\s+/g, ' ').trim();
    if (nome.length < 3) { toast('O nome da equipe precisa ter pelo menos 3 caracteres.', 'error'); return; }
    if (nome === S.org.name) { toast('O nome não mudou.', 'info'); return; }
    $('cv-org-nome-salvar').disabled = true;
    const { data, error } = await sb.from('orgs').update({ name: nome }).eq('id', S.org.id).select('id');
    $('cv-org-nome-salvar').disabled = false;
    if (error) { toast('Não foi possível salvar o nome. Tente de novo.', 'error'); return; }
    if (!data || !data.length) { toast('Só o dono da equipe pode alterar o nome.', 'error'); return; }
    S.org = { ...S.org, name: nome }; toast('Nome da equipe atualizado.', 'success'); renderShell();
  }

  // ===================================================== CONFIGURAÇÕES
  const SECOES_USUARIO = [['conta', 'Minha conta'], ['aparencia', 'Aparência'], ['notificacoes', 'Notificações'], ['extensao', 'Extensão']];
  function secoesEquipe() {
    const s = [['equipe', 'Equipe'], ['funis', 'Funis e cores'], ['modulo', 'Módulo']];
    if (consorcio()) s.push(['integracao', 'Integração'], ['pagamento', 'Pagamento']);
    return s;
  }
  function irParaConta(ancora) { S.route = 'settings'; S.cfgView = 'conta'; S.contaAncora = ancora || ''; $('app').classList.remove('sb-open'); renderShell(); }
  function telaConfiguracoes() {
    const eqs = secoesEquipe(), todas = [...eqs, ...SECOES_USUARIO];
    if (!todas.some(x => x[0] === S.cfgView)) S.cfgView = 'equipe';
    const souDono = dono();
    const conteudo = {
      equipe: () => `<section class="gl-card"><div class="cv-h3">Equipe</div><div class="cv-props"><div><span>Nome</span><b>${esc(S.org.name)}</b></div><div><span>Módulo</span><b>${consorcio() ? 'Consórcio' : 'Prospecção'}</b></div>
          <div><span>Sua função</span><b>${souDono ? 'Dono' : 'Membro'}</b></div><div><span>Membros</span><b>${S.members.length}</b></div></div>
          <button class="btn btn-outline btn-sm" id="cv-ir-equipe">${souDono ? 'Membros, convite e nome da equipe' : 'Ver membros'}</button></section>`,
      funis: () => S.pipelines.map(p => `<section class="gl-card"><div class="cv-h3">${esc(p.name)}${p.is_default ? ' · principal' : ''}</div>
          <div class="cv-chips">${stagesOf(p).map(st => `<span class="cv-chip" style="--c:${esc(st.color || '#64748B')}"><i></i>${esc(st.label)}</span>`).join('')}</div>
          ${souDono ? `<button class="btn btn-outline btn-sm" data-funil="${esc(p.id)}">Editar etapas e cores</button>` : '<div class="cv-nota">As etapas e as cores são definidas pelo dono da equipe.</div>'}</section>`).join('')
          + (souDono ? '<div class="cv-cartoes" id="cv-cartoes"></div>' : ''),
      modulo: () => `<section class="gl-card"><div class="cv-h3">Módulo da equipe</div>
          <div class="cv-modulos">${consorcio()
            ? `<div><b>Prospecção</b><span>Dashboard, Leads, Metas de prospecção, Relatório mensal, Equipe e Configurações.</span></div>
            <div class="is-on"><b>Consórcio</b><span>Tudo da Prospecção mais Negociações, integração com o CRM externo, pagamento por prospecção e comissões, com as configurações de cada equipe.</span></div>`
            : '<div class="is-on"><b>Prospecção</b><span>Dashboard, Leads, Metas de prospecção, Relatório mensal, Equipe e Configurações: só a atividade de prospecção da equipe.</span></div>'}</div>
          <div class="cv-nota">O módulo não muda sozinho e nenhuma equipe é reclassificada automaticamente. Para mudar, ${souDono ? 'peça à administração Conalvo' : 'fale com o dono da equipe'}.</div></section>`,
      integracao: () => { const ativo = !!(S.org.agendor_token || '').trim();
        return `<section class="gl-card"><div class="cv-h3">CRM externo</div><div class="cv-props"><div><span>Situação</span><b>${ativo ? 'Ativa' : 'Não configurada'}</b></div></div>
          ${souDono ? '' : `<div class="cv-nota">A integração é configurada pelo dono da equipe.${ativo ? ' Contatos marcados como "Enviou contato" seguem para o CRM.' : ''}</div>`}</section>
          ${souDono ? '<div class="cv-cartoes" id="cv-cartoes"></div>' : ''}`; },
      pagamento: () => secaoPagamento(souDono),
      aparencia: () => `<section class="gl-card"><div class="cv-h3">Aparência</div><div class="gl-seg"><button class="${currentTheme() === 'light' ? 'is-on' : ''}" data-tema="light">Claro</button><button class="${currentTheme() === 'dark' ? 'is-on' : ''}" data-tema="dark">Escuro</button></div>
          <div class="cv-nota" style="margin-top:8px">Vale só para você, neste aparelho.</div></section>`,
      notificacoes: () => '<div class="cv-cartoes" id="cv-cartoes"></div>',
      extensao: () => '<div class="cv-cartoes" id="cv-cartoes"></div>',
      conta: secaoMinhaConta,
    }[S.cfgView]();
    const grupo = (rot, itens) => `<div class="cv-grupo"><span class="cv-grupo-t">${rot}</span>${seg(itens, S.cfgView, 'data-cfg')}</div>`;
    $('content').innerHTML = `<div class="gl">${cabecalho('Configurações', 'Cada pessoa vê só o que a sua função permite.')}
      <div class="cv-grupos">${grupo('Esta equipe', eqs)}${grupo('Você', SECOES_USUARIO)}</div>${conteudo}</div>`;
    document.querySelectorAll('[data-cfg]').forEach(b => b.onclick = () => { S.cfgView = b.dataset.cfg; S.contaAncora = ''; telaConfiguracoes(); });
    // cartões reais do painel (integração com o CRM, funis e nichos, notificações, extensão)
    const cartoes = { funis: ['funis'], integracao: ['integracao'], notificacoes: ['notificacoes'], extensao: ['extensao'] }[S.cfgView];
    if (cartoes && $('cv-cartoes')) cartoesConfiguracao(cartoes, $('cv-cartoes'));
    document.querySelectorAll('[data-tema]').forEach(b => b.onclick = () => setTheme(b.dataset.tema));
    const q = id => $(id);
    if (q('cv-ir-equipe')) q('cv-ir-equipe').onclick = () => { S.route = 'team'; S.equipeView = 'membros'; renderShell(); };
    document.querySelectorAll('[data-funil]').forEach(b => b.onclick = () => {
      const p = S.pipelines.find(x => x.id === b.dataset.funil);
      stageEditorModal(`Etapas do funil "${p.name}"`, stagesOf(p), async list => {
        const { error } = await sb.from('org_pipelines').update({ stages: list }).eq('org_id', S.org.id).eq('id', p.id);
        if (error) { toast(error.message, 'error'); return; }
        p.stages = list; closeModal(); toast('Etapas salvas.', 'success'); telaConfiguracoes();
      });
    });
    if (S.cfgView === 'pagamento' && souDono) ligarPagamento();
    if (S.cfgView === 'conta') ligarMinhaConta();
  }

  // ───────────── Pagamento (financeiro DESTA equipe) ─────────────
  // Mostra só o modelo gravado para a equipe aberta. Nada é copiado de outra
  // equipe: o fixo + comissão só aparece preenchido se ESTA equipe já usa.
  //   • Pagamento por lead: os valores ficam em orgs.settings.goals e passam
  //     a valer ao salvar, para períodos ainda sem pagamento confirmado.
  //   • Troca de modelo e novos valores do fixo: agendados (org_schedule_pay_plan),
  //     de hoje em diante e depois do último pagamento confirmado.
  const nomeModelo = m => m === 'fixo_comissao' ? 'Fixo mensal + comissão' : 'Pagamento por lead';
  const pctTxt = v => String(Number(v) || 0).replace('.', ',') + '%';
  const unidadeLead = basis => basis === 'chamados' ? 'lead chamado' : 'lead cadastrado';
  const resumoCurto = (modelo, v) => modelo === 'fixo_comissao'
    ? `${fmtCurrency(v.fixed_monthly)}/mês + ${fmtPct(v.commission_rate)} do crédito vendido, meta de ${fmtNum(v.actions_per_day)} ações/dia`
    : `${fmtCurrency(v.payTargetPerDay > 0 ? (v.payDayRate || 0) / v.payTargetPerDay : 0)} por ${unidadeLead(v.payBasis)}${v.payFollowUp ? ' e por follow-up' : ''}`;
  const ultimoConfirmado = () => (S.weeklyPayments || []).map(p => p.weekEnd).filter(Boolean).sort().pop() || null;
  function dataMinima() {
    const hoje = localIsoDate(new Date()), ult = ultimoConfirmado();
    return ult && somaDiasIso(ult, 1) > hoje ? somaDiasIso(ult, 1) : hoje;
  }
  function secaoPagamento(souDono) {
    const hoje = localIsoDate(new Date()), atual = payPlanAt(hoje), fixoAtual = atual.model === 'fixo_comissao', prox = nextScheduledPlan(), g = getGoals();
    if (!souDono) return `<section class="gl-card"><div class="cv-h3">Pagamento da prospecção</div><div class="cv-props"><div><span>Modelo desta equipe</span><b>${nomeModelo(atual.model)}</b></div>${prox ? `<div><span>Mudança marcada</span><b>a partir de ${fmtDateOnly(planDate(prox))}</b></div>` : ''}</div>
      <div class="cv-nota">Os valores e o modelo de pagamento são definidos pelo dono da equipe.</div></section>`;
    const item = (r, v) => `<div><span>${r}</span><b>${v}</b></div>`;
    const valoresAtuais = fixoAtual
      ? item('Fixo mensal', fmtCurrency(atual.fixed_monthly) + ' por mês') + item('Comissão', fmtPct(atual.commission_rate) + ' do crédito vendido') + item('Meta de atividade', fmtNum(atual.actions_per_day) + ' ações por dia') + item('Bônus adicional', 'ainda não definido')
      : (() => { const u = g.payTargetPerDay > 0 ? (g.payDayRate || 0) / g.payTargetPerDay : 0;
        return item('Valor por ' + unidadeLead(g.payBasis), fmtCurrency(u)) + item('Follow-up', g.payFollowUp ? fmtCurrency(u) + ' cada' : 'não é pago')
          + item('Faixa do dia', g.payBonusMinPerDay > 0 && g.payBonusRate > 0 ? `a partir de ${fmtNum(g.payBonusMinPerDay)}/dia: ${fmtCurrency(g.payBonusRate)} cada` : 'desligada')
          + item('Comissão das vendas', pctTxt(g.commissionPct) + ' (padrão)'); })();
    const agendada = prox ? `<div class="cv-agendada"><b>Mudança marcada para ${fmtDateOnly(planDate(prox))}</b>
        <span>Até ${fmtDateOnly(somaDiasIso(planDate(prox), -1))} continua o modelo atual. A partir de ${fmtDateOnly(planDate(prox))}: ${nomeModelo(prox.model)}${prox.model === 'fixo_comissao' ? ` (${resumoCurto('fixo_comissao', prox)})` : ''}.</span>
        <button class="btn btn-outline btn-sm" id="pg-cancelar">Cancelar esta mudança</button></div>` : '';
    // formulário: valores gravados DESTA equipe; o fixo só vem preenchido se ela já usa o fixo
    const raw = (S.org.settings && S.org.settings.goals) || {};
    const semGravar = ['payDayRate', 'payTargetPerDay'].some(k => raw[k] == null);
    const fx = fixoAtual ? atual : null;
    const semP01 = S.payPlans === null;
    const radio = (v, t, s) => `<label class="cv-opcao"><input type="radio" name="pg-modelo" id="pg-modelo-${v}" value="${v}" ${atual.model === v ? 'checked' : ''} ${semP01 && v === 'fixo_comissao' ? 'disabled' : ''}><span><b>${t}${atual.model === v ? ' <em>atual</em>' : ''}</b><small>${s}</small></span></label>`;
    return `<section class="gl-card"><div class="cv-h3">Modelo atual desta equipe</div>
        <div class="cv-props"><div><span>Modelo</span><b>${nomeModelo(atual.model)}</b></div><div><span>Desde</span><b>${atual.legacy ? 'o início da equipe' : fmtDateOnly(planDate(atual))}</b></div>${valoresAtuais}</div>
        ${agendada}</section>
      <section class="gl-card" id="pg-form"><div class="cv-h3">Alterar o pagamento</div>
        <div class="cv-opcoes">${radio('por_lead', 'Pagamento por lead', 'Valor por lead chamado ou cadastrado, com follow-up e faixa do dia opcionais.')}${radio('fixo_comissao', 'Fixo mensal + comissão', 'Valor fixo por mês, proporcional às ações do dia, mais comissão sobre o crédito vendido.')}</div>
        ${semP01 ? '<div class="cv-nota">A troca de modelo ainda não está disponível para esta equipe. Os valores por lead podem ser ajustados normalmente.</div>' : ''}
        <div id="pg-lead" class="cv-campos">
          <div class="fld"><label>Contar como</label><select id="pg-basis"><option value="chamados" ${g.payBasis === 'chamados' ? 'selected' : ''}>Leads chamados</option><option value="seguidos" ${g.payBasis !== 'chamados' ? 'selected' : ''}>Leads cadastrados (critério atual de “seguidos”)</option></select></div>
          <div class="fld"><label>Valor por dia (R$)</label><input id="pg-rate" type="text" inputmode="decimal" value="${numberToMoney(g.payDayRate)}"></div>
          <div class="fld"><label>Leads no dia para esse valor</label><input id="pg-target" type="number" min="1" value="${g.payTargetPerDay}"></div>
          <div class="cv-calc cv-span" id="pg-unit"></div>
          <label class="cv-check cv-span"><input id="pg-fu" type="checkbox" ${g.payFollowUp ? 'checked' : ''}> Pagar também cada follow-up (mesmo valor do lead)</label>
          <div class="fld"><label>Faixa do dia: a partir de (chamados + follow-ups)</label><input id="pg-bmin" type="number" min="0" value="${g.payBonusMinPerDay || 0}"></div>
          <div class="fld"><label>Valor por unidade nesses dias (R$)</label><input id="pg-brate" type="text" inputmode="decimal" value="${g.payBonusRate ? numberToMoney(g.payBonusRate) : ''}" placeholder="0 = desligada"></div>
          <div class="fld"><label>Comissão padrão das vendas (%)</label><input id="pg-com" type="text" inputmode="decimal" value="${String(g.commissionPct).replace('.', ',')}"></div>
          <div class="cv-nota cv-span">A faixa do dia troca o valor normal pelo valor da faixa no dia em que a pessoa atinge a quantidade. Deixe 0 para desligar. Metas de leads por dia ficam em Metas → Definir metas.${semGravar ? ' Alguns valores não estavam gravados para esta equipe: os campos mostram o padrão que o sistema já usa no cálculo.' : ''}</div>
        </div>
        <div id="pg-fixo" class="cv-campos">
          <div class="fld"><label>Fixo mensal (R$)</label><input id="pg-fixed" type="text" inputmode="decimal" value="${fx ? numberToMoney(fx.fixed_monthly) : ''}" placeholder="Ex.: 1.000,00"></div>
          <div class="fld"><label>Comissão (% do crédito vendido)</label><input id="pg-taxa" type="text" inputmode="decimal" value="${fx ? String(Number(fx.commission_rate) * 100).replace('.', ',') : ''}" placeholder="Ex.: 0,1"></div>
          <div class="fld"><label>Meta de ações por dia (chamados + follow-ups)</label><input id="pg-acoes" type="number" min="1" value="${fx ? fx.actions_per_day : ''}" placeholder="Ex.: 70"></div>
          <div class="cv-nota cv-span">${fx ? 'Valores atuais desta equipe.' : 'Preencha os valores desta equipe — nada é copiado de outra equipe.'} Cada dia de segunda a sexta vale até 1 dia de fixo (ações do dia ÷ meta). Bônus adicional: ainda não definido.</div>
        </div>
        <div id="pg-quando" class="cv-quando"><div class="fld"><label>A partir de</label><input id="pg-data" type="date" min="${dataMinima()}" value=""></div><div class="cv-explica" id="pg-explica"></div></div>
        <div class="cv-explica" id="pg-agora"></div>
        <div class="cv-linha" style="margin-top:12px"><button class="gl-btn-gold" id="pg-salvar">Salvar</button></div>
      </section>
      <section class="gl-card"><div class="cv-h3">Quem recebe o valor</div>
        <div class="fld" style="max-width:340px"><select class="flt-sel" id="cv-dest"><option value="">Toda a equipe (soma de todos)</option>${S.members.map(m => `<option value="${esc(m.id)}" ${m.id === g.payRecipientId ? 'selected' : ''}>${esc(memberLabel(m))}</option>`).join('')}</select></div>
        <div class="cv-nota">Usado no pagamento por período e no fechamento mensal.</div></section>`;
  }
  // Pagamento por lead: os valores valem na hora. Quais períodos isso alcança,
  // por quem recebe: do dia seguinte ao último pagamento confirmado dele (ou
  // desde o primeiro lead da equipe) até hoje, e os próximos dias até uma
  // troca de modelo já agendada.
  function periodosAfetados() {
    const hoje = localIsoDate(new Date()), prox = nextScheduledPlan(), g = getGoals();
    const quem = g.payRecipientId ? S.members.filter(m => m.id === g.payRecipientId) : S.members;
    const primeiro = S.leads.reduce((min, l) => (l.addedAt && localIsoDate(l.addedAt) < min ? localIsoDate(l.addedAt) : min), hoje);
    const linhas = quem.map(m => {
      const ult = (S.weeklyPayments || []).filter(p => p.memberId === m.id).map(p => p.weekEnd).sort().pop();
      const de = ult ? somaDiasIso(ult, 1) : primeiro;
      return `<b>${esc(memberLabel(m))}</b>: de ${fmtDateOnly(de)} até hoje (${fmtDateOnly(hoje)})${ult ? `, depois do pagamento confirmado até ${fmtDateOnly(ult)}` : ', sem nenhum pagamento confirmado ainda'}`;
    });
    linhas.push(`<b>Próximos dias</b>: ${prox ? `até ${fmtDateOnly(somaDiasIso(planDate(prox), -1))}` : 'até você mudar de novo'}`);
    return { linhas, fim: prox ? planDate(prox) : null };
  }
  function ligarPagamento() {
    const hoje = localIsoDate(new Date()), atual = payPlanAt(hoje), fixoAtual = atual.model === 'fixo_comissao', prox = nextScheduledPlan(), g = getGoals();
    const min = dataMinima(), ult = ultimoConfirmado();
    const proxMes = (() => { const n = new Date(); return localIsoDate(new Date(n.getFullYear(), n.getMonth() + 1, 1)); })();
    $('pg-data').value = proxMes >= min ? proxMes : min;
    ['pg-rate', 'pg-brate', 'pg-fixed'].forEach(id => maskMoneyInput($(id)));
    const escolhido = () => ['por_lead', 'fixo_comissao'].find(v => $('pg-modelo-' + v).checked) || atual.model;
    const lerLead = () => ({ payBasis: $('pg-basis').value === 'chamados' ? 'chamados' : 'seguidos', payDayRate: moneyToNumber($('pg-rate').value), payTargetPerDay: parseInt($('pg-target').value, 10),
      payFollowUp: $('pg-fu').checked, payBonusMinPerDay: parseInt($('pg-bmin').value, 10) || 0, payBonusRate: moneyToNumber($('pg-brate').value) || 0, commissionPct: parseFloat(String($('pg-com').value).replace(',', '.')) });
    const lerFixo = () => { const pct = parsePct($('pg-taxa').value); return { fixed_monthly: moneyToNumber($('pg-fixed').value), commission_rate: isFinite(pct) ? Math.round(pct * 10000) / 1000000 : null, actions_per_day: parseInt($('pg-acoes').value, 10) }; };
    const imediato = () => escolhido() === 'por_lead' && !fixoAtual;    // ajuste de valores por lead
    function atualizar() {
      const m = escolhido(), lead = m === 'por_lead';
      $('pg-lead').hidden = !lead; $('pg-fixo').hidden = lead;
      const v = lerLead(), u = v.payTargetPerDay > 0 && v.payDayRate != null ? v.payDayRate / v.payTargetPerDay : null;
      $('pg-unit').innerHTML = u == null ? 'Preencha o valor por dia e a quantidade de leads.' : `= <b>${fmtCurrency(u)}</b> por ${unidadeLead(v.payBasis)}${v.payFollowUp ? ` e <b>${fmtCurrency(u)}</b> por follow-up` : ' · follow-up não é pago'}`;
      $('pg-quando').hidden = imediato(); $('pg-agora').hidden = !imediato();
      const salvar = $('pg-salvar'); salvar.disabled = false;
      if (imediato()) {
        const af = periodosAfetados();
        $('pg-agora').innerHTML = `<div><b>Ao salvar, estes valores passam a valer na hora</b> para os períodos ainda sem pagamento confirmado:</div>
          <ul class="cv-afetados">${af.linhas.map(l => `<li>${l}</li>`).join('')}</ul>
          <div class="cv-explica-s">${af.fim ? `A partir de ${fmtDateOnly(af.fim)} vale o modelo já agendado. ` : ''}Pagamentos já confirmados${ult ? ` (o último vai até ${fmtDateOnly(ult)})` : ''} ficam como foram gravados e não são recalculados.</div>`;
        salvar.textContent = 'Salvar valores'; return;
      }
      const d = $('pg-data').value, troca = m !== atual.model;
      salvar.textContent = troca ? 'Agendar troca de modelo' : 'Agendar novos valores';
      if (prox) { $('pg-explica').innerHTML = `<div><b>Já existe uma mudança marcada para ${fmtDateOnly(planDate(prox))}.</b> Cancele-a acima para marcar outra.</div>`; salvar.disabled = true; return; }
      if (!d || d < min) { $('pg-explica').innerHTML = `<div>Escolha uma data a partir de <b>${fmtDateOnly(min)}</b>${ult && somaDiasIso(ult, 1) >= hoje ? ` (dia seguinte ao último pagamento confirmado)` : ' (hoje)'}.</div>`; salvar.disabled = true; return; }
      const novo = lead ? resumoCurto('por_lead', { ...g, ...v }) : (() => { const f = lerFixo(); return f.fixed_monthly != null && f.commission_rate != null && f.actions_per_day > 0 ? resumoCurto('fixo_comissao', f) : 'valores a preencher'; })();
      $('pg-explica').innerHTML = `<div><b>Até ${fmtDateOnly(somaDiasIso(d, -1))}</b> continua valendo o modelo atual: ${nomeModelo(atual.model)} (${resumoCurto(atual.model, fixoAtual ? atual : g)}).</div>
        <div><b>A partir de ${fmtDateOnly(d)}</b>: ${nomeModelo(m)} (${novo}).</div>
        <div class="cv-explica-s">Nada antes de ${fmtDateOnly(d)} é recalculado, e pagamentos já confirmados não mudam.</div>`;
    }
    ['por_lead', 'fixo_comissao'].forEach(v => { $('pg-modelo-' + v).onchange = atualizar; });
    ['pg-basis', 'pg-rate', 'pg-target', 'pg-fu', 'pg-bmin', 'pg-brate', 'pg-com', 'pg-fixed', 'pg-taxa', 'pg-acoes', 'pg-data'].forEach(id => { $(id).oninput = atualizar; $(id).onchange = atualizar; });
    atualizar();
    $('pg-salvar').onclick = async () => {
      const m = escolhido(), btn = $('pg-salvar');
      let fin = null;
      if (m === 'por_lead') {
        const v = lerLead();
        if (v.payDayRate == null || v.payDayRate < 0) { toast('Informe o valor por dia.', 'error'); return; }
        if (!(v.payTargetPerDay >= 1)) { toast('Informe quantos leads no dia valem esse valor (1 ou mais).', 'error'); return; }
        if (!(v.commissionPct >= 0 && v.commissionPct <= 100)) { toast('A comissão padrão precisa ficar entre 0 e 100%.', 'error'); return; }
        fin = v;
      }
      btn.disabled = true;
      const fim = async msg => { await loadPayPlans(); toast(msg, 'success'); telaConfiguracoes(); };
      if (imediato()) {
        const { error } = await saveOrgGoals({ ...getGoals(), ...fin });
        if (error) { toast(error.message, 'error'); btn.disabled = false; return; }
        return fim('Valores do pagamento por lead salvos.');
      }
      const d = $('pg-data').value;
      const args = { p_org_id: S.org.id, p_model: m, p_fixed_monthly: null, p_commission_rate: null, p_actions_per_day: null, p_effective_from: d };
      if (m === 'fixo_comissao') {
        const f = lerFixo();
        if (f.fixed_monthly == null || !(f.fixed_monthly >= 0) || f.commission_rate == null || !(f.actions_per_day >= 1)) { toast('Preencha o fixo mensal, a comissão e a meta de ações por dia.', 'error'); btn.disabled = false; return; }
        Object.assign(args, { p_fixed_monthly: f.fixed_monthly, p_commission_rate: f.commission_rate, p_actions_per_day: f.actions_per_day });
      }
      const { error } = await sb.rpc('org_schedule_pay_plan', args);
      if (error) { toast(error.message, 'error'); btn.disabled = false; return; }
      // troca para "por lead": os valores por lead desta equipe só são gravados se mudaram
      if (fin && GOALS_FIN_KEYS.some(k => fin[k] !== g[k])) {
        const r = await saveOrgGoals({ ...getGoals(), ...fin });
        if (r.error) { await loadPayPlans(); toast('A troca foi agendada, mas os valores por lead não foram salvos: ' + r.error.message, 'error'); telaConfiguracoes(); return; }
      }
      await fim(m === atual.model ? `Novos valores agendados para ${fmtDateOnly(d)}.` : `Troca de modelo agendada para ${fmtDateOnly(d)}.`);
    };
    const canc = $('pg-cancelar'); if (canc) canc.onclick = async () => {
      if (canc.dataset.armado !== '1') { canc.dataset.armado = '1'; canc.textContent = 'Confirmar cancelamento'; return; }
      const { error } = await sb.rpc('org_cancel_pay_plan', { p_org_id: S.org.id, p_plan_id: prox.id });
      if (error) { toast(error.message, 'error'); return; }
      await loadPayPlans(); toast('Mudança cancelada. O modelo atual continua.', 'success'); telaConfiguracoes();
    };
    $('cv-dest').onchange = async e => { const { error } = await savePayRecipient(e.target.value); toast(error ? error.message : 'Destinatário salvo.', error ? 'error' : 'success'); };
  }

  // ───────────── Minha conta (configurações do usuário) ─────────────
  function secaoMinhaConta() {
    return `<section class="gl-card"><div class="cv-h3">Seu nome de usuário</div>
        <div class="cv-linha"><input class="cv-input" id="cv-nome" maxlength="60" value="${esc((S.profile && S.profile.name) || '')}" placeholder="Como você quer aparecer" aria-label="Seu nome de usuário"><button class="gl-btn-gold" id="cv-nome-salvar">Salvar nome</button></div>
        <div class="cv-nota">É assim que seu nome aparece para a equipe (recados, lista de membros, relatórios).</div>
        <div class="cv-props" style="margin-top:12px"><div><span>E-mail</span><b>${esc((S.profile && S.profile.email) || '—')}</b></div></div>
        <button class="btn btn-outline btn-sm" id="cv-sair">Sair</button></section>
      <section class="gl-card" id="cv-minhas"><div class="cv-h3">Minhas equipes</div><div id="cv-minhas-lista" class="cv-carregando">Carregando…</div></section>
      <section class="gl-card" id="cv-outra"><div class="cv-h3">Entrar em outra equipe</div>
        <div class="cv-linha"><input class="cv-input" id="cv-cod" placeholder="Código recebido do dono" autocomplete="off" style="text-transform:uppercase"><button class="btn btn-outline btn-sm" id="cv-entrar">Entrar</button></div>
        <div class="cv-nota" id="cv-cod-msg">Você entra como membro da equipe dona do código. Se a equipe foi criada pela administração Conalvo para um pedido seu, você entra como dono.</div></section>
      <section class="gl-card" id="cv-pedir"><div class="cv-h3">Pedir uma equipe nova</div><div id="cv-pedidos"></div></section>`;
  }
  async function ligarMinhaConta() {
    $('cv-sair').onclick = igpLogout;
    $('cv-nome-salvar').onclick = salvarMeuNome;
    $('cv-nome').onkeydown = e => { if (e.key === 'Enter') salvarMeuNome(); };
    $('cv-entrar').onclick = () => entrarComCodigo($('cv-cod'), $('cv-cod-msg'));
    $('cv-cod').onkeydown = e => { if (e.key === 'Enter') entrarComCodigo($('cv-cod'), $('cv-cod-msg')); };
    montarPedidos($('cv-pedidos'));
    const alvo = S.contaAncora && $(S.contaAncora); if (alvo && alvo.scrollIntoView) alvo.scrollIntoView({ block: 'start' });
    const conta = contaAtual(), equipe = S.org && S.org.id;
    const { data: orgs, error } = await sb.rpc('my_orgs');
    const box = $('cv-minhas-lista'); if (!box || box.isConnected === false) return;
    if (contaAtual() !== conta || (S.org && S.org.id) !== equipe || S.cfgView !== 'conta') return;   // resposta atrasada
    if (error) { box.className = 'cv-vazio'; box.textContent = 'Não foi possível carregar suas equipes agora.'; return; }
    box.className = '';
    box.innerHTML = listaEquipes(orgs || [], { botao: true });
    box.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () => trocarPara(b.dataset.abrir));
  }
  // Mesmo mecanismo do painel publicado: profiles.name do próprio usuário.
  async function salvarMeuNome() {
    const nome = ($('cv-nome').value || '').replace(/\s+/g, ' ').trim();
    if (!nome) { toast('Digite um nome.', 'error'); return; }
    if (nome.length < 2) { toast('O nome precisa ter pelo menos 2 caracteres.', 'error'); return; }
    $('cv-nome-salvar').disabled = true;
    const { data, error } = await sb.from('profiles').update({ name: nome }).eq('id', S.session.user.id).select('id');
    $('cv-nome-salvar').disabled = false;
    if (error || (data && !data.length)) { toast('Não foi possível salvar o nome. Tente de novo.', 'error'); return; }
    S.profile = { ...S.profile, name: nome };
    const mi = S.members.findIndex(m => m.id === S.session.user.id); if (mi >= 0) S.members[mi] = { ...S.members[mi], name: nome };
    toast('Nome atualizado.', 'success'); renderShell();
  }
  async function entrarComCodigo(inp, msg) {
    const cod = (inp.value || '').trim().toUpperCase();
    if (!cod) { msg.textContent = 'Digite o código que o dono da equipe enviou.'; msg.classList.add('cv-erro'); return; }
    const { error } = await sb.rpc('join_org', { p_code: cod });
    if (error) { msg.textContent = /inválid/i.test(error.message) ? 'Código não encontrado. Confira com o dono da equipe.' : error.message; msg.classList.add('cv-erro'); return; }
    toast('Você entrou na equipe.', 'success'); S.route = 'dashboard'; await boot();
  }
  async function trocarPara(id) {
    const { error } = await sb.rpc('switch_org', { p_org_id: id });
    if (error) { toast('Não foi possível abrir essa equipe.', 'error'); return; }
    closeModal(); S.route = 'dashboard'; await boot();
  }
  function listaEquipes(orgs, opc) {
    if (!orgs.length) return '<div class="cv-vazio">Você ainda não faz parte de nenhuma equipe.</div>';
    return `<div class="cv-equipes">${orgs.map(o => `<div class="cv-equipe${o.is_current ? ' is-atual' : ''}" ${opc.clicavel && !o.is_current ? `data-abrir="${esc(o.id)}" tabindex="0" role="button"` : opc.clicavel ? `data-abrir="${esc(o.id)}" tabindex="0" role="button"` : ''}>
        <div class="cv-av">${esc(iniEquipe(o.name))}</div>
        <div class="cv-mi"><b>${esc(o.name)}</b><small>${o.module_id ? nomeModulo(o.module_id) + ' · ' : ''}${o.members || 0} membro(s) · ${o.role === 'owner' ? 'você é dono' : 'você é membro'}</small></div>
        ${o.is_current ? '<span class="cv-funcao is-dono">Atual</span>' : opc.botao ? `<button class="btn btn-outline btn-sm" data-abrir="${esc(o.id)}">Abrir</button>` : '<span class="cv-seta">›</span>'}</div>`).join('')}</div>`;
  }

  // Pedido de equipe nova: o usuário pede → a administração aprova ou recusa
  // → só depois da aprovação o próprio usuário cria a equipe aprovada.
  const ROT_STATUS = { pendente: 'Aguardando análise', aprovado: 'Aprovado', recusado: 'Recusado' };
  async function montarPedidos(box, depois) {
    if (!box) return;
    box.innerHTML = '<div class="cv-carregando">Carregando…</div>';
    const { data, error } = await sb.rpc('my_org_requests');
    if (error) { box.innerHTML = '<div class="cv-vazio">Os pedidos de equipe ainda não estão disponíveis.</div>'; return; }
    const lista = data || [], aberto = lista.find(p => p.status === 'pendente');
    const cartao = p => `<div class="cv-pedido is-${p.status}"><div class="cv-pedido-hd"><b>${esc(p.name)}</b><span class="cv-status s-${p.status}">${ROT_STATUS[p.status]}</span></div>
        <small>${nomeModulo(p.module_id)} · pedido em ${fmtDate(p.created_at)}${p.reviewed_at ? ` · analisado em ${fmtDate(p.reviewed_at)}` : ''}</small>
        ${p.status === 'pendente' ? '<div class="cv-nota">A administração Conalvo vai analisar. Você será avisado aqui quando houver resposta.</div>' : ''}
        ${p.status === 'recusado' && p.review_note ? `<div class="cv-nota">Motivo: ${esc(p.review_note)}</div>` : ''}
        ${p.status === 'aprovado' && !p.joined ? (p.owner_is_requester === false
          ? '<div class="cv-nota">Pedido aprovado. A administração Conalvo criou a equipe e definiu <b>outra pessoa</b> como dona. Se você receber o código, entra como membro.</div>'
          : '<div class="cv-nota">Pedido aprovado. A administração Conalvo criou a equipe e vai enviar o código de entrada para você. Quando receber, use <b>Entrar em outra equipe</b>, aqui em Minha conta. Como a equipe foi criada para você, você entra como dono.</div>') : ''}
        ${p.status === 'aprovado' && p.joined ? '<div class="cv-nota">A equipe já tem dono. Ela aparece em "Minhas equipes" se você faz parte dela.</div>' : ''}</div>`;
    box.innerHTML = `${lista.length ? `<div class="cv-pedidos">${lista.map(cartao).join('')}</div>` : ''}
      ${aberto ? '' : `<div class="cv-form" id="cv-pedido-form">
        <input class="cv-input" id="cv-ped-nome" maxlength="60" placeholder="Nome da equipe" aria-label="Nome da equipe">
        <select class="cv-input" id="cv-ped-mod" aria-label="Tipo da equipe"><option value="prospeccao">Prospecção</option><option value="consorcio">Consórcio</option></select>
        <textarea class="cv-input cv-span" id="cv-ped-msg" maxlength="500" rows="2" placeholder="Conte para a administração para que é a equipe (opcional)"></textarea>
        <button class="gl-btn-gold" id="cv-ped-enviar">Enviar pedido</button></div>
        <div class="cv-nota">A administração Conalvo analisa o pedido, cria a equipe e envia o código de entrada para você.</div>`}`;
    const env = box.querySelector('#cv-ped-enviar');
    if (env) env.onclick = async () => {
      const nome = (box.querySelector('#cv-ped-nome').value || '').trim();
      if (nome.length < 3) { toast('Dê um nome à equipe (pelo menos 3 caracteres).', 'error'); return; }
      env.disabled = true;
      const { error: e } = await sb.rpc('request_org', { p_name: nome, p_module_id: box.querySelector('#cv-ped-mod').value, p_message: box.querySelector('#cv-ped-msg').value });
      if (e) { toast(e.message, 'error'); env.disabled = false; return; }
      toast('Pedido enviado para a administração.', 'success'); montarPedidos(box, depois);
    };
    if (depois) depois(lista);
  }

  // ===================================================== ADMINISTRAÇÃO (superadmin)
  // Enxuta: Equipes, Pedidos de aprovação e Diagnóstico. Sem CRM nem
  // relatórios das equipes — o trabalho de cada equipe fica com ela.
  async function telaAdmin() {
    if (!S.admView) S.admView = 'pedidos';
    $('content').innerHTML = `<div class="gl">${cabecalho('Administração', 'Equipes da plataforma, pedidos de aprovação e diagnóstico.', true)}
      ${seg([['equipes', 'Equipes'], ['pedidos', 'Pedidos de aprovação'], ['diagnostico', 'Diagnóstico']], S.admView, 'data-admv')}<div id="adm-body"><div class="gl-card cv-carregando">Carregando…</div></div></div>`;
    document.querySelectorAll('[data-admv]').forEach(b => b.onclick = () => { S.admView = b.dataset.admv; telaAdmin(); });
    const corpo = $('adm-body'), vez = (S.admVez = (S.admVez || 0) + 1), conta = contaAtual();
    const carregar = () => Promise.all([sb.rpc('admin_orgs'), sb.rpc('admin_users'), sb.rpc('admin_org_requests')]);
    let [orgs, users, peds] = await carregar();
    const semPermissao = e => e && (e.code === '42501' || /superadmin|administra/i.test(e.message || ''));
    // falha passageira (rede, servidor ocupado): tenta de novo uma vez antes de mostrar erro
    if ((orgs.error && !semPermissao(orgs.error)) || (users.error && !semPermissao(users.error))) {
      await new Promise(r => setTimeout(r, 800));
      [orgs, users, peds] = await carregar();
    }
    // resposta atrasada: de uma carga anterior (outra aba da Administração), de outra
    // sessão (saiu/entrou com outra conta) ou depois de sair da tela — não desenha nada
    if (vez !== S.admVez || corpo.isConnected === false || contaAtual() !== conta || S.route !== 'admin') return;
    S.admErro = orgs.error ? { code: orgs.error.code || '', message: String(orgs.error.message || '').slice(0, 120) } : null;
    if (orgs.error && semPermissao(orgs.error)) { corpo.innerHTML = '<div class="cv-vazio">Área restrita à administração da plataforma.</div>'; return; }
    if (orgs.error || users.error) {
      corpo.innerHTML = '<div class="cv-vazio">Não foi possível carregar a administração agora. <button class="btn btn-outline btn-sm" id="adm-tentar">Tentar de novo</button></div>';
      $('adm-tentar').onclick = () => telaAdmin(); return;
    }
    ({ equipes: admEquipes, pedidos: admPedidos, diagnostico: admDiagnostico }[S.admView] || admPedidos)(corpo, { orgs: orgs.data || [], users: users.data || [], peds: peds.error ? null : (peds.data || []) });
  }
  // Equipes e usuários da plataforma, com as mesmas ações do painel anterior
  // (RPCs admin_*, que o banco só aceita do superadministrador). Sem CRM, leads
  // ou relatórios das equipes.
  function admEquipes(corpo, d) {
    const linhas = [...d.orgs].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const usuarios = [...d.users].sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)));
    const ST = { active: 'Ativo', pending: 'Aguardando', blocked: 'Bloqueado' };
    corpo.innerHTML = `<section class="gl-card"><div class="cv-h3">Equipes · ${linhas.length}</div>
      <div class="cv-linha"><input class="cv-input" id="adm-q" placeholder="Buscar equipe…" value="${esc(S.admOrgQ || '')}" style="max-width:320px"></div>
      <div class="cv-tabela" id="adm-eq"><div class="cv-tr cv-th cv-tr5"><span>Equipe</span><span>Membros</span><span>Criada em</span><span>Código de convite</span><span></span></div>
      ${linhas.map(o => `<div class="cv-tr cv-tr5" data-s="${esc(String(o.name).toLowerCase() + ' ' + String(o.join_code || '').toLowerCase())}"><span><b>${esc(o.name)}</b>${o.module_id ? `<small>${nomeModulo(o.module_id)}</small>` : ''}</span><span>${Number(o.members) > 0 ? fmtNum(o.members) : 'aguardando o dono entrar'}</span><span>${o.created_at ? fmtDate(o.created_at) : '—'}</span><span><code class="cv-cod-mini">${esc(o.join_code || '—')}</code></span>
        <span class="cv-acoes"><button class="btn btn-outline btn-sm" data-modulos="${esc(o.id)}" data-nome="${esc(o.name)}">Módulos</button><button class="btn btn-outline btn-sm" data-excluir-eq="${esc(o.id)}" data-nome="${esc(o.name)}">Excluir</button></span></div>`).join('')}</div>
      <div id="adm-feat"></div>
      <div class="cv-nota">Sem CRM, leads ou relatórios das equipes aqui: esses dados ficam com cada equipe.</div></section>
      <section class="gl-card"><div class="cv-h3">Usuários · ${usuarios.length}</div>
      <div class="cv-linha"><input class="cv-input" id="adm-uq" placeholder="Buscar usuário…" value="${esc(S.admUserQ || '')}" style="max-width:320px"></div>
      <div class="cv-tabela" id="adm-us"><div class="cv-tr cv-th cv-tr5"><span>Usuário</span><span>Equipe aberta</span><span>Função</span><span>Situação</span><span></span></div>
      ${usuarios.map(u => `<div class="cv-tr cv-tr5" data-s="${esc(((u.name || '') + ' ' + (u.email || '') + ' ' + (u.org_name || '')).toLowerCase())}"><span><b>${esc(u.name || '—')}</b><small>${esc(u.email || '')}</small></span><span>${esc(u.org_name || '—')}</span><span>${u.platform_role === 'admin' ? 'Superadministrador' : u.org_role === 'owner' ? 'Dono' : 'Membro'}</span><span>${ST[u.status] || esc(u.status || '—')}</span>
        <span class="cv-acoes">${u.platform_role === 'admin' ? '' : `<button class="btn btn-outline btn-sm" data-situacao="${esc(u.id)}" data-st="${esc(u.status)}">${u.status === 'pending' ? 'Aprovar' : u.status === 'active' ? 'Bloquear' : 'Liberar'}</button><button class="btn btn-outline btn-sm" data-excluir-us="${esc(u.id)}" data-nome="${esc(u.name || u.email)}">Excluir</button>`}</span></div>`).join('')}</div></section>`;
    const filtro = (inp, tab, chave) => { const q = ($(inp).value || '').toLowerCase().trim(); S[chave] = q; $(tab).querySelectorAll('[data-s]').forEach(r => { r.style.display = !q || r.dataset.s.includes(q) ? '' : 'none'; }); };
    $('adm-q').oninput = () => filtro('adm-q', 'adm-eq', 'admOrgQ'); filtro('adm-q', 'adm-eq', 'admOrgQ');
    $('adm-uq').oninput = () => filtro('adm-uq', 'adm-us', 'admUserQ'); filtro('adm-uq', 'adm-us', 'admUserQ');
    // confirmação em dois cliques: o 1º arma, o 2º executa
    const armar = (b, texto) => { if (b.dataset.armado === '1') return true; b.dataset.armado = '1'; b.textContent = texto; return false; };
    corpo.querySelectorAll('[data-modulos]').forEach(b => b.onclick = () => renderOrgFeatures(b.dataset.modulos, b.dataset.nome));
    corpo.querySelectorAll('[data-excluir-eq]').forEach(b => b.onclick = async () => {
      if (!armar(b, 'Confirmar exclusão')) return;
      const nome = prompt(`Excluir "${b.dataset.nome}" apaga TODOS os leads, negociações, pagamentos e mensagens da equipe. Não dá para desfazer.\n\nPara confirmar, digite o nome da equipe:`);
      if ((nome || '').trim() !== b.dataset.nome) { toast('Exclusão cancelada.', 'info'); telaAdmin(); return; }
      const { error } = await sb.rpc('admin_delete_org', { p_org_id: b.dataset.excluirEq });
      if (error) { toast(error.message, 'error'); return; }
      toast('Equipe excluída.', 'success'); telaAdmin();
    });
    corpo.querySelectorAll('[data-situacao]').forEach(b => b.onclick = async () => {
      const novo = b.dataset.st === 'active' ? 'blocked' : 'active';
      const { data, error } = await sb.from('profiles').update({ status: novo }).eq('id', b.dataset.situacao).select('id');
      if (error || !data || !data.length) { toast('Não foi possível mudar a situação do usuário.', 'error'); return; }
      toast(novo === 'blocked' ? 'Usuário bloqueado.' : 'Usuário liberado.', 'success'); telaAdmin();
    });
    corpo.querySelectorAll('[data-excluir-us]').forEach(b => b.onclick = async () => {
      if (!armar(b, 'Confirmar exclusão')) return;
      const { error } = await sb.rpc('admin_delete_user', { p_user_id: b.dataset.excluirUs });
      if (error) { toast(error.message, 'error'); return; }
      toast('Usuário excluído. Os leads que ele criou continuam nas equipes.', 'success'); telaAdmin();
    });
  }
  function admPedidos(corpo, d) {
    if (!S.admPedFiltro) S.admPedFiltro = 'pendente';
    const peds = d.peds, aguardando = d.users.filter(u => u.status === 'pending');
    if (peds === null) { corpo.innerHTML = pendente('Pedidos de equipe ainda não disponíveis', 'A tabela de pedidos ainda não foi instalada neste banco.'); return; }
    const conta = s => peds.filter(p => p.status === s).length;
    const lista = S.admPedFiltro === 'todos' ? peds : peds.filter(p => p.status === S.admPedFiltro);
    const cartao = p => `<div class="cv-pedido is-${p.status}"><div class="cv-pedido-hd"><b>${esc(p.name)}</b><span class="cv-status s-${p.status}">${ROT_STATUS[p.status]}</span></div>
        <small>${nomeModulo(p.module_id)} · pedido por <b>${esc(p.requester_name || '—')}</b> (${esc(p.requester_email || '')}) em ${fmtDate(p.created_at)}</small>
        ${p.message ? `<div class="cv-pedido-msg">“${esc(p.message)}”</div>` : ''}
        ${p.status === 'recusado' && p.review_note ? `<div class="cv-nota">Motivo da recusa: ${esc(p.review_note)}</div>` : ''}
        ${p.status === 'aprovado' ? (() => { const o = d.orgs.find(x => x.id === p.org_id);
          return `<div class="cv-criada"><div><span>Equipe criada</span><b>${esc(p.org_name || p.name)}</b></div><div><span>Dono</span><b>${esc(p.owner_name || p.owner_email || '—')}</b></div><div><span>Código de entrada</span><code class="cv-cod-mini" data-codigo>${esc((o && o.join_code) || '—')}</code></div>
            <button class="btn btn-outline btn-sm" data-copiar="${esc((o && o.join_code) || '')}">Copiar código</button></div>
            <div class="cv-nota">${p.joined ? 'O dono já entrou com o código.' : `Envie o código a <b>${esc(p.owner_email || 'quem vai ser o dono')}</b> por fora (WhatsApp, e-mail…). Só essa conta vira dona ao entrar; qualquer outra pessoa com o código entra como membro.`}</div>`; })() : ''}
        ${p.status === 'pendente' ? `<div class="cv-linha"><button class="gl-btn-gold" data-aprovar="${esc(p.id)}">Aprovar e criar equipe</button><button class="btn btn-outline btn-sm" data-recusar="${esc(p.id)}">Recusar</button></div>
          <div class="cv-aprova" id="apr-${esc(p.id)}" hidden><div class="cv-form"><input class="cv-input" maxlength="60" value="${esc(p.name)}" aria-label="Nome da equipe" data-apr-nome>
            <select class="cv-input" aria-label="Tipo da equipe" data-apr-mod><option value="prospeccao" ${p.module_id === 'prospeccao' ? 'selected' : ''}>Prospecção</option><option value="consorcio" ${p.module_id === 'consorcio' ? 'selected' : ''}>Consórcio</option></select>
            <select class="cv-input cv-span" aria-label="Quem será o dono" data-apr-dono><option value="">Dono: quem pediu — ${esc(p.requester_name || '')} (${esc(p.requester_email || '')})</option><option value="outra">Dono: outra conta (escolher pelo e-mail)</option></select>
            <input class="cv-input cv-span" type="email" placeholder="E-mail da conta que será a dona" aria-label="E-mail do dono" data-apr-email hidden></div>
            <div class="cv-nota">Você cria o espaço com este nome e tipo. Prospecção: Dashboard, Metas, Leads, Relatórios, Equipe e Configurações, sem valores. Você não entra na equipe; o código aparece aqui para enviar. Só a conta escolhida como dona vira dona ao entrar com o código.</div>
            <button class="gl-btn-gold" data-confirmar-aprovar="${esc(p.id)}">Criar equipe</button></div>
          <div class="cv-recusa" id="rec-${esc(p.id)}" hidden><textarea class="cv-input" rows="2" maxlength="300" placeholder="Motivo (o solicitante verá esta mensagem)"></textarea><button class="btn btn-outline btn-sm" data-confirmar-recusa="${esc(p.id)}">Confirmar recusa</button></div>` : ''}</div>`;
    corpo.innerHTML = `<section class="gl-card"><div class="cv-h3">Equipes novas</div>
        ${seg([['pendente', `Pendentes · ${conta('pendente')}`], ['aprovado', `Aprovados · ${conta('aprovado')}`], ['recusado', `Recusados · ${conta('recusado')}`], ['todos', 'Todos']], S.admPedFiltro, 'data-pedf')}
        <div class="cv-pedidos" style="margin-top:12px">${lista.length ? lista.map(cartao).join('') : '<div class="cv-vazio">Nenhum pedido aqui.</div>'}</div>
        <div class="cv-nota">Quem pede nunca cria equipe: aprovar é você criar o espaço e escolher o dono. O código vai por fora; só o dono escolhido vira dono ao entrar.</div></section>
      <section class="gl-card"><div class="cv-h3">Cadastros aguardando aprovação · ${aguardando.length}</div>
        ${aguardando.length ? `<div class="cv-membros">${aguardando.map(u => `<div class="cv-membro"><div class="cv-av">${esc(ini(u.name || u.email))}</div><div class="cv-mi"><b>${esc(u.name || '—')}</b><small>${esc(u.email || '')}</small></div><button class="btn btn-outline btn-sm" data-liberar="${esc(u.id)}">Aprovar cadastro</button></div>`).join('')}</div>` : '<div class="cv-vazio">Nenhum cadastro aguardando.</div>'}</section>`;
    corpo.querySelectorAll('[data-pedf]').forEach(b => b.onclick = () => { S.admPedFiltro = b.dataset.pedf; admPedidos(corpo, d); });
    corpo.querySelectorAll('[data-aprovar]').forEach(b => b.onclick = () => { const box = $('apr-' + b.dataset.aprovar); box.hidden = false; box.querySelector('[data-apr-nome]').focus(); });
    corpo.querySelectorAll('[data-apr-dono]').forEach(s => s.onchange = () => { s.closest('.cv-aprova').querySelector('[data-apr-email]').hidden = s.value !== 'outra'; });
    corpo.querySelectorAll('[data-confirmar-aprovar]').forEach(b => b.onclick = async () => {
      const box = $('apr-' + b.dataset.confirmarAprovar), nome = (box.querySelector('[data-apr-nome]').value || '').trim();
      if (nome.length < 3) { toast('O nome da equipe precisa ter pelo menos 3 caracteres.', 'error'); return; }
      const args = { p_request_id: b.dataset.confirmarAprovar, p_name: nome, p_module_id: box.querySelector('[data-apr-mod]').value };
      if (box.querySelector('[data-apr-dono]').value === 'outra') {
        const email = (box.querySelector('[data-apr-email]').value || '').trim().toLowerCase(), c = d.users.find(u => String(u.email || '').toLowerCase() === email);
        if (!c) { toast('Nenhuma conta com esse e-mail.', 'error'); return; }
        if (c.status !== 'active') { toast('Essa conta não está ativa. Libere o cadastro antes.', 'error'); return; }
        args.p_owner_id = c.id;
      }
      b.disabled = true;
      const { error } = await sb.rpc('admin_approve_org_request', args);
      if (error) { toast(error.message, 'error'); b.disabled = false; return; }
      toast('Equipe criada. Copie o código e envie ao solicitante.', 'success'); S.admPedFiltro = 'aprovado'; telaAdmin();
    });
    corpo.querySelectorAll('[data-copiar]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copiar); toast('Código copiado.', 'success'); } catch (_) { toast('Não foi possível copiar. Selecione o código.', 'error'); } });
    const revisar = async (id, nota) => {
      const { error } = await sb.rpc('admin_reject_org_request', { p_request_id: id, p_note: nota });
      if (error) { toast(error.message, 'error'); return; }
      toast('Pedido recusado.', 'success'); telaAdmin();
    };
    corpo.querySelectorAll('[data-recusar]').forEach(b => b.onclick = () => { const box = $('rec-' + b.dataset.recusar); box.hidden = false; box.querySelector('textarea').focus(); });
    corpo.querySelectorAll('[data-confirmar-recusa]').forEach(b => b.onclick = () => {
      const nota = ($('rec-' + b.dataset.confirmarRecusa).querySelector('textarea').value || '').trim();
      if (!nota) { toast('Escreva o motivo da recusa.', 'error'); return; }
      revisar(b.dataset.confirmarRecusa, nota);
    });
    corpo.querySelectorAll('[data-liberar]').forEach(b => b.onclick = async () => {
      const { data, error } = await sb.from('profiles').update({ status: 'active' }).eq('id', b.dataset.liberar).select('id');
      if (error || !data || !data.length) { toast('Não foi possível aprovar o cadastro.', 'error'); return; }
      toast('Cadastro aprovado.', 'success'); telaAdmin();
    });
  }
  function admDiagnostico(corpo, d) {
    const peds = d.peds || [], tres = new Date(Date.now() - 3 * 86400000).toISOString();
    const itens = [
      ['Cadastros aguardando aprovação', d.users.filter(u => u.status === 'pending').length],
      ['Pedidos de equipe pendentes', peds.filter(p => p.status === 'pendente').length],
      ['Pedidos pendentes há mais de 3 dias', peds.filter(p => p.status === 'pendente' && p.created_at < tres).length],
      ['Equipes sem membros', d.orgs.filter(o => !(Number(o.members) > 0)).length],
      ['Usuários bloqueados', d.users.filter(u => u.status === 'blocked').length],
      ['Superadministradores', d.users.filter(u => u.platform_role === 'admin').length],
    ];
    corpo.innerHTML = `<section class="gl-card"><div class="cv-h3">Situação da plataforma</div>
      <div class="cv-diag">${itens.map(([r, n]) => `<div class="${n && !/Superadmin/.test(r) ? 'is-atencao' : ''}"><span>${r}</span><b>${fmtNum(n)}</b></div>`).join('')}</div>
      <div class="cv-nota">Contagens a partir das listas de equipes, usuários e pedidos. A verificação completa do banco (segurança, pagamentos e registro de ações) é o roteiro somente leitura de diagnóstico, rodado pela equipe técnica.</div></section>`;
  }

  // ===================================================== TELAS DE ACESSO (Conalvo)
  function mostrarAcesso(qual) {
    $('app').classList.remove('show');
    ['auth', 'onboard', 'org-select'].forEach(id => $(id).classList.toggle('hidden', id !== qual));
  }
  function telaLogin() {
    mostrarAcesso('auth');
    const login = S.authMode !== 'signup';
    $('auth-card').innerHTML = `${marca()}
      <div class="auth-h">${login ? 'Entrar' : 'Criar conta'}</div>
      <div class="auth-sub">${login ? 'Use o e-mail e a senha da sua conta.' : 'Depois do cadastro, entre numa equipe com o código do dono ou peça uma equipe nova.'}</div>
      ${login ? '' : '<div class="field"><label for="au-name">Nome</label><input class="inp" id="au-name" placeholder="Seu nome" autocomplete="name"></div>'}
      <div class="field"><label for="au-email">E-mail</label><input class="inp" id="au-email" type="email" placeholder="voce@email.com" autocomplete="email"></div>
      <div class="field"><label for="au-pass">Senha</label><input class="inp" id="au-pass" type="password" placeholder="••••••••" autocomplete="${login ? 'current-password' : 'new-password'}"></div>
      <button class="btn-block" id="au-go" ${CONFIGURED ? '' : 'disabled'}>${login ? 'Entrar' : 'Criar conta'}</button>
      <div class="auth-err" id="au-err" role="alert"></div>
      <div class="auth-alt">${login ? 'Ainda não tem conta?' : 'Já tem conta?'} <a id="au-switch" tabindex="0">${login ? 'Criar conta' : 'Entrar'}</a></div>`;
    $('au-switch').onclick = () => { S.authMode = login ? 'signup' : 'login'; telaLogin(); };
    $('au-go').onclick = doAuth;
    $('au-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
  }
  function telaCarregando(msg) {
    mostrarAcesso('auth');
    $('auth-card').innerHTML = `<div class="cv-carregando-tela">${marca()}<div class="cv-spinner" aria-hidden="true"></div><div class="auth-loading-txt" role="status">${esc(msg || 'Carregando…')}</div></div>`;
  }
  async function telaSelecaoEquipe(orgs) {
    mostrarAcesso('org-select');
    $('org-select-card').innerHTML = `${marca()}
      <div class="auth-h">Escolha a equipe</div><div class="auth-sub">Você participa de mais de uma equipe. Os dados de cada uma ficam separados.</div>
      <div id="orgsel-list">${listaEquipes(orgs, { clicavel: true })}</div>
      <div class="cv-acesso-pe"><a class="cv-link" id="orgsel-add" tabindex="0">Entrar em outra equipe ou pedir uma nova</a><a class="cv-link" id="orgsel-sair" tabindex="0">Sair</a></div>`;
    $('orgsel-add').onclick = () => telaSemEquipe({ voltar: () => telaSelecaoEquipe(orgs) });
    $('orgsel-sair').onclick = igpLogout;
    $('orgsel-list').querySelectorAll('[data-abrir]').forEach(c => { const abrir = async () => {
      const o = orgs.find(x => x.id === c.dataset.abrir);
      telaCarregando(`Abrindo ${o ? o.name : 'a equipe'}…`);
      if (o && !o.is_current) { const { error } = await sb.rpc('switch_org', { p_org_id: o.id }); if (error) { telaSelecaoEquipe(orgs); toast('Não foi possível abrir essa equipe.', 'error'); return; } }
      await boot();
    }; c.onclick = abrir; c.onkeydown = e => { if (e.key === 'Enter') abrir(); }; });
  }
  // Sem equipe (ou vindo de "Entrar em outra equipe"): código ou pedido — nunca cria equipe direto.
  function telaSemEquipe(opc) {
    opc = opc || {};
    mostrarAcesso('onboard');
    let modo = 'codigo';
    const desenhar = () => {
      $('onboard-card').innerHTML = `${marca()}
        <div class="auth-h">${opc.voltar ? 'Outra equipe' : 'Você ainda não está em uma equipe'}</div>
        <div class="auth-sub">Entre com o código que o dono da equipe enviou ou peça uma equipe nova para a administração Conalvo.</div>
        <div class="cv-abas"><button class="${modo === 'codigo' ? 'is-on' : ''}" data-modo="codigo">Tenho um código</button><button class="${modo === 'pedido' ? 'is-on' : ''}" data-modo="pedido">Pedir equipe nova</button></div>
        <div id="ob-body"></div>
        <div class="cv-acesso-pe">${opc.voltar ? '<a class="cv-link" id="ob-voltar" tabindex="0">Voltar às minhas equipes</a>' : '<span></span>'}<a class="cv-link" id="ob-sair" tabindex="0">Sair</a></div>`;
      $('onboard-card').querySelectorAll('[data-modo]').forEach(b => b.onclick = () => { modo = b.dataset.modo; desenhar(); });
      if (opc.voltar) $('ob-voltar').onclick = opc.voltar;
      $('ob-sair').onclick = igpLogout;
      if (modo === 'codigo') {
        $('ob-body').innerHTML = `<div class="field"><label for="ob-code">Código de convite</label><input class="inp" id="ob-code" placeholder="Ex.: 7K2P9X" autocomplete="off" style="text-transform:uppercase"></div>
          <button class="btn-block" id="ob-go">Entrar na equipe</button><div class="auth-err" id="ob-err" role="alert"></div>`;
        const ir = async () => {
          const cod = ($('ob-code').value || '').trim();
          const err = $('ob-err');
          if (!cod) { err.textContent = 'Digite o código que o dono da equipe enviou.'; err.classList.add('show'); return; }
          $('ob-go').disabled = true;
          const { error } = await sb.rpc('join_org', { p_code: cod });
          if (error) { err.textContent = /inválid/i.test(error.message) ? 'Código não encontrado. Confira com o dono da equipe.' : error.message; err.classList.add('show'); $('ob-go').disabled = false; return; }
          telaCarregando('Entrando na equipe…'); S.route = 'dashboard'; await boot();
        };
        $('ob-go').onclick = ir; $('ob-code').onkeydown = e => { if (e.key === 'Enter') ir(); };
      } else montarPedidos($('ob-body'));
    };
    desenhar();
  }
  async function janelaTrocaEquipe() {
    openModal(`<div class="modal-ov"><div class="modal-box gl-modal cv-troca" style="max-width:560px"><div class="modal-hd"><div><div class="modal-title">Trocar de equipe</div><div class="modal-sub">Os dados de cada equipe ficam separados.</div></div><div class="x" onclick="closeModal()"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div></div>
      <div class="modal-bd"><div id="org-sw-list" class="cv-carregando">Carregando…</div></div>
      <div class="modal-ft"><button class="btn btn-outline" onclick="closeModal()">Fechar</button><button class="btn btn-primary" id="org-sw-add">Entrar em outra equipe ou pedir uma nova</button></div></div></div>`);
    $('org-sw-add').onclick = () => { closeModal(); irParaConta('cv-outra'); };
    const { data: orgs, error } = await sb.rpc('my_orgs');
    const box = $('org-sw-list'); if (!box) return;
    if (error) { box.className = 'cv-vazio'; box.textContent = 'Não foi possível carregar suas equipes agora.'; return; }
    box.className = ''; box.innerHTML = listaEquipes(orgs || [], { clicavel: true });
    box.querySelectorAll('[data-abrir]').forEach(c => { const abrir = () => { const o = (orgs || []).find(x => x.id === c.dataset.abrir); if (o && o.is_current) { closeModal(); return; } telaCarregando(`Abrindo ${o ? o.name : 'a equipe'}…`); trocarPara(c.dataset.abrir); }; c.onclick = abrir; c.onkeydown = e => { if (e.key === 'Enter') abrir(); }; });
  }
})();
