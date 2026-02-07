import websockets
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn
import os
import asyncio
from dotenv import load_dotenv

from pipeline.rag import fetch_transcript, chunk_by_timestamp, embed_chunks, retrieve_relevant_chunks
from pipeline.llm import stream_llm_response

load_dotenv()

app = FastAPI()

DEEPGRAM_URL = "wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&model=nova-3&interim_results=true"

video_chunks_cache: dict[str, list[dict]] = {}


async def load_video_context(video_url: str) -> list[dict]:
    if video_url in video_chunks_cache:
        print(f"Using cached chunks for {video_url}")
        return video_chunks_cache[video_url]

    print(f"Loading and embedding video: {video_url}")
    transcript = fetch_transcript(video_url)
    chunks = chunk_by_timestamp(transcript, seconds_per_chunk=30)
    chunks = await embed_chunks(chunks)
    video_chunks_cache[video_url] = chunks
    print(f"Loaded {len(chunks)} chunks for video")
    return chunks


@app.websocket("/ws/audio")
async def audio_ws(websocket: WebSocket):
    await websocket.accept()
    print("Client connected")

    conversation_history: list[dict] = []

    utterance_buffer: str = ""

    pause_timer: asyncio.TimerHandle | None = None

    PAUSE_TIMEOUT = 2  # seconds

    # For now, hardcode a video for testing.
    VIDEO_URL = "https://www.youtube.com/watch?v=0CmtDk-joT4"

    # Load the video context (embeddings) at session start.
    # This happens once per connection, not once per message.
    video_chunks = await load_video_context(VIDEO_URL)

    async def trigger_llm(user_text: str):
        nonlocal conversation_history

        print(f"User said: {user_text}")

        # Step 1: Find relevant video chunks for what the user asked.
        relevant_chunks = await retrieve_relevant_chunks(
            user_text, video_chunks, top_k=3
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

        # Step 3: Append both the user's message and the assistant's
        # response to conversation history. Next time the LLM is called,
        # it will see this entire conversation, giving it "memory."
        conversation_history.append({"role": "user", "content": user_text})
        conversation_history.append({"role": "assistant", "content": full_response})

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