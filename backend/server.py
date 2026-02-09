import websockets
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import os
import asyncio
from dotenv import load_dotenv
from supabase_client import supabase

from pipeline.rag import (
    fetch_transcript,
    chunk_by_timestamp,
    embed_chunks,
    get_or_create_video,
    get_chunks_from_db,
    store_chunks_in_db,
    retrieve_relevant_chunks_from_db,
    get_video_by_url,
    get_conversation_by_video,
    create_conversation,
    get_conversation_by_id,
    load_conversation_history,
    save_message
)
from pipeline.llm import stream_llm_response

load_dotenv()

app = FastAPI()

# Configure CORS to allow requests from the Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Next.js dev server
    allow_credentials=True,
    allow_methods=["*"],  # Allow all HTTP methods
    allow_headers=["*"],  # Allow all headers
)

DEEPGRAM_URL = "wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&model=nova-3&interim_results=true"


# Pydantic models for REST API
class CreateConversationRequest(BaseModel):
    youtube_url: str


class CreateConversationResponse(BaseModel):
    conversation_id: str
    video_id: str
    title: str


def verify_supabase_token(token: str) -> str | None:
    """
    Verify Supabase JWT token using Supabase client and return user_id.
    Returns None if token is invalid.
    """
    try:
        # Use Supabase client to verify the token
        # This properly handles ES256 and other algorithms
        response = supabase.auth.get_user(token)

        if response.user:
            user_id = response.user.id
            print(f"Successfully verified token for user: {user_id}")
            return user_id
        else:
            print("ERROR: No user found in token response")
            return None

    except Exception as e:
        print(f"Token verification failed: {type(e).__name__}: {e}")
        return None


async def load_video_context(user_id: str, video_url: str, title: str = None) -> str:
    """
    Ensure video chunks are in Supabase. Returns video_id.
    """
    # Get or create the video record in DB
    video_id = get_or_create_video(user_id, video_url, title)

    # Check if we've already processed this video
    if get_chunks_from_db(video_id):
        print(f"Chunks already exist in DB for video {video_id}")
        return video_id

    # If not, process the video
    print(f"Processing and embedding video: {video_url}")
    transcript, video_title = fetch_transcript(video_url)
    chunks = chunk_by_timestamp(transcript, seconds_per_chunk=30)
    chunks = await embed_chunks(chunks)

    # Store in Supabase
    store_chunks_in_db(video_id, chunks)
    print(f"Stored {len(chunks)} chunks for video {video_id}")

    return video_id


@app.post("/api/conversations/create", response_model=CreateConversationResponse)
async def create_conversation_endpoint(
    request: CreateConversationRequest,
    authorization: str = Header(None)
):
    """
    Create a new conversation for a YouTube video.

    1. Verifies user authentication via JWT token
    2. Checks if video/conversation already exists
    3. Processes video (transcript + embeddings) if new
    4. Creates conversation record
    5. Returns conversation_id, video_id, and title
    """
    # Extract and verify JWT token
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    token = authorization.replace("Bearer ", "")
    user_id = verify_supabase_token(token)

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # Validate YouTube URL
    youtube_url = request.youtube_url.strip()
    if not youtube_url:
        raise HTTPException(status_code=400, detail="YouTube URL is required")

    try:
        # Check if video already exists for this user
        existing_video = get_video_by_url(user_id, youtube_url)

        if existing_video:
            # Video exists, check if conversation already exists
            existing_conversation = get_conversation_by_video(user_id, existing_video["id"])

            if existing_conversation:
                # Return existing conversation
                print(f"Returning existing conversation {existing_conversation['id']}")
                return CreateConversationResponse(
                    conversation_id=existing_conversation["id"],
                    video_id=existing_video["id"],
                    title=existing_conversation["title"] or existing_video["title"] or "Untitled"
                )

        # Video is new or no conversation exists yet - process it
        print(f"Processing new video: {youtube_url}")

        # Fetch transcript and get video title
        _, video_title = fetch_transcript(youtube_url)
        title = video_title or "Untitled Video"

        # Process video (creates/gets video record and stores embeddings)
        video_id = await load_video_context(user_id, youtube_url, title)

        # Create new conversation
        conversation_id = create_conversation(user_id, video_id, title)

        print(f"Created conversation {conversation_id} for video {video_id}")

        return CreateConversationResponse(
            conversation_id=conversation_id,
            video_id=video_id,
            title=title
        )

    except Exception as e:
        print(f"Error creating conversation: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create conversation: {str(e)}")


