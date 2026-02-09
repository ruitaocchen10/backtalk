interface LiveTranscriptDisplayProps {
  interimText: string;
  finalText: string;
  isRecording: boolean;
}

export function LiveTranscriptDisplay({
  interimText,
  finalText,
  isRecording,
}: LiveTranscriptDisplayProps) {
  // Don't render if not recording or no text to show
  if (!isRecording || (!interimText && !finalText)) {
    return null;
  }

  return (
    <div className="border-t px-6 py-3 bg-muted/50">
      <p className="text-xs text-muted-foreground mb-1">You're saying:</p>
      <p className="text-sm">
        <span className="font-medium">{finalText}</span>
        {finalText && interimText && " "}
        <span className="italic text-muted-foreground">{interimText}</span>
      </p>
    </div>
  );
}
