## Feature: Conversation Interface UI

### Purpose

Provide a real-time, voice-first chat interface where users can have spoken conversations about YouTube videos with an AI assistant. This is the primary UI surface of Backtalk — where users spend their time learning through voice interaction.

The interface must feel **responsive and alive** — users should see immediate visual feedback for every state (recording, processing, AI speaking) and see transcripts and responses appear in real-time as they stream in.

### Dependencies

- **Requires:** Supabase Auth (user must be authenticated to access conversation page)
- **Requires:** Voice Conversation Pipeline (backend WebSocket at `ws://localhost:8000/ws/audio`)
- **Requires:** useAudioCapture hook (`hooks/useAudioCapture.ts`)
- **Requires:** Conversation record in DB (passed via route param `/conversation/[id]`)
- **Requires:** Video already processed (chunks + embeddings stored)
- **Provides:** Complete voice conversation experience with visual feedback

### Component Architecture

**Page:** `app/conversation/[id]/page.tsx`

**Layout Pattern:**
```
<SidebarProvider>
  <AppSidebar currentConversationId={id} />
  <SidebarInset>
    <ConversationHeader />      ← Video title, metadata
    <MessageList />             ← Scrollable message history
    <LiveTranscriptDisplay />   ← Shows current user speech (interim + final)
    <VoiceControls />           ← Record button with visual state
  </SidebarInset>
</SidebarProvider>
```

**Component Responsibilities:**

1. **ConversationHeader**
   - Displays video title and thumbnail (fetched from Supabase conversations table)
   - Shows conversation metadata (created date, message count)
   - Sticky at top of conversation view

2. **MessageList**
   - Scrollable container showing conversation history
   - Messages fetched from Supabase `messages` table on mount
   - Auto-scrolls to bottom when new messages arrive
   - Displays both user and assistant messages with distinct styling
   - Each message shows: role (user/assistant), content, timestamp

3. **LiveTranscriptDisplay**
   - Shows real-time transcript as user speaks
   - Two text types:
     - **Interim text** (gray, italic): "what is mach..."
     - **Final text** (normal): accumulated complete phrases
   - Clears when LLM response begins
   - Visual indicator: microphone icon or waveform animation

4. **VoiceControls**
   - Large, prominent record button (primary interaction)
   - Button appearance changes based on UI state:
     - **Idle**: "Start Recording" (blue)
     - **Recording**: "Recording..." (red, pulsing)
     - **Processing**: "Processing..." (yellow, spinner)
     - **AI Speaking**: "AI Speaking..." (green, disabled)
     - **Error**: "Error - Try Again" (red)
   - Keyboard shortcut: Spacebar to start/stop (when focused)

5. **LLM Response Streaming Display**
   - Not a separate component — appears in MessageList
   - As LLM tokens arrive, they're appended to the current assistant message
   - Shows typing indicator before first token arrives
   - Smooth text appearance (no janky re-renders)

### UI State Machine

The conversation interface has five primary states:

```
     [user clicks record]
IDLE ──────────────────────► RECORDING
                                │
                                │ [final transcript received]
                                ▼
                            PROCESSING
                                │
                                │ [first LLM token arrives]
                                ▼
                           AI_SPEAKING
                                │
                                │ [LLM response complete]
                                ▼
                              IDLE

                            ERROR ──► (can transition back to IDLE on retry)
```

**State Definitions:**

- **IDLE**: Waiting for user to start recording. Record button enabled.
- **RECORDING**: Mic is active, audio streaming to backend, showing live transcripts.
- **PROCESSING**: User finished speaking (final transcript sent), waiting for LLM to respond.
- **AI_SPEAKING**: LLM response is streaming in. Record button disabled (no interruption for now).
- **ERROR**: WebSocket disconnected, auth failed, or other error. Show error message and retry option.

**State Transitions:**

| From | To | Trigger |
|------|-----|---------|
| IDLE | RECORDING | User clicks record button |
| RECORDING | IDLE | User clicks stop button |
| RECORDING | PROCESSING | Final transcript received + pause detected (backend handles this) |
| PROCESSING | AI_SPEAKING | First LLM token arrives via WebSocket |
| AI_SPEAKING | IDLE | LLM response complete (`done: true`) |
| Any | ERROR | WebSocket error, auth failure, etc. |
| ERROR | IDLE | User clicks retry or error clears |

### WebSocket Message Handling

The conversation interface consumes messages from the backend via the `useAudioCapture` hook.

**Message Types Received:**

1. **Transcript Message**
   ```json
   {
     "type": "transcript",
     "text": "what is machine learning",
     "is_final": true
   }
   ```
   - **Frontend action:**
     - If `is_final: false` → update interim transcript display (gray text)
     - If `is_final: true` → append to final transcript buffer, update display
     - When all final transcripts accumulate and pause is detected, backend triggers LLM (no frontend action needed)

