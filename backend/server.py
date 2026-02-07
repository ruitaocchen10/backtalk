# backend/server.py

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from deepgram import AsyncDeepgramClient
from deepgram.core.events import EventType
import uvicorn
import os
import asyncio
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

@app.websocket("/ws/audio")
async def audio_ws(websocket: WebSocket):
    await websocket.accept()
    print("Client connected")

    # Init async Deepgram client
    deepgram = AsyncDeepgramClient(api_key=os.getenv("DEEPGRAM_API_KEY"))

    # Open async websocket connection to Deepgram
    async with deepgram.listen.v1.connect(
        model="nova-3",
        language="en-US",
        encoding="linear16",
        sample_rate=16000,
        channels=1,
        interim_results=True
    ) as dg_connection:

        async def on_message(message):
            if message.type == 'results':
                transcript = message.results.channels[0].alternatives[0].transcript
                if len(transcript) > 0:
                    await websocket.send_json({
                        "type": "transcript",
                        "text": transcript,
                        "is_final": message.results.is_final
                    })
                    print(f"Transcript: {transcript}")

        async def on_error(error):
            print(f"Deepgram error: {error}")

        dg_connection.on(EventType.OPEN, lambda _: print("Deepgram connection opened"))
        dg_connection.on(EventType.MESSAGE, on_message)
        dg_connection.on(EventType.ERROR, on_error)
        dg_connection.on(EventType.CLOSE, lambda _: print("Deepgram connection closed"))

        # Start listening for events from Deepgram
        await dg_connection.start_listening()

        try:
            while True:
                # Receive binary audio data from the browser
                data = await websocket.receive_bytes()
                # Forward audio to Deepgram
                dg_connection.send_media(data)

        except WebSocketDisconnect:
            print("Client disconnected")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)