import { useCallback, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { AiReplyStream } from './AiReplyStream';
import styles from './DiscussionThread.module.css';

/**
 * A single discussion message.
 */
export interface DiscussionMessage {
  /** Unique message identifier */
  id: string;
  /** Who sent the message */
  role: 'user' | 'assistant';
  /** Message content (Markdown for assistant messages) */
  content: string;
  /** ISO 8601 creation timestamp */
  createdAt?: string;
}

/**
 * DiscussionThread props
 */
export interface DiscussionThreadProps {
  /** List of persisted messages in this discussion thread */
  messages: DiscussionMessage[];
  /** Whether the AI is currently streaming a reply */
  isStreaming: boolean;
  /** Accumulated content of the in-progress streaming reply */
  streamingContent: string;
  /** Optional error from the streaming reply */
  streamingError?: string;
  /** Called when the user clicks stop during streaming */
  onStop?: () => void;
  /** Called when the user clicks retry after an error */
  onRetry?: () => void;
  /** Called when the user sends a message (follow-up question) */
  onSend: (message: string) => void;
  /** Whether the input is disabled (e.g. no annotation selected) */
  disabled?: boolean;
  /** Placeholder text for the input field */
  placeholder?: string;
}

/**
 * DiscussionThread -- displays a conversation thread between the user and AI.
 *
 * Renders persisted messages (user bubbles left, AI bubbles right),
 * an optional in-progress streaming reply via AiReplyStream,
 * and a composer input for follow-up questions.
 */
export function DiscussionThread({
  messages,
  isStreaming,
  streamingContent,
  streamingError,
  onStop,
  onRetry,
  onSend,
  disabled = false,
  placeholder = '继续追问...',
}: DiscussionThreadProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setInput('');

    // Scroll to bottom after sending
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }, [input, isStreaming, onSend]);

  const handleFormSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      handleSend();
    },
    [handleSend],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className={styles.thread} data-testid="discussion-thread">
      {/* Messages list */}
      <div
        ref={scrollRef}
        className={styles.messageList}
        role="log"
        aria-label="讨论消息"
        data-testid="discussion-messages"
      >
        {messages.length === 0 && !isStreaming ? (
          <div className={styles.emptyState} data-testid="discussion-empty">
            <span className={`material-symbols-rounded ${styles.emptyStateIcon}`}>
              chat_bubble_outline
            </span>
            <span>对批注内容发起提问</span>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`${styles.message} ${
                  msg.role === 'user' ? styles.messageUser : styles.messageAssistant
                }`}
                data-testid={`discussion-message-${msg.id}`}
              >
                <div className={styles.messageRole}>
                  <span className={`material-symbols-rounded ${styles.roleIcon}`}>
                    {msg.role === 'user' ? 'person' : 'smart_toy'}
                  </span>
                  <span>{msg.role === 'user' ? '你' : 'AI'}</span>
                </div>
                <div className={styles.messageContent}>{msg.content}</div>
              </div>
            ))}

            {/* Streaming reply */}
            {isStreaming && (
              <div
                className={styles.messageAssistant}
                data-testid="discussion-streaming"
              >
                <div className={styles.messageRole}>
                  <span className={`material-symbols-rounded ${styles.roleIcon}`}>
                    smart_toy
                  </span>
                  <span>AI</span>
                </div>
                <AiReplyStream
                  content={streamingContent}
                  isStreaming={isStreaming}
                  error={streamingError}
                  onStop={onStop}
                  onRetry={onRetry}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Composer */}
      <form
        className={styles.composer}
        onSubmit={handleFormSubmit}
        data-testid="discussion-composer"
      >
        <input
          className={styles.input}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isStreaming}
          aria-label="输入追问"
          data-testid="discussion-input"
        />
        <button
          className={styles.sendButton}
          type="submit"
          disabled={!input.trim() || isStreaming || disabled}
          aria-label="发送"
          title="发送"
          data-testid="discussion-send"
        >
          <span className="material-symbols-rounded">send</span>
        </button>
      </form>
    </div>
  );
}
