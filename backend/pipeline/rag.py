from openai import OpenAI
from dotenv import load_dotenv
from youtube_transcript_api import YouTubeTranscriptApi
from urllib.parse import urlparse, parse_qs

load_dotenv()
client = OpenAI()
video_url = "https://www.youtube.com/watch?v=0CmtDk-joT4"
ytt_api = YouTubeTranscriptApi()

def extract_video_id(video_url: str) -> str:
    parsed = urlparse(video_url)
    
    if parsed.hostname in ("www.youtube.com", "youtube.com"):
        return parse_qs(parsed.query)["v"][0]
    elif parsed.hostname == "youtu.be":
        return parsed.path.lstrip("/")
    else:
        return video_url

def fetch_Transcript(video_url: str) -> str:
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

def embed_chunks(chunks: list[dict]) -> list[dict]:
    texts = [chunk["text"] for chunk in chunks]

    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=texts
    )

    for i, chunk in enumerate(chunks):
        chunk["embedding"] = response.data[i].embedding

    return chunks


transcript = fetch_Transcript(video_url)
chunks = chunk_by_timestamp(transcript, seconds_per_chunk=30)
chunks = embed_chunks(chunks)

print(f"Total chunks: {len(chunks)}")
print(f"Embedding dimension: {len(chunks[0]['embedding'])}")
print(f"First 5 values of chunk 1's embedding: {chunks[0]['embedding'][:5]}")