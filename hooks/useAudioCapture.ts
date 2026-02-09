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

  const start = useCallback(
    async (
      onChunk: (chunk: ArrayBuffer) => void,
      onTranscript: (transcript: string, isFinal: boolean) => void,
      onLlmResponse: (text: string, done: boolean) => void,
    ) => {
      onChunkRef.current = onChunk;
      onTranscriptRef.current = onTranscript;
      onLlmResponseRef.current = onLlmResponse;
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

      // Step 5: Open WebSocket with auth token (audio is already flowing into buffer)
      const ws = new WebSocket(`ws://localhost:8000/ws/audio?token=${token}`);
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

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "transcript") {
            onTranscriptRef.current?.(data.text, data.is_final);
          } else if (data.type === "llm_response") {
            onLlmResponseRef.current?.(data.text, data.done);
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
