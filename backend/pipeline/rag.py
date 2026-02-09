from openai import AsyncOpenAI
from dotenv import load_dotenv
from youtube_transcript_api import YouTubeTranscriptApi
from urllib.parse import urlparse, parse_qs
from supabase_client import supabase
from pytube import YouTube

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
    """
    Fetch transcript for a YouTube video.
    Returns (transcript_list, video_title)
    """
    video_id = extract_video_id(video_url)
    transcript_list = ytt_api.fetch(video_id)

    # Fetch video title using pytube
    video_title = None
    try:
        yt = YouTube(video_url)
        video_title = yt.title
        print(f"Fetched video title: {video_title}")
    except Exception as e:
        print(f"Could not fetch video title: {e}")

    return transcript_list, video_title


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


# ============================================
# SUPABASE INTEGRATION FUNCTIONS
# ============================================

def get_or_create_video(user_id: str, youtube_url: str, title: str = None) -> str:
    """
    Look up or create a video record in Supabase.
    Returns the video_id (UUID).
    """
    # First, try to find existing video for this user
    result = supabase.table("videos").select("id").eq("user_id", user_id).eq("youtube_url", youtube_url).execute()

    if result.data and len(result.data) > 0:
        return result.data[0]["id"]

    # If not found, create new video record
    insert_result = supabase.table("videos").insert({
        "user_id": user_id,
        "youtube_url": youtube_url,
        "title": title
    }).execute()

    return insert_result.data[0]["id"]


def get_video_by_url(user_id: str, youtube_url: str) -> dict | None:
    """
    Get video record by URL for a specific user.
    Returns video dict with id and title, or None if not found.
    """
    result = supabase.table("videos").select("id, title").eq("user_id", user_id).eq("youtube_url", youtube_url).execute()

    if result.data and len(result.data) > 0:
        return result.data[0]
    return None


def get_conversation_by_video(user_id: str, video_id: str) -> dict | None:
    """
    Get existing conversation for a video and user.
    Returns conversation dict with id and title, or None if not found.
    """
    result = supabase.table("conversations").select("id, title").eq("user_id", user_id).eq("video_id", video_id).execute()

    if result.data and len(result.data) > 0:
        return result.data[0]
    return None


def create_conversation(user_id: str, video_id: str, title: str) -> str:
    """
    Create a new conversation in Supabase.
    Returns the conversation_id (UUID).
    """
    insert_result = supabase.table("conversations").insert({
        "user_id": user_id,
        "video_id": video_id,
        "title": title
    }).execute()

    return insert_result.data[0]["id"]


def get_chunks_from_db(video_id: str) -> bool:
    """
    Check if chunks already exist in the database for this video.
    Returns True if chunks exist, False otherwise.
    """
    result = supabase.table("video_chunks").select("id").eq("video_id", video_id).limit(1).execute()
    return len(result.data) > 0


def store_chunks_in_db(video_id: str, chunks: list[dict]) -> None:
    """
    Store all chunks with embeddings in Supabase.
    Each chunk should have: text, start, embedding
    """
    rows = [
        {
            "video_id": video_id,
            "text": chunk["text"],
            "start_time": chunk["start"],
            "embedding": chunk["embedding"]
        }
        for chunk in chunks
    ]

    # Insert all chunks in a batch
    supabase.table("video_chunks").insert(rows).execute()


async def retrieve_relevant_chunks_from_db(query: str, video_id: str, top_k: int = 3) -> list[str]:
    """
    Retrieve relevant chunks from Supabase using vector similarity search.
    Replaces the in-memory cosine similarity approach.
    """
    # Step 1: Embed the user's query (same as before)
    response = await client.embeddings.create(
        model="text-embedding-3-small",
        input=[query]
    )
    query_embedding = response.data[0].embedding

    # Step 2: Call the Supabase RPC function for vector similarity search
    result = supabase.rpc(
        "match_video_chunks",
        {
            "query_embedding": query_embedding,
            "target_video_id": video_id,
            "match_count": top_k
        }
    ).execute()

    # Step 3: Extract just the text from the results
    return [row["text"] for row in result.data]


def get_conversation_by_id(conversation_id: str, user_id: str) -> dict | None:
    """
    Get conversation record by ID, verifying ownership.
    Returns conversation dict with id, video_id, title, or None if not found.
    """
    result = supabase.table("conversations")\
        .select("id, video_id, title")\
        .eq("id", conversation_id)\
        .eq("user_id", user_id)\
        .single()\
        .execute()

    if result.data:
        return result.data
    return None


def load_conversation_history(conversation_id: str) -> list[dict]:
    """
    Load existing messages from a conversation.
    Returns list of message dicts: [{"role": "user", "content": "..."}, ...]
    """
    result = supabase.table("messages")\
        .select("role, content")\
        .eq("conversation_id", conversation_id)\
        .order("created_at", ascending=True)\
        .execute()

    # Convert to format expected by LLM
    return [{"role": msg["role"], "content": msg["content"]}
            for msg in result.data]


def save_message(conversation_id: str, role: str, content: str) -> None:
    """
    Save a message to the database.
    role: "user" or "assistant"
    """
    supabase.table("messages").insert({
        "conversation_id": conversation_id,
        "role": role,
        "content": content
    }).execute()