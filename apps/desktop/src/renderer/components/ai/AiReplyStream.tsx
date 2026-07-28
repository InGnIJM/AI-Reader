import { useCallback, useEffect, useRef } from 'react';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import styles from './AiReplyStream.module.css';

/**
 * AiReplyStream props
 */
export interface AiReplyStreamProps {
  /** Partial or complete AI-generated content (accumulated during streaming) */
  content: string;
  /** Whether the AI is currently streaming tokens */
  isStreaming: boolean;
  /** Optional error message to display */
  error?: string;
  /** Called when the user clicks the "stop" button */
  onStop?: () => void;
  /** Called when the user clicks the "retry" button */
  onRetry?: () => void;
}

/**
 * AiReplyStream -- renders a single AI reply with streaming animation.
 *
 * Displays the AI-generated Markdown content using MarkdownRenderer.
 * While streaming, shows a blinking cursor at the end of the content.
 * When an error occurs, displays the error message with a retry option.
 * Provides stop/retry action buttons below the content area.
 */
export function AiReplyStream({
  content,
  isStreaming,
  error,
  onStop,
  onRetry,
}: AiReplyStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as new content arrives
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [content]);

  const handleStop = useCallback(() => {
    onStop?.();
  }, [onStop]);

  const handleRetry = useCallback(() => {
    onRetry?.();
  }, [onRetry]);

  return (
    <div className={styles.container} data-testid="ai-reply-stream">
      {/* Content area */}
      <div
        ref={scrollRef}
        className={styles.content}
        data-testid="ai-reply-content"
      >
        {error ? (
          <div className={styles.error} data-testid="ai-reply-error">
            <span className={`material-symbols-rounded ${styles.errorIcon}`}>
              error
            </span>
            <span>{error}</span>
          </div>
        ) : content ? (
          <MarkdownRenderer content={content} />
        ) : isStreaming ? (
          <div className={styles.thinking} data-testid="ai-reply-thinking">
            <span className="material-symbols-rounded">psychology</span>
            <span>AI 正在思考...</span>
          </div>
        ) : null}

        {/* Streaming cursor */}
        {isStreaming && !error && (
          <span className={styles.cursor} data-testid="ai-reply-cursor">
            ▊
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className={styles.actions} data-testid="ai-reply-actions">
        {isStreaming && onStop && (
          <button
            className={styles.stopButton}
            onClick={handleStop}
            aria-label="停止生成"
            title="停止生成"
            data-testid="ai-reply-stop"
          >
            <span className={`material-symbols-rounded ${styles.actionIcon}`}>
              stop
            </span>
            停止
          </button>
        )}
        {!isStreaming && error && onRetry && (
          <button
            className={styles.retryButton}
            onClick={handleRetry}
            aria-label="重试"
            title="重试"
            data-testid="ai-reply-retry"
          >
            <span className={`material-symbols-rounded ${styles.actionIcon}`}>
              refresh
            </span>
            重试
          </button>
        )}
      </div>
    </div>
  );
}
