type UIState = "idle" | "recording" | "processing" | "ai_speaking" | "error";

interface VoiceControlsProps {
  uiState: UIState;
  onStartRecording: () => void;
  onStopRecording: () => void;
}

export function VoiceControls({
  uiState,
  onStartRecording,
  onStopRecording,
}: VoiceControlsProps) {
  const handleClick = () => {
    if (uiState === "idle") {
      onStartRecording();
    } else if (uiState === "recording") {
      onStopRecording();
    }
    // For other states (processing, ai_speaking, error), button is disabled
  };

  const getButtonConfig = () => {
    switch (uiState) {
      case "idle":
        return {
          text: "🎤 Start Recording",
          className: "bg-blue-500 hover:bg-blue-600 text-white",
          disabled: false,
        };
      case "recording":
        return {
          text: "⏺️ Recording... (click to stop)",
          className: "bg-red-500 hover:bg-red-600 text-white animate-pulse",
          disabled: false,
        };
      case "processing":
        return {
          text: "⏳ Processing...",
          className: "bg-yellow-500 text-white cursor-wait",
          disabled: true,
        };
      case "ai_speaking":
        return {
          text: "🔊 AI Speaking...",
          className: "bg-green-500 text-white cursor-not-allowed",
          disabled: true,
        };
      case "error":
        return {
          text: "❌ Error - Click to Retry",
          className: "bg-red-500 hover:bg-red-600 text-white",
          disabled: false,
        };
    }
  };

  const buttonConfig = getButtonConfig();

  return (
    <div className="border-t px-6 py-4 bg-background">
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={handleClick}
          disabled={buttonConfig.disabled}
          className={`px-8 py-4 rounded-full font-semibold transition-all ${buttonConfig.className} ${
            buttonConfig.disabled ? "opacity-70" : ""
          }`}
        >
          {buttonConfig.text}
        </button>

        {uiState !== "idle" && (
          <div className="text-sm text-muted-foreground">
            State: {uiState}
          </div>
        )}
      </div>
    </div>
  );
}
