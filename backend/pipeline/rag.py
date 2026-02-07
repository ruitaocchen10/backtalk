import numpy as np
from openai import AsyncOpenAI
from dotenv import load_dotenv
from youtube_transcript_api import YouTubeTranscriptApi
from urllib.parse import urlparse, parse_qs

load_dotenv()
client = AsyncOpenAI()

ytt_api = YouTubeTranscriptApi()


def extract_video_id(video_url: str) -> str:
    parsed = urlparse(video_url)

    if parsed.hostname in ("www.youtube.com", "youtube.com"):
        return parse_qs(parsed.query)["v"][0]
    elif parsed.hostname == "youtu.be":
        return parsed.path.lstrip("/")
    else:
        return video_url


def fetch_transcript(video_url: str):
    video_id = extract_video_id(video_url)
    transcript_list = ytt_api.fetch(video_id)
    return transcript_list


def chunk_by_timestamp(transcript_list, seconds_per_chunk: int = 60) -> list[dict]:
    chunks = []
    current_chunk = {"text": "", "start": transcript_list.snippets[0].start}

    for snippet in transcript_list.snippets:
        if snippet.start - current_chunk["start"] >= seconds_per_chunk and current_chunk["text"]:
            chunks.append(current_chunk)
            current_chunk = {"text": "", "start": snippet.start}

        clean_text = snippet.text.replace('\xa0', ' ').replace('\n', ' ')
        current_chunk["text"] += " " + clean_text

    if current_chunk["text"].strip():
        chunks.append(current_chunk)

    return chunks


async def embed_chunks(chunks: list[dict]) -> list[dict]:
    texts = [chunk["text"] for chunk in chunks]

    response = await client.embeddings.create(
        model="text-embedding-3-small",
        input=texts
    )

    for i, chunk in enumerate(chunks):
        chunk["embedding"] = response.data[i].embedding

    return chunks


def cosine_similarity(a: list[float], b: list[float]) -> float:
    a = np.array(a)
    b = np.array(b)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

async def retrieve_relevant_chunks(query: str, chunks: list[dict], top_k: int = 3) -> list[str]:
    # Step 1: Embed the user's query
    response = await client.embeddings.create(
        model="text-embedding-3-small",
        input=[query]
    )
    query_embedding = response.data[0].embedding

    # Step 2: Score every chunk by similarity to the query
    scored = [
        (cosine_similarity(query_embedding, chunk["embedding"]), chunk)
        for chunk in chunks
    ]

    # Step 3: Sort by similarity score, highest first
    scored.sort(key=lambda x: x[0], reverse=True)

    # Return just the text from the top_k chunks
    return [chunk["text"] for _, chunk in scored[:top_k]]