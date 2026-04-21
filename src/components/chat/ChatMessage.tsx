"use client";

import type { ChatMessage as ChatMessageType } from "@/hooks/useChat";

interface ChatMessageProps {
  message: ChatMessageType;
  isStreaming?: boolean;
}

/** Simple markdown-like renderer: bold and bullet lists */
function renderContent(text: string) {
  if (!text) return null;

  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Bullet list item
    if (line.match(/^[-*]\s/)) {
      const content = line.replace(/^[-*]\s/, "");
      elements.push(
        <div key={i} className="flex gap-2 ml-1">
          <span className="text-[var(--muted)] shrink-0">•</span>
          <span>{renderBold(content)}</span>
        </div>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(
        <p key={i} className="leading-relaxed">
          {renderBold(line)}
        </p>
      );
    }
  }

  return elements;
}

/** Render **bold** text */
function renderBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-[var(--foreground)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

export default function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] ${
          isUser
            ? "bg-[var(--accent)] text-white rounded-2xl rounded-br-md px-4 py-2.5"
            : "bg-white/[0.04] text-[var(--foreground)] rounded-2xl rounded-bl-md px-4 py-3"
        }`}
      >
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="h-4 w-4 rounded bg-[var(--accent)]/20 flex items-center justify-center">
              <span className="text-[var(--accent)] text-[8px] font-bold">AI</span>
            </div>
            <span className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium">
              Moby
            </span>
          </div>
        )}
        <div className="text-sm space-y-1">
          {renderContent(message.content)}
          {isStreaming && (
            <span className="streaming-cursor inline-block w-1.5 h-4 bg-[var(--accent)] ml-0.5 align-text-bottom rounded-sm" />
          )}
          {!isUser && !message.content && !isStreaming && (
            <span className="text-[var(--muted)]">...</span>
          )}
        </div>
        <p
          className={`text-[10px] mt-1.5 ${
            isUser ? "text-white/50" : "text-[var(--muted)]/60"
          }`}
        >
          {message.timestamp.toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}
