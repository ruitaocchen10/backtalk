"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { AppSidebar } from "@/components/AppSidebar";
import { supabase } from "@/lib/supabase";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { ConversationHeader } from "@/components/conversation/ConversationHeader";
import { MessageList } from "@/components/conversation/MessageList";
import { LiveTranscriptDisplay } from "@/components/conversation/LiveTranscriptDisplay";
import { VoiceControls } from "@/components/conversation/VoiceControls";

// Types
type UIState = "idle" | "recording" | "processing" | "ai_speaking" | "error";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface Conversation {
  id: string;
  title: string;
  video_id: string;
  created_at: string;
}

interface TranscriptState {
  interim: string;
  final: string;
}

export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const conversationId = params.id as string;

  // Data state
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  // UI state machine
  const [uiState, setUiState] = useState<UIState>("idle");

  // Real-time conversation state
  const [transcript, setTranscript] = useState<TranscriptState>({
    interim: "",
    final: "",
  });
  const [streamingResponse, setStreamingResponse] = useState<string>("");
  const streamingResponseRef = useRef<string>("");

  // Audio playback state
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const audioSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  // Audio capture hook
  const { isRecording, start, stop } = useAudioCapture();

  // WebSocket message handlers (must be defined before early returns)
  const handleAudioChunk = useCallback((chunk: ArrayBuffer) => {
    // Optional: Could use for audio visualization
    // For now, just log chunk size
    console.log(`Audio chunk: ${chunk.byteLength} bytes`);
  }, []);

  const handleTranscript = useCallback(
    (text: string, isFinal: boolean) => {
      if (isFinal) {
        // Accumulate final text
        setTranscript((prev) => ({
          interim: "",
          final: prev.final ? prev.final + " " + text : text,
        }));

        // After final transcript, we're waiting for LLM (backend handles 2s pause)
        // Set a timer to transition to "processing" state
        setTimeout(() => {
          setUiState((currentState) => {
            // Only transition if still recording (user hasn't stopped)
            if (currentState === "recording") {
              // Add user message to UI
              const userMessage = (
                transcript.final
                  ? transcript.final + " " + text
                  : text
              ).trim();

              if (userMessage) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    role: "user",
                    content: userMessage,
                    created_at: new Date().toISOString(),
                  },
                ]);
              }

              // Clear transcript immediately after adding message to prevent duplicate display
              setTranscript({ interim: "", final: "" });

              return "processing";
            }
            return currentState;
          });
        }, 4000); // Slightly longer than backend's 3.5s pause timeout
      } else {
        // Show interim text (gray, italic)
        setTranscript((prev) => ({
          ...prev,
          interim: text,
        }));
      }
    },
    [transcript.final]
  );

  const handleLlmResponse = useCallback(
    (text: string, done: boolean) => {
      if (done) {
        // Response complete - finalize it
        const finalResponse = streamingResponseRef.current;
        if (finalResponse) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: finalResponse,
              created_at: new Date().toISOString(),
            },
          ]);
        }

        // Reset text state (audio will play next)
        streamingResponseRef.current = "";
        setStreamingResponse("");
        // Don't set to idle yet - wait for TTS to complete
      } else {
        // Accumulate streaming tokens
        setUiState((currentState) => {
          // First token - transition to ai_speaking
          if (currentState === "processing") {
            return "ai_speaking";
          }
          return currentState;
        });

        // Update both ref and state
        streamingResponseRef.current += text;
        setStreamingResponse((prev) => prev + text);
      }
    },
    []
  );

  // Handle incoming TTS audio (one complete WAV file per sentence).
  // Uses decodeAudioData so the browser handles the WAV header, sample rate,
  // and any required resampling — avoiding the 2× speed bug caused by
  // manually creating an AudioBuffer at a mismatched sample rate.
  const handleTtsAudio = useCallback(async (audioData: ArrayBuffer) => {
    try {
      // Initialize audio context on first sentence (use the browser's native
      // sample rate so no cross-rate scheduling issues arise).
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
        nextPlayTimeRef.current = audioContextRef.current.currentTime;
        console.log(`AudioContext initialized at ${audioContextRef.current.sampleRate}Hz`);
      }

      const audioContext = audioContextRef.current;

      // decodeAudioData correctly parses the WAV header (sample rate, channels,
      // bit depth) and returns an AudioBuffer at the AudioContext's native rate.
      const audioBuffer = await audioContext.decodeAudioData(audioData);

      // Create audio source node
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);

      // Schedule this sentence to play immediately after the previous one
      const startTime = Math.max(
        audioContext.currentTime,
        nextPlayTimeRef.current
      );

      source.start(startTime);

      // Advance the playhead to after this sentence finishes
      nextPlayTimeRef.current = startTime + audioBuffer.duration;

      // Track sources for cleanup
      audioSourcesRef.current.push(source);

      if (!isPlayingAudio) {
        setIsPlayingAudio(true);
      }

      console.log(
        `Scheduled sentence audio: ${audioBuffer.duration.toFixed(2)}s at ${startTime.toFixed(2)}s`
      );
    } catch (error) {
      console.error("Error playing TTS audio:", error);
    }
  }, [isPlayingAudio]);

  // Handle TTS completion
  const handleTtsDone = useCallback(() => {
    console.log("TTS generation complete");

    // Wait for all scheduled audio to finish playing
    if (audioContextRef.current) {
      const remainingTime =
        nextPlayTimeRef.current - audioContextRef.current.currentTime;

      if (remainingTime > 0) {
        console.log(`Waiting ${remainingTime.toFixed(2)}s for audio to finish`);
        setTimeout(() => {
          console.log("Audio playback completed");
          setIsPlayingAudio(false);
          setUiState("idle");
          audioSourcesRef.current = [];
        }, remainingTime * 1000);
      } else {
        // Audio already finished
        setIsPlayingAudio(false);
        setUiState("idle");
        audioSourcesRef.current = [];
      }
    } else {
      // No audio was played
      setUiState("idle");
    }
  }, []);

  // Start recording handler
  const handleStartRecording = useCallback(async () => {
    try {
      setUiState("recording");
      setTranscript({ interim: "", final: "" });
      setStreamingResponse("");
      streamingResponseRef.current = "";
      setIsPlayingAudio(false);
      nextPlayTimeRef.current = 0;
      audioSourcesRef.current = [];

      await start(
        handleAudioChunk,
        handleTranscript,
        handleLlmResponse,
        handleTtsAudio,
        handleTtsDone,
        conversationId
      );
    } catch (error) {
      console.error("Failed to start recording:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to start recording. Please check microphone permissions."
      );
      setUiState("error");
    }
  }, [
    start,
    handleAudioChunk,
    handleTranscript,
    handleLlmResponse,
    handleTtsAudio,
    handleTtsDone,
    conversationId,
  ]);

  // Stop recording handler
  const handleStopRecording = useCallback(() => {
    stop();
    setUiState("idle");
    setTranscript({ interim: "", final: "" });
  }, [stop]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  // Fetch conversation and messages on mount
  useEffect(() => {
    if (!user || !conversationId) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError("");

        // Fetch conversation details
        const { data: conversationData, error: conversationError } =
          await supabase
            .from("conversations")
            .select("id, title, video_id, created_at")
            .eq("id", conversationId)
            .single();

        if (conversationError) {
          throw new Error(
            conversationError.message || "Failed to load conversation"
          );
        }

        if (!conversationData) {
          throw new Error("Conversation not found");
        }

        setConversation(conversationData);

        // Fetch message history
        const { data: messagesData, error: messagesError } = await supabase
          .from("messages")
          .select("id, role, content, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true });

        if (messagesError) {
          throw new Error(messagesError.message || "Failed to load messages");
        }

        setMessages(messagesData || []);
      } catch (err) {
        console.error("Error fetching conversation data:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load conversation"
        );
        setUiState("error");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user, conversationId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isRecording) {
        stop();
      }
    };
  }, [isRecording, stop]);

  // Show nothing while checking auth status
  if (authLoading || !user) {
    return null;
  }

  // Show loading state
  if (loading) {
    return (
      <SidebarProvider>
        <AppSidebar
          currentConversationId={conversationId}
          userEmail={user?.email}
        />
        <SidebarInset>
          <main className="flex flex-1 items-center justify-center">
            <div className="text-center space-y-4">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
              <p className="text-muted-foreground">Loading conversation...</p>
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  // Show error state
  if (error || !conversation) {
    return (
      <SidebarProvider>
        <AppSidebar
          currentConversationId={conversationId}
          userEmail={user?.email}
        />
        <SidebarInset>
          <main className="flex flex-1 items-center justify-center">
            <div className="text-center space-y-4 max-w-md">
              <div className="text-red-500 text-5xl">⚠️</div>
              <h1 className="text-2xl font-bold">Error Loading Conversation</h1>
              <p className="text-muted-foreground">
                {error || "Conversation not found"}
              </p>
              <button
                onClick={() => router.push("/")}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              >
                Back to Home
              </button>
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  // Main conversation UI
  return (
    <SidebarProvider>
      <AppSidebar
        currentConversationId={conversationId}
        userEmail={user?.email}
      />

      <SidebarInset>
        <div className="flex flex-col h-screen">
          <ConversationHeader
            title={conversation.title}
            messageCount={messages.length}
          />

          <MessageList
            messages={messages}
            streamingResponse={streamingResponse}
            isAiSpeaking={uiState === "ai_speaking"}
          />

          <LiveTranscriptDisplay
            interimText={transcript.interim}
            finalText={transcript.final}
            isRecording={uiState === "recording"}
          />

          <VoiceControls
            uiState={uiState}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
