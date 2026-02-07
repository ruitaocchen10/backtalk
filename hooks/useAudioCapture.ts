import { useRef, useState, useCallback } from "react";

export function useAudioCapture() {
  const wsRef = useRef<WebSocket | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const onChunkRef = useRef<((chunk: ArrayBuffer) => void) | null>(null);
  const onTranscriptRef = useRef<
    ((transcript: string, isFinal: boolean) => void) | null
  >(null);

  const start = useCallback(
    async (
      onChunk: (chunk: ArrayBuffer) => void,
      onTranscript: (transcript: string, isFinal: boolean) => void,
    ) => {
      // Store the callbacks so we can use them in the message handler
      onChunkRef.current = onChunk;
      onTranscriptRef.current = onTranscript;

      // Open WebSocket connection
      const ws = new WebSocket("ws://localhost:8000/ws/audio");
      wsRef.current = ws;

      // Wait for connection to be ready before starting audio
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          console.log("WebSocket connected");
          resolve();
        };
        ws.onerror = (err) => {
          console.error("WebSocket error:", err);
          reject(err);
        };
      });

      // Listen for messages from the server (transcripts)
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "transcript") {
            onTranscriptRef.current?.(data.text, data.is_final);
          }
        } catch (err) {
          console.error("Error parsing message:", err);
        }
      };

      // Step 1: Ask for mic permission and get the audio stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        },
      });
      streamRef.current = stream;

      // Step 2: Create AudioContext and load our processor
      const audioContext = new AudioContext({ sampleRate: 48000 });
      audioContextRef.current = audioContext;

      await audioContext.audioWorklet.addModule("/audio-processor.js");

      // Step 3: Connect mic → worklet processor
      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(
        audioContext,
        "audio-capture-processor",
      );
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        // Send to server if connection is open
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(event.data);
        }
        // Still call the callback too (for logging or future use)
        onChunkRef.current?.(event.data);
      };

      // Connect the audio graph: mic → processor
      source.connect(workletNode);
      // Don't connect to audioContext.destination — we don't want to hear ourselves

      setIsRecording(true);
    },
    [],
  );

  const stop = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    // Tear down everything in reverse order
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;

    audioContextRef.current?.close();
    audioContextRef.current = null;

    // Stop all mic tracks so the browser's recording indicator goes away
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    onChunkRef.current = null;
    onTranscriptRef.current = null;
    setIsRecording(false);
  }, []);

  return { isRecording, start, stop };
}
