from openai import AsyncOpenAI
from dotenv import load_dotenv
from typing import AsyncGenerator

load_dotenv()
client = AsyncOpenAI()

SYSTEM_PROMPT = """You are Backtalk, a voice-first AI learning companion. 
The user has watched a video and talking to you about it out loud.

Your personality:
- You sound like a knowledgeable friend, not a textbook
- Keep responses concise and conversational — this will be spoken aloud
- Avoid bullet points, markdown, or formatted text since your responses 
  will be heard, not read
- Ask follow-up questions to encourage deeper thinking
- Reference specific moments from the video when relevant

You will be given relevant excerpts from the video transcript as context.
Use this context to give informed answers, but don't just repeat the 
transcript back — add insight, explanation, and connections."""

async def stream_llm_response(
    user_text: str,
    context_chunks: list[str],
    conversation_history: list[dict]
) -> AsyncGenerator[str, None]:
    context = "\n---\n".join(context_chunks)

    messages = [
        {
            "role": "system",
            "content": f"{SYSTEM_PROMPT}\n\nRelevant video context:\n{context}"
        },
        *conversation_history,
        {
            "role": "user",
            "content": user_text
        }
    ]

    stream = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        stream=True
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta