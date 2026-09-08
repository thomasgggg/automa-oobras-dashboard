-- Viga / Canteiro — configuração do "cérebro" da IA por empresa.
-- Rode isto no SQL Editor do Supabase (depois de já ter rodado
-- schema_whatsapp.sql e schema_empresas.sql).

-- Cada empresa pode escrever, em texto livre, instruções extras para a IA
-- que interpreta as mensagens do WhatsApp (tom de resposta, apelidos de
-- material, regras específicas do negócio, etc). Fica de fora do prompt
-- fixo (que continua garantindo as regras de segurança) e é somado a ele.
alter table empresas
  add column if not exists instrucoes_ia text;

-- Nenhuma política de RLS nova é necessária: a tabela "empresas" já tem
-- "editar minha empresa" (update) e "ver minha empresa" (select), que agora
-- cobrem também esta coluna nova — cada empresa só lê/edita a própria.
