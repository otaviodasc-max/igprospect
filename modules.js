// IGProspect SaaS — catálogo de Módulos de Profissão
// Cada módulo customiza terminologia, funil de prospecção/negociação,
// campos extras de lead e KPIs do dashboard para uma organização.
// O módulo "consorcio" é cópia fiel do comportamento original do app —
// garante que orgs existentes continuem idênticas após esta feature.
window.IGP_MODULES = {
  consorcio: {
    id: 'consorcio', name: 'Consórcio', icon: '💰',
    labels: {
      dealsTabTitle: 'Negociações · Consórcio',
      dealsTabSub: 'Acompanhe o andamento das vendas por etapa',
      dealSingular: 'negociação',
      cardTypeLabel: 'Tipo de carta',
      cardValueLabel: 'Valor da carta',
    },
    prospectFunnel: {
      stages: ['novo','chamado','respondeu','contato'],
      meta: {
        novo:{label:'Novo Lead',short:'Novos'},
        chamado:{label:'Chamado',short:'Chamados'},
        respondeu:{label:'Respondeu',short:'Responderam'},
        contato:{label:'Enviou Contato',short:'Convertidos'},
      },
      colors: { novo:'#64748B', chamado:'#6366F1', respondeu:'#F59E0B', contato:'#10B981' },
    },
    empFunnel: {
      stages: ['a_contatar','em_conversa','reuniao','negociando'],
      meta: {
        a_contatar:{label:'A Contatar',short:'A Contatar'},
        em_conversa:{label:'Em Conversa',short:'Conversa'},
        reuniao:{label:'Reunião',short:'Reunião'},
        negociando:{label:'Negociando',short:'Negociando'},
      },
      colors: { a_contatar:'#64748B', em_conversa:'#6366F1', reuniao:'#8B5CF6', negociando:'#F59E0B' },
    },
    dealFunnel: {
      stages: ['contato','reuniao','reuniao_agendada','negociando','vendido','perdido'],
      meta: {
        contato:{label:'Contato Recebido',short:'Contato'},
        reuniao:{label:'Reunião',short:'Reunião'},
        reuniao_agendada:{label:'Reunião Agendada',short:'Agendada'},
        negociando:{label:'Negociando',short:'Negociando'},
        vendido:{label:'Vendido',short:'Vendidos'},
        perdido:{label:'Perdido',short:'Perdidos'},
      },
      colors: { contato:'#64748B', reuniao:'#6366F1', reuniao_agendada:'#8B5CF6', negociando:'#F59E0B', vendido:'#10B981', perdido:'#EF4444' },
      wonStage: 'vendido', lostStage: 'perdido',
    },
    cardTypes: ['Imóvel','Veículo','Investimentos'],
    extraLeadFields: [],
    features: { weeklyPay: true },
  },

  imoveis: {
    id: 'imoveis', name: 'Imóveis', icon: '🏠',
    labels: {
      dealsTabTitle: 'Negociações · Imóveis',
      dealsTabSub: 'Acompanhe visitas e propostas por etapa',
      dealSingular: 'negociação',
      cardTypeLabel: 'Tipo de imóvel',
      cardValueLabel: 'Valor do imóvel',
    },
    prospectFunnel: {
      stages: ['novo','chamado','respondeu','contato'],
      meta: {
        novo:{label:'Novo Lead',short:'Novos'},
        chamado:{label:'Chamado',short:'Chamados'},
        respondeu:{label:'Respondeu',short:'Responderam'},
        contato:{label:'Enviou Contato',short:'Convertidos'},
      },
      colors: { novo:'#64748B', chamado:'#6366F1', respondeu:'#F59E0B', contato:'#10B981' },
    },
    empFunnel: null,
    dealFunnel: {
      stages: ['contato','visita','proposta','documentacao','vendido','perdido'],
      meta: {
        contato:{label:'Contato Recebido',short:'Contato'},
        visita:{label:'Visita Agendada',short:'Visita'},
        proposta:{label:'Proposta',short:'Proposta'},
        documentacao:{label:'Documentação',short:'Docs'},
        vendido:{label:'Fechado',short:'Fechados'},
        perdido:{label:'Perdido',short:'Perdidos'},
      },
      colors: { contato:'#64748B', visita:'#6366F1', proposta:'#8B5CF6', documentacao:'#F59E0B', vendido:'#10B981', perdido:'#EF4444' },
      wonStage: 'vendido', lostStage: 'perdido',
    },
    cardTypes: ['Apartamento','Casa','Terreno','Comercial'],
    extraLeadFields: [
      { key:'imovel_interesse', label:'Tipo de imóvel de interesse', type:'select', options:['Apartamento','Casa','Terreno','Comercial'] },
      { key:'faixa_valor', label:'Faixa de valor', type:'text' },
    ],
    features: { weeklyPay: false },
  },

  seguros: {
    id: 'seguros', name: 'Seguros', icon: '🛡️',
    labels: {
      dealsTabTitle: 'Negociações · Seguros',
      dealsTabSub: 'Acompanhe cotações e apólices por etapa',
      dealSingular: 'apólice',
      cardTypeLabel: 'Tipo de seguro',
      cardValueLabel: 'Valor do prêmio',
    },
    prospectFunnel: {
      stages: ['novo','chamado','respondeu','contato'],
      meta: {
        novo:{label:'Novo Lead',short:'Novos'},
        chamado:{label:'Chamado',short:'Chamados'},
        respondeu:{label:'Respondeu',short:'Responderam'},
        contato:{label:'Enviou Contato',short:'Convertidos'},
      },
      colors: { novo:'#64748B', chamado:'#6366F1', respondeu:'#F59E0B', contato:'#10B981' },
    },
    empFunnel: null,
    dealFunnel: {
      stages: ['contato','cotacao','proposta','apolice_emitida','renovacao_perdida'],
      meta: {
        contato:{label:'Contato Recebido',short:'Contato'},
        cotacao:{label:'Cotação',short:'Cotação'},
        proposta:{label:'Proposta',short:'Proposta'},
        apolice_emitida:{label:'Apólice Emitida',short:'Emitidas'},
        renovacao_perdida:{label:'Perdida',short:'Perdidas'},
      },
      colors: { contato:'#64748B', cotacao:'#6366F1', proposta:'#F59E0B', apolice_emitida:'#10B981', renovacao_perdida:'#EF4444' },
      wonStage: 'apolice_emitida', lostStage: 'renovacao_perdida',
    },
    cardTypes: ['Auto','Vida','Residencial','Saúde','Empresarial'],
    extraLeadFields: [
      { key:'seguro_interesse', label:'Tipo de seguro', type:'select', options:['Auto','Vida','Residencial','Saúde','Empresarial'] },
      { key:'seguradora_atual', label:'Seguradora atual', type:'text' },
    ],
    features: { weeklyPay: false },
  },

  saas: {
    id: 'saas', name: 'SaaS / Infoproduto', icon: '💻',
    labels: {
      dealsTabTitle: 'Negociações · Vendas',
      dealsTabSub: 'Acompanhe demos e propostas por etapa',
      dealSingular: 'oportunidade',
      cardTypeLabel: 'Plano/produto',
      cardValueLabel: 'Valor do contrato',
    },
    prospectFunnel: {
      stages: ['novo','chamado','respondeu','contato'],
      meta: {
        novo:{label:'Novo Lead',short:'Novos'},
        chamado:{label:'Chamado',short:'Chamados'},
        respondeu:{label:'Respondeu',short:'Responderam'},
        contato:{label:'Enviou Contato',short:'Convertidos'},
      },
      colors: { novo:'#64748B', chamado:'#6366F1', respondeu:'#F59E0B', contato:'#10B981' },
    },
    empFunnel: null,
    dealFunnel: {
      stages: ['contato','demo_agendada','demo_realizada','proposta','trial','fechado','perdido'],
      meta: {
        contato:{label:'Contato Recebido',short:'Contato'},
        demo_agendada:{label:'Demo Agendada',short:'Agendada'},
        demo_realizada:{label:'Demo Realizada',short:'Realizada'},
        proposta:{label:'Proposta',short:'Proposta'},
        trial:{label:'Em Trial',short:'Trial'},
        fechado:{label:'Fechado',short:'Fechados'},
        perdido:{label:'Perdido',short:'Perdidos'},
      },
      colors: { contato:'#64748B', demo_agendada:'#6366F1', demo_realizada:'#8B5CF6', proposta:'#F59E0B', trial:'#0EA5E9', fechado:'#10B981', perdido:'#EF4444' },
      wonStage: 'fechado', lostStage: 'perdido',
    },
    cardTypes: ['Plano Starter','Plano Pro','Plano Enterprise','Infoproduto'],
    extraLeadFields: [
      { key:'empresa', label:'Empresa', type:'text' },
      { key:'cargo', label:'Cargo do contato', type:'text' },
      { key:'tamanho_equipe', label:'Tamanho da equipe', type:'select', options:['1-10','11-50','51-200','200+'] },
    ],
    features: { weeklyPay: false },
  },
};

window.IGP_MODULE_ORDER = ['consorcio','imoveis','seguros','saas'];
