-- =====================================================================
-- Conalvo — impacto da correção da faixa de 90 ações (SOMENTE LEITURA)
-- =====================================================================
-- O painel agrupava as ações do dia pelo dia em UTC: uma ação depois das 21h
-- (Brasília) caía no dia seguinte. A correção agrupa por America/Sao_Paulo.
-- Esta consulta mostra, nas equipes com a faixa ligada, os dias AINDA NÃO
-- CONFIRMADOS (depois do último pagamento confirmado de cada pessoa) em que
-- a contagem muda de lado do limite da faixa. Pagamentos confirmados não
-- mudam: são registros gravados.
-- Ações consideradas, como no painel: chamado (called_at), entrada em etapa
-- de follow-up (stage_dates) se a equipe paga follow-up, e cadastro (added_at)
-- na base "leads cadastrados". Não altera nada.
-- =====================================================================
with faixa as (
  select o.id as org_id, (o.settings->'goals'->>'payBonusMinPerDay')::int as minimo,
         coalesce(o.settings->'goals'->>'payBasis', 'seguidos') as base,
         coalesce((o.settings->'goals'->>'payFollowUp')::boolean, true) as paga_follow
    from public.orgs o
   where coalesce((o.settings->'goals'->>'payBonusMinPerDay')::int, 0) > 0
     and coalesce((o.settings->'goals'->>'payBonusRate')::numeric, 0) > 0
),
acoes as (
  select l.org_id, l.created_by as quem, case when f.base = 'chamados' then l.called_at else l.added_at end as quando
    from public.leads l join faixa f on f.org_id = l.org_id
   where coalesce(l.tipo, 'comum') <> 'empresario'
  union all
  select l.org_id, l.created_by, (sd.value #>> '{}')::timestamptz
    from public.leads l join faixa f on f.org_id = l.org_id and f.paga_follow
    join public.org_pipelines p on p.id = l.pipeline_id
    cross join lateral jsonb_each(coalesce(l.stage_dates, '{}'::jsonb)) sd
    join lateral jsonb_array_elements(p.stages) st on st->>'key' = sd.key and lower(st->>'label') like '%follow%'
   where coalesce(l.tipo, 'comum') <> 'empresario'
),
pago as (select org_id, member_id, max(week_end) as ate from public.weekly_payments group by 1, 2),
abertas as (
  select a.* from acoes a left join pago pg on pg.org_id = a.org_id and pg.member_id = a.quem
   where a.quando is not null and (pg.ate is null or (a.quando at time zone 'America/Sao_Paulo')::date > pg.ate)
),
utc as (select org_id, quem, (quando at time zone 'UTC')::date as dia, count(*) n from abertas group by 1, 2, 3),
br  as (select org_id, quem, (quando at time zone 'America/Sao_Paulo')::date as dia, count(*) n from abertas group by 1, 2, 3)
select o.name as equipe, coalesce(p.name, '(sem autor)') as pessoa, coalesce(b.dia, u.dia) as dia,
       coalesce(u.n, 0) as acoes_pelo_dia_utc, coalesce(b.n, 0) as acoes_pelo_dia_brasilia, f.minimo as faixa_a_partir_de,
       case when coalesce(b.n, 0) >= f.minimo then 'passa a ter a faixa' else 'deixa de ter a faixa' end as efeito
  from br b
  full join utc u on u.org_id = b.org_id and u.quem is not distinct from b.quem and u.dia = b.dia
  join faixa f on f.org_id = coalesce(b.org_id, u.org_id)
  join public.orgs o on o.id = f.org_id
  left join public.profiles p on p.id = coalesce(b.quem, u.quem)
 where (coalesce(u.n, 0) >= f.minimo) <> (coalesce(b.n, 0) >= f.minimo)
 order by 1, 2, 3;