@app.websocket("/ws/audio")
async def audio_ws(websocket: WebSocket):
    # Extract token AND conversation_id from query params
    token = websocket.query_params.get("token")
    conversation_id = websocket.query_params.get("conversation_id")

    if not token:
        await websocket.close(code=1008, reason="Missing auth token")
        return

    if not conversation_id:
        await websocket.close(code=1008, reason="Missing conversation_id")
        return

    # Verify token and get user_id
    user_id = verify_supabase_token(token)

    if not user_id:
        await websocket.close(code=1008, reason="Invalid auth token")
        return

    await websocket.accept()
    print(f"Client connected (user: {user_id}, conversation: {conversation_id})")

    # Fetch conversation from database
    conversation = get_conversation_by_id(conversation_id, user_id)
    if not conversation:
        await websocket.close(code=1008, reason="Conversation not found")
        return

    video_id = conversation["video_id"]
    print(f"Using video_id: {video_id} for conversation: {conversation_id}")

    # Load conversation history from database (not empty list)
    conversation_history = load_conversation_history(conversation_id)
    print(f"Loaded {len(conversation_history)} previous messages")

    utterance_buffer: str = ""
    pause_timer: asyncio.TimerHandle | None = None
    PAUSE_TIMEOUT = 2  # seconds

    # Video chunks are already in DB (loaded during conversation creation)
    # No need to call load_video_context here

    async def trigger_llm(user_text: str):
        nonlocal conversation_history

        print(f"User said: {user_text}")

        # Step 1: Find relevant video chunks for what the user asked.
        relevant_chunks = await retrieve_relevant_chunks_from_db(
            user_text, video_id, top_k=3
        )
        print(f"Retrieved {len(relevant_chunks)} relevant chunks")

        # Step 2: Stream LLM response back to the browser.
        full_response = ""

        async for token in stream_llm_response(
            user_text, relevant_chunks, conversation_history
        ):
            full_response += token
            # Send each token to the browser as it arrives.
            # The frontend will accumulate these into the displayed response.
            await websocket.send_json({
                "type": "llm_response",
                "text": token,
                "done": False
            })

        # Signal to the frontend that the response is complete.
        # This lets the UI know to finalize the message display.
        await websocket.send_json({
            "type": "llm_response",
            "text": "",
            "done": True
        })

        print(f"LLM response: {full_response[:100]}...")

        # Step 3: Persist messages to database AND append to conversation history
        save_message(conversation_id, "user", user_text)
        save_message(conversation_id, "assistant", full_response)

        conversation_history.append({"role": "user", "content": user_text})
        conversation_history.append({"role": "assistant", "content": full_response})

        print(f"Saved messages to DB for conversation {conversation_id}")

    # ---- Deepgram connection and transcript handling ----
    extra_headers = {
        "Authorization": f"Token {os.getenv('DEEPGRAM_API_KEY')}"
    }

    async with websockets.connect(DEEPGRAM_URL, additional_headers=extra_headers) as dg_ws:
        print("Deepgram connection opened")

        async def forward_transcripts():
            """
            Listens for messages from Deepgram and handles them.
            
            For interim results: forward to browser immediately (live feedback).
            For final results: accumulate in the utterance buffer and
            start/reset a pause timer. When the timer fires (user stopped
            speaking), trigger the LLM with the full utterance.
            """
            nonlocal utterance_buffer, pause_timer

            try:
                async for message in dg_ws:
                    data = json.loads(message)
                    transcript = data["channel"]["alternatives"][0]["transcript"]

                    if not transcript:
                        continue

                    is_final = data.get("is_final", False)

                    # Always forward to browser so the user sees live text
                    await websocket.send_json({
                        "type": "transcript",
                        "text": transcript,
                        "is_final": is_final
                    })

                    if is_final:
                        # Append to our utterance buffer.
                        # Deepgram sends final results in fragments like:
                        #   "what is" (final) → "machine learning" (final)
                        # We combine them into: "what is machine learning"
                        utterance_buffer += " " + transcript

                        # Cancel any existing pause timer — the user is
                        # still speaking. We'll start a fresh timer.
                        if pause_timer is not None:
                            pause_timer.cancel()

                        # Start a new pause timer. If no more final
                        # transcripts arrive within PAUSE_TIMEOUT seconds,
                        # the timer fires and we trigger the LLM.
                        #
                        # asyncio.get_event_loop().call_later() schedules
                        # a callback after a delay. But since trigger_llm
                        # is async, we wrap it with ensure_future.
                        loop = asyncio.get_event_loop()

                        def on_pause():
                            nonlocal utterance_buffer, pause_timer
                            text = utterance_buffer.strip()
                            utterance_buffer = ""
                            pause_timer = None
                            if text:
                                # ensure_future schedules an async function
                                # to run without awaiting it here. This is
                                # necessary because call_later only accepts
                                # regular (non-async) callbacks.
                                asyncio.ensure_future(trigger_llm(text))

                        pause_timer = loop.call_later(PAUSE_TIMEOUT, on_pause)

            except websockets.exceptions.ConnectionClosed:
                print("Deepgram connection closed")

        # Run transcript listener as a background task.
        # This runs concurrently with the audio forwarding loop below.
        # Two things happen simultaneously:
        #   1. forward_transcripts: Deepgram → browser (transcripts + LLM)
        #   2. while loop below: browser → Deepgram (audio)
        transcript_task = asyncio.create_task(forward_transcripts())

        try:
            while True:
                # Receive raw audio bytes from the browser and
                # forward them directly to Deepgram for transcription.
                data = await websocket.receive_bytes()
                await dg_ws.send(data)
        except WebSocketDisconnect:
            print("Client disconnected")
        finally:
            # Clean up: cancel the transcript listener and any pending timer
            transcript_task.cancel()
            if pause_timer is not None:
                pause_timer.cancel()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)