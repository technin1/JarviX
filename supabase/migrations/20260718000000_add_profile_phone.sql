-- Telefone agora é coletado no cadastro (ver frontend/public/index.html,
-- formulário de signup).
alter table public.profiles
  add column if not exists phone text;
