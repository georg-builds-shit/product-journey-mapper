"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ChatMessage as ChatMessageType } from "@/hooks/useChat";
import ChatMessage from "./ChatMessage";

const SUGGESTED_QUESTIONS = [
  "Which gateway product leads to the highest LTV?",
  "What are the most common product sequences?",
  "How does my cohort retention look?",
  "Which products have the best stickiness?",
];

interface ChatPanelProps {
  messages: ChatMessageType[];
  isStreaming: boolean;
  error: string | null;
  onSend: (content: string) => void;
  onClear: () => void;
  onClose: () => void;
  isMobile: boolean;
}

export default function ChatPanel({
  messages,
  isStreaming,
  error,
  onSend,
  onClear,
  onClose,
  isMobile,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Body scroll lock on mobile
  useEffect(() => {
    if (isMobile) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isMobile]);

  // Auto-focus input
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-resize textarea
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
    },
    []
  );

  const handleSend = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    onSend(input);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, isStreaming, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleSuggestion = useCallback(
    (q: string) => {
      onSend(q);
    },
    [onSend]
  );

  const panelClasses = isMobile
    ? "fixed inset-0 z-50 flex flex-col bg-[var(--background)]"
    : "fixed bottom-24 right-6 z-50 w-[400px] max-h-[600px] flex flex-col rounded-xl border border-[var(--card-border)] bg-[var(--card)] shadow-2xl shadow-black/40";

  return (
    <div className={`${panelClasses} chat-panel-active`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--card-border)] shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-[var(--accent)]/20 flex items-center justify-center">
            <span className="text-[var(--accent)] text-[10px] font-bold">AI</span>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Moby</h3>
            <p className="text-[10px] text-[var(--muted)]">Analytics assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={onClear}
              className="text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] px-2 py-1 rounded transition-colors"
            >
              Clear
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="h-10 w-10 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center mb-3">
              <span className="text-[var(--accent)] text-sm font-bold">AI</span>
            </div>
            <p className="text-sm font-medium mb-1">Ask about your data</p>
            <p className="text-xs text-[var(--muted)] mb-6 max-w-[260px]">
              I can analyze your product journeys, customer behavior, and purchase patterns.
            </p>
            <div className="space-y-2 w-full max-w-[300px]">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSuggestion(q)}
                  className="w-full text-left text-xs px-3 py-2.5 rounded-lg border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                isStreaming={
                  isStreaming &&
                  i === messages.length - 1 &&
                  msg.role === "assistant"
                }
              />
            ))}
          </>
        )}
        {error && (
          <div className="text-center">
            <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2 inline-block">
              {error}
            </p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-[var(--card-border)] shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your product data..."
            rows={1}
            className="flex-1 resize-none px-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="shrink-0 p-2 rounded-lg bg-[var(--accent)] text-white disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
