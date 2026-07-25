-- JarviX — Schema inicial do Supabase (Postgres + pgvector)
-- Rode isto no SQL editor do seu projeto Supabase.

create extension if not exists vector;

-- Usuários (complementa auth.users do Supabase Auth)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  avatar_url text,
  bio text,
  created_at timestamptz default now()
);

-- Conversas (uma "thread" de chat)
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  title text default 'Nova conversa',
  mode text default 'fullscreen' check (mode in ('fullscreen', 'mini')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Mensagens de uma conversa
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  source text default 'own_model' check (source in ('own_model', 'deepseek')),
  created_at timestamptz default now()
);

-- Memória vetorial (RAG) — fatos/preferências extraídos das conversas
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  content text not null,
  embedding vector(384), -- dimensão do modelo de embeddings (ajuste conforme o modelo usado)
  source_message_id uuid references public.messages(id),
  created_at timestamptz default now()
);

create index if not exists memories_embedding_idx
  on public.memories using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Função usada por memory/rag.py para buscar memórias por similaridade
create or replace function match_memories(
  query_embedding vector(384),
  match_user_id uuid,
  match_count int default 5
)
returns table (id uuid, content text, similarity float)
language sql stable
as $$
  select id, content, 1 - (embedding <=> query_embedding) as similarity
  from public.memories
  where user_id = match_user_id
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- Dataset de fine-tuning curado (o que alimenta o job de LoRA em lote)
create table if not exists public.finetune_examples (
  id uuid primary key default gen_random_uuid(),
  prompt text not null,
  completion text not null,
  approved boolean default false, -- curadoria antes de entrar no treino
  used_in_training_run text, -- id/versão do treino que já consumiu este exemplo
  created_at timestamptz default now()
);

-- Projetos/prompts compartilháveis entre usuários (camada social)
create table if not exists public.shared_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  prompt text,
  files_zip_url text, -- link pro zip gerado (Supabase Storage)
  is_public boolean default false,
  created_at timestamptz default now()
);

-- Arquivos enviados pelo usuário (uploads pra análise da IA)
create table if not exists public.uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id),
  file_url text not null,
  file_type text,
  analyzed boolean default false,
  created_at timestamptz default now()
);
