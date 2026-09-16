-- Trava por telefone para o webhook do WhatsApp.
--
-- Problema que isso resolve: quando a pessoa manda duas mensagens seguidas
-- rapidinho (ex.: "Paguei 1000 para o empreendedor" e, na sequência,
-- "Coloque na planilha de comprovante"), a Vercel pode processar as duas
-- chamadas do webhook ao mesmo tempo, em paralelo. Cada uma lê o estado da
-- sessão (whatsapp_sessions) antes da outra terminar de salvar, então as
-- duas "acham" que não há obra definida, criam dois registros duplicados e
-- mandam a mesma pergunta duas vezes ("Recebi, mas para qual obra é esse
-- registro?"). O mesmo acontece se a Meta reenviar o mesmo webhook (coisa
-- que ela faz por design) bem rápido, antes do primeiro terminar de gravar.
--
-- A função abaixo usa uma tabela simples com chave primária no telefone:
-- cada requisição tenta "reservar" o telefone antes de processar a
-- mensagem, e só segue em frente se conseguir. Isso é feito num único
-- INSERT ... ON CONFLICT, que é atômico no Postgres mesmo com várias
-- requisições batendo ao mesmo tempo (diferente de "ler o estado, decidir,
-- gravar" em três passos separados, que é onde mora a corrida).
--
-- Rode isto no SQL Editor do Supabase depois de já ter rodado os outros
-- arquivos schema_*.sql.

create table if not exists whatsapp_locks (
  telefone text primary key,
  travado_em timestamptz not null default now()
);

-- Tenta travar o telefone por até p_ttl_segundos. Devolve true se conseguiu
-- (pode seguir processando a mensagem) ou false se outra requisição já está
-- processando uma mensagem desse mesmo telefone agora (deve tentar de novo
-- em instantes). O TTL existe para o caso raro de uma execução travar sem
-- nunca liberar (ex.: a função serverless estourou o tempo limite) — depois
-- do TTL, a trava é considerada "morta" e outra requisição pode assumir.
create or replace function tentar_travar_telefone(p_telefone text, p_ttl_segundos int default 20)
returns boolean
language plpgsql
as $$
declare
  linhas_afetadas int;
begin
  insert into whatsapp_locks (telefone, travado_em)
  values (p_telefone, now())
  on conflict (telefone) do update
    set travado_em = now()
    where whatsapp_locks.travado_em < now() - (p_ttl_segundos || ' seconds')::interval;
  get diagnostics linhas_afetadas = row_count;
  return linhas_afetadas > 0;
end;
$$;

-- Libera a trava assim que a mensagem terminar de ser processada, para que
-- a próxima mensagem desse telefone não precise esperar o TTL inteiro.
create or replace function liberar_travamento_telefone(p_telefone text)
returns void
language sql
as $$
  delete from whatsapp_locks where telefone = p_telefone;
$$;
