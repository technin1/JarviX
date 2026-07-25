-- Flag simples de admin, usada pelo middleware requireAdmin.js pra
-- proteger a curadoria de exemplos de fine-tuning.
alter table public.profiles
  add column if not exists is_admin boolean default false;

-- Depois de rodar esta migration, torne-se admin manualmente rodando
-- (troque pelo seu user_id, visível em Authentication > Users no Supabase):
--   update public.profiles set is_admin = true where id = 'SEU-USER-ID';
