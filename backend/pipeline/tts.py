from typing import AsyncGenerator
import os
from dotenv import load_dotenv
import httpx

load_dotenv()

async def stream_tts_audio(text: str) -> AsyncGenerator[bytes, None]:
    """
    Convert text to speech using Deepgram's TTS REST API and stream audio chunks.

    Uses direct HTTP streaming for better control over audio chunk delivery.

    Args:
        text: The text to convert to speech

    Yields:
        bytes: Audio chunks in linear16 PCM format (24kHz sample rate)
    """
    try:
        api_key = os.getenv("DEEPGRAM_API_KEY")
        if not api_key:
            print("ERROR: DEEPGRAM_API_KEY not found")
            return

        # Deepgram TTS endpoint
        url = "https://api.deepgram.com/v1/speak"

        # Query parameters for audio format
        params = {
            "model": "aura-asteria-en",  # Natural-sounding voice
            "encoding": "linear16",       # PCM format for browser compatibility
            "sample_rate": 24000,         # 24kHz
        }

        headers = {
            "Authorization": f"Token {api_key}",
            "Content-Type": "application/json"
        }

        payload = {"text": text}

        # Stream the TTS response
        async with httpx.AsyncClient(timeout=30.0) as client:
            async with client.stream(
                "POST",
                url,
                params=params,
                headers=headers,
                json=payload
            ) as response:
                response.raise_for_status()

                # Stream audio chunks as they arrive
                async for chunk in response.aiter_bytes(chunk_size=4096):
                    if chunk:
                        yield chunk

        print(f"TTS completed for text: {text[:50]}...")

    except Exception as e:
        print(f"TTS error: {type(e).__name__}: {e}")
        # Don't raise - just stop streaming
        # The conversation can continue with text-only responses
