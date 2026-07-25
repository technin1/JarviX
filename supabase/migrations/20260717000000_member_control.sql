-- Módulo "Member Control" — dados sensíveis (CPF, RG, CNH).
-- ATENÇÃO: dados de documento de identidade são categoria protegida pela
-- LGPD. Acesso é restrito a admins (via RLS abaixo). A foto da CNH fica em
-- bucket PRIVADO (member-documents), nunca público — crie-o manualmente no
-- dashboard do Supabase Storage com "Public bucket" DESLIGADO.

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text,
  whatsapp text,
  cpf text not null unique,
  rg text not null,
  cnh_number text not null,
  cnh_issue_date date not null,
  cnh_expiry_date date not null,
  cnh_photo_path text not null, -- caminho no bucket privado, não URL pública
  alerts_sent jsonb not null default '{}'::jsonb, -- ex: {"60": true, "30": false}
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists members_cnh_expiry_idx on public.members (cnh_expiry_date);

alter table public.members enable row level security;

-- Só admin lê e escreve. Nada de acesso "owner" aqui — é dado de terceiros
-- (o membro cadastrado não é necessariamente o usuário autenticado).
create policy "members_admin_all" on public.members
  for all using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  )
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );
