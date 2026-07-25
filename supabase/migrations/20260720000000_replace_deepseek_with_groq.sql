-- Substituímos o provedor de fallback de IA: DeepSeek -> Groq.
-- Sem isso, gravar uma mensagem com source='groq' seria rejeitado pelo
-- CHECK constraint antigo (que só aceitava 'own_model' ou 'deepseek').
alter table public.messages
  drop constraint if exists messages_source_check;

alter table public.messages
  add constraint messages_source_check check (source in ('own_model', 'groq'));

-- Mensagens antigas gravadas como 'deepseek' continuam válidas como registro
-- histórico, mas não serão mais geradas — normalizamos o rótulo pra manter
-- os dados consistentes com o provedor atual.
update public.messages set source = 'groq' where source = 'deepseek';