2. **LLM Response Message**
   ```json
   {
     "type": "llm_response",
     "text": "Machine learning is",
     "done": false
   }
   ```
   - **Frontend action:**
     - State transition: PROCESSING → AI_SPEAKING (on first token)
     - Accumulate tokens into current assistant message
     - Re-render message display with new text

   **LLM Complete Message:**
   ```json
   {
     "type": "llm_response",
     "text": "",
     "done": true
   }
   ```
   - **Frontend action:**
     - State transition: AI_SPEAKING → IDLE
     - Finalize assistant message in UI
     - Persist message to Supabase (optional — backend may handle this)
     - Re-enable record button

**Message Flow Example:**

```
User speaks → [transcript interim] → [transcript interim] → [transcript final]
                     ↓                      ↓                       ↓
              Update display         Update display          Accumulate

Backend detects pause → triggers LLM

[llm_response token] → [llm_response token] → [llm_response done]
         ↓                      ↓                       ↓
   Append to msg          Append to msg         Finalize msg
```

### User Interactions

**Primary Interaction: Voice Recording**

1. User clicks "Start Recording" button
   - Frontend: Call `useAudioCapture.start(onChunk, onTranscript, onLlmResponse)`
   - State: IDLE → RECORDING
   - Visual: Button turns red, shows "Recording...", mic icon pulsing

2. User speaks, sees live transcript
   - Frontend: Displays interim and final transcripts in real-time
   - No state change

3. User stops speaking (pause detected by backend)
   - Backend triggers LLM automatically after 2-second pause
   - State: RECORDING → PROCESSING
   - Visual: Button shows "Processing...", spinner icon

4. LLM response streams in
   - State: PROCESSING → AI_SPEAKING
   - Visual: Button shows "AI Speaking...", disabled
   - Message appears in chat, tokens accumulate

5. Response complete
   - State: AI_SPEAKING → IDLE
   - Visual: Button returns to "Start Recording"
   - User can ask follow-up question

**Secondary Interactions:**

- **Stop recording manually:** User clicks record button while in RECORDING state → call `useAudioCapture.stop()` → return to IDLE
- **Keyboard shortcut:** Spacebar toggles recording (only when button is focused and enabled)
- **Scroll messages:** User can scroll through message history at any time
- **View video context:** Click video title/thumbnail to open YouTube video in new tab (optional)

### Visual Feedback Requirements

**1. Recording State Indicator**
- Pulsing red circle or microphone icon
- Waveform animation (optional enhancement)
- Live word count or duration timer

**2. Processing State**
- Spinner or loading animation
- Text: "Thinking..." or "Processing..."
- Slightly dimmed background (optional)

**3. AI Speaking State**
- Typing indicator before first token
- Smooth text streaming (no flicker)
- Green accent or speaking icon
- Cursor/caret at end of text (optional)

**4. Live Transcript Display**
- Interim text: gray, italic, smaller font
- Final text: normal weight, accumulated
- Clear visual separation from message history
- Auto-clears when LLM starts responding

**5. Message History Styling**
- User messages: right-aligned, blue background
- Assistant messages: left-aligned, gray background
- Timestamps in muted text
- Smooth scroll to bottom on new message

**6. Error States**
- Red error banner at top of conversation
- Specific error messages:
  - "Connection lost. Reconnecting..."
  - "Authentication expired. Please log in again."
  - "Failed to process audio. Please try again."
- Retry button or auto-retry with countdown

### Message Display & Persistence

**On Page Load:**
1. Fetch conversation details from Supabase:
   ```ts
   const { data: conversation } = await supabase
     .from('conversations')
     .select('id, title, video_id')
     .eq('id', conversationId)
     .single()
   ```

2. Fetch message history:
   ```ts
   const { data: messages } = await supabase
     .from('messages')
     .select('id, role, content, created_at')
     .eq('conversation_id', conversationId)
     .order('created_at', { ascending: true })
   ```

3. Render messages in MessageList component

**During Conversation:**
- User utterances and LLM responses are accumulated in local state
- **Backend responsibility:** Persist messages to Supabase `messages` table
- **Frontend responsibility:** Display messages in real-time, keep UI in sync

**Message Streaming:**
- Create a new assistant message object when first LLM token arrives
- Append each token to `message.content`
- Re-render on each token (React state update)
- Mark as complete when `done: true` received

### Edge Cases

**1. WebSocket Disconnection Mid-Conversation**
- **Detection:** `useAudioCapture` hook detects WS close event
- **Action:**
  - State → ERROR
  - Display: "Connection lost. Please refresh or try again."
  - Option: Auto-reconnect once after 2 seconds
  - If reconnect fails, show manual refresh prompt

