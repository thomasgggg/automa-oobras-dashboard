-- Viga / Canteiro — duas planilhas novas por obra, do jeito que construtoras
-- costumam controlar isso: "Medições" (o que a construtora recebe do
-- engenheiro/incorporador, por etapa e item medido) e "Turma" (comprovantes
-- de pagamento à equipe/empreiteiros). Rode isto no SQL Editor do Supabase
-- depois de já ter rodado os outros arquivos schema_*.sql.

-- 1. Medições: uma linha por item medido dentro de uma medição numerada,
--    no mesmo formato que engenheiros costumam mandar (nº da medição,
--    etapa, item, ambiente/descrição, quantidade, unidade, valor unitário,
--    valor total, percentual medido, valor recebido e valor a receber).
create table if not exists medicoes (
  id uuid primary key default gen_random_uuid(),
  obra_id text references obras(id) on delete cascade,
  numero_medicao text,
  data date not null default current_date,
  etapa text,
  item text,
  ambiente text not null,
  quantidade numeric,
  unidade text,
  valor_unitario numeric,
  valor_total numeric,
  percentual numeric,
  valor_recebido numeric default 0,
  valor_a_receber numeric,
  criado_em timestamptz not null default now()
);

create index if not exists medicoes_obra_id_idx on medicoes(obra_id);

-- 2. Turma: comprovantes de pagamento a trabalhadores/empreiteiros da obra
--    (data, quem recebeu, serviço prestado, valor, forma de pagamento).
create table if not exists pagamentos_turma (
  id uuid primary key default gen_random_uuid(),
  obra_id text references obras(id) on delete cascade,
  data date not null default current_date,
  trabalhador text not null,
  servico text,
  valor numeric not null,
  forma_pagamento text,
  observacao text,
  criado_em timestamptz not null default now()
);

create index if not exists pagamentos_turma_obra_id_idx on pagamentos_turma(obra_id);

-- 3. RLS: mesmo padrão já usado em "materiais" — só quem é da empresa dona
--    da obra consegue ler/escrever nessas duas tabelas.
alter table medicoes enable row level security;
drop policy if exists "medicoes da minha empresa" on medicoes;
create policy "medicoes da minha empresa" on medicoes
  for all
  using (obra_id in (select id from obras where empresa_id in (select empresa_id from perfis where id = auth.uid())))
  with check (obra_id in (select id from obras where empresa_id in (select empresa_id from perfis where id = auth.uid())));

alter table pagamentos_turma enable row level security;
drop policy if exists "pagamentos_turma da minha empresa" on pagamentos_turma;
create policy "pagamentos_turma da minha empresa" on pagamentos_turma
  for all
  using (obra_id in (select id from obras where empresa_id in (select empresa_id from perfis where id = auth.uid())))
  with check (obra_id in (select id from obras where empresa_id in (select empresa_id from perfis where id = auth.uid())));
