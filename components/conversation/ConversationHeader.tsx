interface ConversationHeaderProps {
  title: string;
  messageCount: number;
}

export function ConversationHeader({
  title,
  messageCount,
}: ConversationHeaderProps) {
  return (
    <header className="border-b px-6 py-4 bg-background sticky top-0 z-10">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">
        Video conversation • {messageCount} messages
      </p>
    </header>
  );
}
