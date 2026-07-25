-- Preferências que o usuário define no Dashboard (tom de resposta, áreas de
-- foco, objetivo atual). O backend injeta isso como contexto em toda
-- conversa com a IA — ver backend/src/services/preferenceContext.js.
alter table public.profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb;

-- Formato esperado (não é um schema rígido, só o contrato usado pelo app):
-- {
--   "tone": "casual" | "formal" | "tecnico",
--   "focus": ["codigo", "produtividade", "negocios", "criativo", "dados", "suporte"],
--   "goal": "texto livre curto descrevendo o objetivo atual do usuário"
-- }
