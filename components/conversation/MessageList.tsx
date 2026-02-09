interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface MessageListProps {
  messages: Message[];
  streamingResponse?: string;
  isAiSpeaking: boolean;
}

export function MessageList({
  messages,
  streamingResponse,
  isAiSpeaking,
}: MessageListProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center space-y-2 text-muted-foreground">
            <p className="text-lg">No messages yet</p>
            <p className="text-sm">
              Click the record button below to start the conversation
            </p>
          </div>
        </div>
      ) : (
        messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[70%] rounded-lg px-4 py-3 ${
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              <p
                className={`text-xs mt-1 ${
                  message.role === "user"
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground"
                }`}
              >
                {new Date(message.created_at).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))
      )}

      {/* Streaming LLM Response */}
      {streamingResponse && isAiSpeaking && (
        <div className="flex justify-start">
          <div className="max-w-[70%] rounded-lg px-4 py-3 bg-muted">
            <p className="text-sm whitespace-pre-wrap">
              {streamingResponse}
              <span className="inline-block w-2 h-4 bg-foreground/50 ml-1 animate-pulse" />
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