**2. User Leaves Page During Recording**
- **Action:** Call `useAudioCapture.stop()` in `useEffect` cleanup
- **Reason:** Prevents mic staying open, prevents orphaned WebSocket connection

**3. Authentication Expires During Conversation**
- **Detection:** Backend closes WS with code 1008 (policy violation)
- **Action:**
  - State → ERROR
  - Display: "Session expired. Redirecting to login..."
  - Redirect to `/login` after 2 seconds

**4. Empty or Silent Utterance**
- **Backend handles:** Won't trigger LLM if transcript is empty
- **Frontend:** If stuck in PROCESSING for >10 seconds, show "No speech detected" and return to IDLE

**5. Very Long Utterance (>500 tokens)**
- **Backend handles:** Caps transcript length before sending to LLM
- **Frontend:** Display full transcript in UI (no truncation)

**6. User Speaks While LLM is Responding**
- **Current behavior:** Record button disabled during AI_SPEAKING state
- **Future enhancement:** Implement barge-in detection (see below)

**7. Video Not Yet Processed**
- **Detection:** Backend should check before accepting WS connection
- **Action:** If WS closes immediately with error, show:
  - "Video is still processing. Please wait and try again in a moment."
  - Return to home page or show loading spinner

**8. Rapid Button Clicks**
- **Prevention:** Disable button during state transitions
- **Debounce:** Ignore clicks if state is PROCESSING or AI_SPEAKING

**9. Network Lag / Slow Responses**
- **Timeout:** If in PROCESSING state for >30 seconds, show error:
  - "Response is taking longer than expected. Please try again."
- **Visual:** Show spinner or progress indicator during wait

**10. Browser Mic Permissions Denied**
- **Detection:** `navigator.mediaDevices.getUserMedia()` throws error
- **Action:**
  - Show error: "Microphone access denied. Please enable it in browser settings."
  - Provide instructions link (browser-specific)
  - Disable record button until permissions granted

### Future Enhancements

**1. TTS Audio Playback** (Next Priority)
- Receive binary/base64 audio data from WebSocket (new message type)
- Decode and play using Web Audio API
- Visual indicator: speaker icon, audio waveform
- Challenge: Synchronize text display with audio playback
- See: `docs/feature-specs/tts_audio_playback.md` (to be created)

**2. Barge-In Detection**
- Allow user to interrupt AI while it's speaking
- When user clicks record during AI_SPEAKING:
  - Stop TTS playback immediately
  - Clear current LLM response (or mark as interrupted)
  - State: AI_SPEAKING → RECORDING
- Requires: TTS audio playback system

**3. Message Actions**
- Copy message text to clipboard
- Regenerate response (re-trigger LLM with same user message)
- Edit user message and resend (advanced)

**4. Conversation Export**
- Download transcript as .txt or .md
- Include timestamps and role labels
- Option to include video title and metadata

**5. Keyboard Shortcuts**
- `Space`: Start/stop recording (when focused)
- `Cmd/Ctrl + K`: Focus search (future feature)
- `Esc`: Stop recording + cancel

**6. Conversation Summary**
- Auto-generate summary after N messages
- Display at top of message list
- Helps user recall what was discussed

**7. Visual Waveform During Recording**
- Real-time audio visualization using Web Audio API
- Shows user their voice is being captured
- Better feedback than static icon

**8. Mobile-Optimized Voice Controls**
- Larger touch targets
- Hold-to-record pattern (common on mobile)
- Haptic feedback on recording start/stop (if available)

**9. Multi-Turn Context Indicators**
- Show which video chunks were used for each response (optional)
- "Referenced: 0:45-1:15 in video"
- Helps user understand AI's grounding

**10. Offline Mode / Graceful Degradation**
- Cache conversation history locally
- Show "offline" indicator if no connection
- Queue messages to send when reconnected (advanced)

---

### Implementation Checklist

When building this feature, implement in this order:

- [ ] Create ConversationHeader component (video title display)
- [ ] Create MessageList component with Supabase data fetching
- [ ] Create VoiceControls component with state machine logic
- [ ] Create LiveTranscriptDisplay component
- [ ] Integrate useAudioCapture hook with callbacks
- [ ] Implement WebSocket message handling (transcript + llm_response)
- [ ] Add visual feedback for all states (loading, recording, etc.)
- [ ] Implement error handling and retry logic
- [ ] Add keyboard shortcuts (spacebar for record toggle)
- [ ] Test edge cases (disconnection, auth expiration, empty speech)
- [ ] Polish animations and transitions
- [ ] Add TTS audio playback (future milestone)
