## Feature: Voice Conversation Pipeline

### Purpose

Enable real-time voice-based conversation between the user and an AI
that has deep context of a specific YouTube video. This is the core
interaction loop of Backtalk.

### Dependencies

- Requires: Supabase Auth (user must be authenticated)
- Requires: Video Ingestion Pipeline (video must be chunked + embedded)
- Requires: A conversation record in DB (conversation_id)
- External: Deepgram STT (nova-3), LLM provider (TBD), TTS provider (TBD)
- Provides: Real-time bidirectional voice interface over WebSocket

### Data Model

Relevant entities:

- conversations: { id, video_id, user_id, title, created_at }
- messages: { id, conversation_id, role ("user" | "assistant"), content, created_at }
- video_chunks: { id, video_id, text, start_time, embedding (vector) }

### API Surface

**WebSocket Endpoint:** `ws://localhost:8000/ws/audio`

Client → Server messages:

- Binary: Raw PCM audio (16-bit, 16kHz mono after resampling)

Server → Client messages:

- JSON: { type: "transcript", text: string, is_final: boolean }
- JSON: { type: "llm_response", text: string, is_final: boolean }
- Binary: TTS audio chunks for playback

**Connection lifecycle:**

1. Client opens WS with auth token
2. Server initializes Deepgram connection
3. Client streams audio → Server forwards to Deepgram
4. On final transcript → Server triggers RAG + LLM + TTS
5. Server streams TTS audio back to client
6. Repeat until client disconnects

### Behavior

**Happy path:**

- Given a user is in a chatroom for a processed video
- When the user presses "Start Recording" and speaks a question
- Then the UI shows interim transcripts in real-time
- And when the user pauses, a final transcript is produced
- And the backend retrieves relevant video chunks via similarity search
- And the LLM generates a contextual response
- And TTS audio streams back and plays in the browser
- And both user message and assistant response are persisted to DB

**Persona switching:** (FOR LATER)

- Given the user says "switch to tutor mode" (or similar)
- Then the system prompt for the LLM adjusts to the requested persona
- And subsequent responses reflect that persona's tone/style

### Edge Cases

- **No relevant chunks found:** LLM should still respond but caveat
  that the video may not cover this topic. Do NOT hallucinate content.
- **Deepgram disconnects mid-conversation:** Attempt reconnect once.
  If it fails, notify the user via JSON message
  { type: "error", code: "stt_disconnected" }
- **User speaks while TTS is still playing:** Audio should be captured
  but the system needs barge-in detection — stop current TTS playback,
  process the new utterance. (This is a stretch goal.)
- **Empty/silent audio:** If no speech detected for 30s, send a keepalive.
  Do NOT trigger LLM with empty transcript.
- **Very long utterance:** Cap transcript input to LLM at ~500 tokens
  to prevent context window issues. Summarize if needed.
- **Video not yet processed:** Return error JSON
  { type: "error", code: "video_not_ready" } and do not open
  Deepgram connection.
