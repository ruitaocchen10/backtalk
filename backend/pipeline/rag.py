from youtube_transcript_api import YouTubeTranscriptApi
from urllib.parse import urlparse, parse_qs

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
    full_text = " ".join([entry.text for entry in transcript_list])
    print(full_text)

fetch_Transcript(video_url)