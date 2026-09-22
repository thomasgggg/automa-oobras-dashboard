-- Viga / Canteiro — marca se cada registro veio interpretado pela IA
-- (Gemini) ou pelo parser de reserva por palavras-chave/regex.
-- Rode isto no SQL Editor do Supabase.

-- Sem essa coluna não dava para saber, olhando o painel, quando uma
-- mensagem do WhatsApp foi interpretada pela IA e quando caiu no parser de
-- reserva (por exemplo, numa instabilidade passageira da Gemini) — o que
-- ajudaria a perceber esse tipo de problema mais rápido da próxima vez.
alter table registros
  add column if not exists via_ia boolean;

-- Nenhuma política de RLS nova é necessária: a tabela "registros" já
-- restringe select/insert pela obra (e portanto pela empresa) do usuário
-- logado — esta coluna nova é só mais um campo dentro dessa mesma proteção.
