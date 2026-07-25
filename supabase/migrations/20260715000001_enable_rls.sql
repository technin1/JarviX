-- Ativa Row Level Security e define quem pode ler/escrever o quê.
-- Sem isso, a "anon key" usada no frontend teria acesso irrestrito às tabelas.

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.shared_projects enable row level security;
alter table public.uploads enable row level security;
alter table public.finetune_examples enable row level security;

-- profiles: qualquer um autenticado pode ver perfis (username público),
-- mas só o próprio dono edita o próprio perfil.
create policy "profiles são públicos para leitura"
  on public.profiles for select
  using (true);

create policy "usuário só edita o próprio perfil"
  on public.profiles for update
  using (auth.uid() = id);

create policy "usuário cria o próprio perfil"
  on public.profiles for insert
  with check (auth.uid() = id);

-- conversations/messages/memories/uploads: só o dono acessa
create policy "usuário só vê as próprias conversas"
  on public.conversations for all
  using (auth.uid() = user_id);

create policy "usuário só vê mensagens das próprias conversas"
  on public.messages for all
  using (
    conversation_id in (select id from public.conversations where user_id = auth.uid())
  );

create policy "usuário só vê as próprias memórias"
  on public.memories for all
  using (auth.uid() = user_id);

create policy "usuário só vê os próprios uploads"
  on public.uploads for all
  using (auth.uid() = user_id);

-- shared_projects: leitura pública quando is_public=true; dono sempre pode
-- ver/editar o próprio, mesmo que privado.
create policy "projetos públicos são visíveis a todos"
  on public.shared_projects for select
  using (is_public = true or auth.uid() = owner_id);

create policy "usuário só cria projeto como o próprio dono"
  on public.shared_projects for insert
  with check (auth.uid() = owner_id);

create policy "usuário só edita/apaga o próprio projeto"
  on public.shared_projects for update
  using (auth.uid() = owner_id);

create policy "usuário só apaga o próprio projeto"
  on public.shared_projects for delete
  using (auth.uid() = owner_id);

-- finetune_examples: dado sensível de curadoria — só o backend (service_role,
-- que ignora RLS) deve mexer aqui. Nenhuma policy pra usuários comuns =
-- ninguém autenticado via anon key consegue ler ou escrever.
