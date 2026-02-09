-- ============================================
-- 1. ENABLE PGVECTOR
-- ============================================
-- This extension adds the "vector" data type to Postgres,
-- allowing us to store and query embeddings directly in the database.
-- Without this, we'd need a separate vector database like Pinecone.
create extension if not exists vector with schema public;


-- ============================================
-- 2. VIDEOS TABLE
-- ============================================
-- Stores each YouTube video a user has added.
-- We keep youtube_url unique per user so the same user
-- can't add the same video twice (but different users can).
create table videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  youtube_url text not null,
  title text,
  created_at timestamptz default now() not null
);

-- Add a unique constraint: one user can't add the same video twice
alter table videos
  add constraint unique_user_video unique (user_id, youtube_url);


-- ============================================
-- 3. VIDEO_CHUNKS TABLE
-- ============================================
-- Stores embedded transcript chunks for each video.
-- The "embedding" column uses pgvector's vector(1536) type,
-- which matches OpenAI's text-embedding-3-small output dimensions.
-- This replaces the in-memory video_chunks_cache dict in server.py.
create table video_chunks (
  id uuid primary key default gen_random_uuid(),
  video_id uuid references videos(id) on delete cascade not null,
  text text not null,
  start_time float not null,
  embedding vector(1536) not null
);


-- ============================================
-- 4. CONVERSATIONS TABLE
-- ============================================
-- Each conversation is tied to one video and one user.
-- These show up in the sidebar, like ChatGPT's conversation list.
-- The title gets auto-generated from the first message
-- (you'll do this in your server code).
create table conversations (
  id uuid primary key default gen_random_uuid(),
  video_id uuid references videos(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text default 'New Conversation',
  created_at timestamptz default now() not null
);


-- ============================================
-- 5. MESSAGES TABLE
-- ============================================
-- Every message in every conversation, ordered by created_at.
-- Role is either 'user' or 'assistant'.
-- This replaces the in-memory conversation_history list.
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now() not null
);


-- ============================================
-- 6. VECTOR SIMILARITY SEARCH FUNCTION
-- ============================================
-- This is a Postgres function that performs cosine similarity search.
-- It replaces the Python cosine_similarity loop in rag.py.
--
-- How it works:
-- - Takes a query embedding and a video_id
-- - Uses the <=> operator (cosine distance) to find closest chunks
-- - Returns the top match_count chunks, ordered by similarity
--
-- The <=> operator returns cosine DISTANCE (0 = identical, 2 = opposite),
-- so we subtract from 1 to get similarity (1 = identical, -1 = opposite).
create or replace function match_video_chunks(
  query_embedding vector(1536),
  target_video_id uuid,
  match_count int default 3
)
returns table (
  id uuid,
  text text,
  start_time float,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    vc.id,
    vc.text,
    vc.start_time,
    1 - (vc.embedding <=> query_embedding) as similarity
  from video_chunks vc
  where vc.video_id = target_video_id
  order by vc.embedding <=> query_embedding
  limit match_count;
end;
$$;


-- ============================================
-- 7. ROW LEVEL SECURITY (RLS)
-- ============================================
-- RLS ensures users can only access their own data.
-- Without this, any authenticated user could read/write
-- anyone else's conversations and videos.
--
-- Supabase requires RLS to be enabled on all tables.
-- Each policy defines WHO can do WHAT.

-- Videos: users can only see and create their own
alter table videos enable row level security;

create policy "Users can view own videos"
  on videos for select
  using (auth.uid() = user_id);

create policy "Users can insert own videos"
  on videos for insert
  with check (auth.uid() = user_id);

-- Video chunks: readable if user owns the parent video
alter table video_chunks enable row level security;

create policy "Users can view chunks of own videos"
  on video_chunks for select
  using (
    video_id in (
      select id from videos where user_id = auth.uid()
    )
  );

create policy "Users can insert chunks for own videos"
  on video_chunks for insert
  with check (
    video_id in (
      select id from videos where user_id = auth.uid()
    )
  );

-- Conversations: users can only see and create their own
alter table conversations enable row level security;

create policy "Users can view own conversations"
  on conversations for select
  using (auth.uid() = user_id);

create policy "Users can insert own conversations"
  on conversations for insert
  with check (auth.uid() = user_id);

-- Messages: readable/writable if user owns the parent conversation
alter table messages enable row level security;

create policy "Users can view messages in own conversations"
  on messages for select
  using (
    conversation_id in (
      select id from conversations where user_id = auth.uid()
    )
  );

create policy "Users can insert messages in own conversations"
  on messages for insert
  with check (
    conversation_id in (
      select id from conversations where user_id = auth.uid()
    )
  );


-- ============================================
-- 8. INDEXES FOR PERFORMANCE
-- ============================================
-- Speed up common queries. Without indexes, Postgres would
-- scan every row in the table for each query.

-- Fast lookup of chunks by video
create index idx_video_chunks_video_id on video_chunks(video_id);

-- Fast lookup of conversations by user (for the sidebar)
create index idx_conversations_user_id on conversations(user_id);

-- Fast lookup of messages by conversation
create index idx_messages_conversation_id on messages(conversation_id);

-- Vector index for similarity search (IVFFlat).
-- This makes embedding searches much faster than brute-force.
-- The lists=100 parameter controls the number of clusters —
-- for small datasets you could use fewer, but 100 is a safe default.
create index idx_video_chunks_embedding
  on video_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);