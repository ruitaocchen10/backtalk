Backtalk — Architecture Document

Last Updated: February 8, 2026
Version: 0.1.0 (pre-production)
Status: Active development

1. Product Overview
   Backtalk is a voice-first AI learning companion that lets users talk about YouTube videos as if they were speaking with a knowledgeable friend. Instead of passively consuming content, users engage in active, conversational learning through real-time voice interaction.
   Core product insight: Learning sticks better when it feels like talking to a smart friend — not reading notes or clicking flashcards.

1.1 Key User Capabilities

Ask questions about video content out loud
Get real-time spoken responses grounded in video context
Explore missed concepts through follow-up conversation
Play conversational "knowledge games" (trivia, explain-back moments) (for later)
Switch between personas (tutor, casual friend, analyst, etc.) (for later)

1.2 Why Voice is Primary

Reinforces recall through active articulation
Encourages curiosity via natural back-and-forth
Lowers friction compared to typing
Enables hands-free learning

2. Architecture Style
   Backtalk follows a two-process, event-driven architecture with a clear frontend/backend split connected via WebSockets.

┌─────────────────────┐ WebSocket (ws) ┌─────────────────────┐
│ Next.js Frontend │ ◄──────────────────────────────► │ FastAPI Backend │
│ (Browser Client) │ Binary audio + JSON msgs │ (Python Server) │
└─────────────────────┘ └─────────────────────┘
│
┌─────────────┼─────────────┐
▼ ▼ ▼
External AI Supabase YouTube API
Services (Postgres)
(STT/LLM/TTS) (pgvector)
Why this split: The frontend handles audio capture and playback (browser APIs). The backend handles all AI orchestration, because STT/LLM/TTS services require server-side API keys and the orchestration logic (RAG retrieval, prompt construction, streaming coordination) is complex enough to warrant a dedicated process.
Communication pattern: WebSocket is used instead of REST because the voice pipeline requires bidirectional, low-latency, streaming communication. Audio chunks flow client→server continuously, while transcripts and TTS audio flow server→client as they become available.

3. Tech Stack

Frontend - Next.js (App Router, React 19, TypeScript)
UI Components - shadcn/ui (New York style) + Radix UI + Tailwind CSSPre-built accessible components, consistent design system
Icons - Lucide ReactLightweight, consistent icon set
Backend - Python (FastAPI) Async-native, WebSocket support, strong AI/ML library ecosystem
Real - timeWebSockets (native FastAPI + browser API)Bidirectional streaming for voice pipeline
Speech-to-Text - Deepgram (Nova-3) Real-time streaming STT with interim results
LLM - gpt-4o-mini - Must support streaming token output
Text-to-Speech - Deepgram
Embeddings - OpenAI text-embedding-small Cost-effective, good quality for RAG
Database - Supabase (Postgres + pgvector) Auth, relational data, vector similarity search

4. Data Model

-- Managed by Supabase Auth (automatic)
users
id uuid PRIMARY KEY (from Supabase Auth)

-- Core entities
videos
id uuid PRIMARY KEY
youtube_url text NOT NULL
title text
user_id uuid REFERENCES users(id)
created_at timestamptz DEFAULT now()

video_chunks
id uuid PRIMARY KEY
video_id uuid REFERENCES videos(id)
text text NOT NULL
start_time float -- timestamp in video (seconds)
embedding vector(1536) -- OpenAI text-embedding-small dimensions
-- INDEX: ivfflat or hnsw on embedding column for similarity search

conversations
id uuid PRIMARY KEY
video_id uuid REFERENCES videos(id)
user_id uuid REFERENCES users(id)
title text
created_at timestamptz DEFAULT now()

messages
id uuid PRIMARY KEY
conversation_id uuid REFERENCES conversations(id)
role text CHECK (role IN ('user', 'assistant'))
content text NOT NULL
created_at timestamptz DEFAULT now()

5. System Diagram

graph TB
subgraph Frontend ["Frontend (Next.js)"]
UI[UI — Chat / Voice Interface]
AC[useAudioCapture Hook]
AP[AudioWorklet Processor]
PLAY[Audio Playback]
end

    subgraph Backend ["Backend (FastAPI)"]
        WS[WebSocket Handler /ws/audio]
        RAG[RAG Pipeline]
        ORCH[Conversation Orchestrator]
    end

    subgraph ExternalAI ["External AI Services"]
        STT[Deepgram STT]
        LLM[GPT-4o-mini]
        TTS[Deepgram TTS]
    end

    subgraph Supabase ["Supabase"]
        AUTH[Auth]
        DB[(Postgres DB)]
        VEC[(pgvector — Embeddings)]
    end

    subgraph Ingestion ["Video Ingestion Pipeline"]
        YT[YouTube API — Transcript Fetch]
        CHUNK[Chunker — by Timestamp]
        EMBED[OpenAI Embedding — text-embedding-small]
    end
