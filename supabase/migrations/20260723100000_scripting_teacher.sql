-- Scripting Teacher — módulo de treinamento de digitação de código.
--
-- Modelo mental:
--   "Now"      -> a sessão de trabalho atual. Só existe UMA linha com
--                 status='now' por usuário (índice único parcial abaixo).
--                 É nela que o editor (painel superior) lê/escreve.
--   "history"  -> sessões finalizadas (via "New Session" -> salvar, ou
--                 carregadas de Sessions/Last Session/Archives/Projects).
--                 As últimas 5 aparecem em "Sessions"; a mais recente com
--                 is_last=true aparece em "Last Session".
create table if not exists public.scripting_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  title text default 'Sessão sem título',
  language text default 'javascript',
  content text default '', -- texto renderizado atual (fantasma + o que já foi sobrescrito + extra)
  ghost_content text default '', -- código-fantasma da IA que serviu de base
  cursor_pos integer default 0, -- posição de digitação, pra retomar exatamente de onde parou
  status text not null default 'now' check (status in ('now', 'history')),
  is_last boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Só pode existir 1 sessão "now" por usuário — upsert (ver rota /scripting/now)
-- depende disso pra saber se cria ou atualiza.
create unique index if not exists scripting_sessions_one_now_per_user
  on public.scripting_sessions (user_id)
  where (status = 'now');

create index if not exists scripting_sessions_history_idx
  on public.scripting_sessions (user_id, created_at desc)
  where (status = 'history');

-- My Archives — exportações "congeladas" do conteúdo de uma sessão.
-- Limite de 15 é aplicado na rota (backend/src/routes/scriptingTeacher.js),
-- não aqui, pra poder devolver uma mensagem de erro amigável ao invés de
-- estourar uma constraint crua do Postgres.
create table if not exists public.scripting_archives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  session_id uuid references public.scripting_sessions(id) on delete set null,
  filename text not null,
  language text default 'javascript',
  content text not null,
  created_at timestamptz default now()
);

-- Projects — upload de projetos compilados em .zip. O zip em si vai pro
-- Storage (bucket "scripting-projects"); aqui só ficam metadados + a lista
-- de entradas do zip (nome de cada arquivo), pra montar a árvore no frontend
-- sem precisar baixar o zip inteiro de novo a cada clique.
create table if not exists public.scripting_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  zip_path text not null, -- caminho dentro do bucket scripting-projects
  entries jsonb default '[]', -- [{ "path": "src/index.js", "size": 1234 }, ...]
  created_at timestamptz default now()
);

alter table public.scripting_sessions enable row level security;
alter table public.scripting_archives enable row level security;
alter table public.scripting_projects enable row level security;

create policy "usuário só vê/edita as próprias sessões de scripting"
  on public.scripting_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "usuário só vê/edita os próprios arquivos em My Archives"
  on public.scripting_archives for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "usuário só vê/edita os próprios projetos de scripting"
  on public.scripting_projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Lembrete: crie o bucket "scripting-projects" no Supabase Storage
-- (privado, não público — diferente do bucket "uploads") e replique as
-- policies de storage já usadas para CNH (acesso restrito ao próprio dono
-- via prefixo `${user_id}/...` no caminho do objeto).
