import { useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

export function useAudioCapture() {
  const wsRef = useRef<WebSocket | null>(null);
  const bufferRef = useRef<ArrayBuffer[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const onChunkRef = useRef<((chunk: ArrayBuffer) => void) | null>(null);
  const onTranscriptRef = useRef<
    ((transcript: string, isFinal: boolean) => void) | null
  >(null);
  const onLlmResponseRef = useRef<
    ((text: string, done: boolean) => void) | null
  >(null);
  const onTtsAudioRef = useRef<((audioData: ArrayBuffer) => void) | null>(
    null
  );
  const onTtsDoneRef = useRef<(() => void) | null>(null);

  const start = useCallback(
    async (
      onChunk: (chunk: ArrayBuffer) => void,
      onTranscript: (transcript: string, isFinal: boolean) => void,
      onLlmResponse: (text: string, done: boolean) => void,
      onTtsAudio: (audioData: ArrayBuffer) => void,
      onTtsDone: () => void,
      conversationId?: string,
    ) => {
      onChunkRef.current = onChunk;
      onTranscriptRef.current = onTranscript;
      onLlmResponseRef.current = onLlmResponse;
      onTtsAudioRef.current = onTtsAudio;
      onTtsDoneRef.current = onTtsDone;
      // Step 1: Get mic stream FIRST
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        },
      });
      streamRef.current = stream;

      // Step 2: Create AudioContext and load worklet
      const audioContext = new AudioContext({ sampleRate: 48000 });
      audioContextRef.current = audioContext;
      await audioContext.audioWorklet.addModule("/audio-processor.js");

      // Step 3: Connect audio graph (chunks start buffering)
      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(
        audioContext,
        "audio-capture-processor",
      );
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(event.data);
        } else {
          bufferRef.current.push(event.data);
        }
        onChunkRef.current?.(event.data);
      };

      source.connect(workletNode);

      // Step 4: Get auth token
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        throw new Error("Not authenticated");
      }

      // Step 5: Open WebSocket with auth token and conversation_id
      const wsUrl = conversationId
        ? `ws://localhost:8000/ws/audio?token=${token}&conversation_id=${conversationId}`
        : `ws://localhost:8000/ws/audio?token=${token}`;
      const ws = new WebSocket(wsUrl);
      // Receive binary frames as ArrayBuffer (synchronous) instead of Blob
      // (async). This prevents a race condition where a Blob's .arrayBuffer()
      // promise resolves *after* the sentence_audio_done JSON marker, which
      // would cause the last chunks to be missing from the assembled WAV file.
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          console.log("WebSocket connected");
          bufferRef.current.forEach((chunk) => ws.send(chunk));
          bufferRef.current = [];
          resolve();
        };
        ws.onerror = (err) => {
          console.error("WebSocket error:", err);
          reject(err);
        };
      });

      // Accumulate binary audio chunks per sentence.
      // Each sentence from the backend is a complete WAV file sent as multiple
      // binary frames. We buffer them here and dispatch the complete WAV to
      // onTtsAudio only when sentence_audio_done is received.
      const pendingChunks: ArrayBuffer[] = [];

      ws.onmessage = (event) => {
        // Handle binary audio data (TTS chunk belonging to the current sentence).
        // Because ws.binaryType = "arraybuffer", this is synchronous — no race
        // condition with the sentence_audio_done JSON marker.
        if (event.data instanceof ArrayBuffer) {
          pendingChunks.push(event.data);
          return;
        }

        // Handle JSON messages (transcripts, LLM responses, audio markers)
        try {
          const data = JSON.parse(event.data);
          if (data.type === "transcript") {
            onTranscriptRef.current?.(data.text, data.is_final);
          } else if (data.type === "llm_response") {
            onLlmResponseRef.current?.(data.text, data.done);
          } else if (data.type === "sentence_audio_done") {
            // All binary chunks for this sentence have arrived.
            // Concatenate them into one ArrayBuffer (the complete WAV file)
            // and hand it off to the audio handler for decoding.
            if (pendingChunks.length > 0) {
              const totalBytes = pendingChunks.reduce((n, b) => n + b.byteLength, 0);
              const combined = new Uint8Array(totalBytes);
              let offset = 0;
              for (const chunk of pendingChunks) {
                combined.set(new Uint8Array(chunk), offset);
                offset += chunk.byteLength;
              }
              pendingChunks.length = 0; // clear the buffer
              onTtsAudioRef.current?.(combined.buffer);
            }
          } else if (data.type === "tts_done") {
            onTtsDoneRef.current?.();
          }
        } catch (err) {
          console.error("Error parsing message:", err);
        }
      };

      setIsRecording(true);
    },
    [],
  );

  const stop = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    bufferRef.current = [];

    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;

    audioContextRef.current?.close();
    audioContextRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    onLlmResponseRef.current = null;

    onChunkRef.current = null;
    onTranscriptRef.current = null;
    setIsRecording(false);
  }, []);

  return { isRecording, start, stop };
}
