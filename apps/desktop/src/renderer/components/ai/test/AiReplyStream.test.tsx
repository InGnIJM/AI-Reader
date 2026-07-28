import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AiReplyStream } from '../AiReplyStream';

afterEach(() => {
  cleanup();
});

describe('AiReplyStream', () => {
  it('should render empty state when streaming with no content', () => {
    render(
      <AiReplyStream content="" isStreaming={true} />,
    );

    expect(screen.getByTestId('ai-reply-thinking')).toBeInTheDocument();
    expect(screen.getByText('AI 正在思考...')).toBeInTheDocument();
  });

  it('should render content when provided', () => {
    render(
      <AiReplyStream content="Hello world" isStreaming={false} />,
    );

    expect(screen.getByTestId('ai-reply-content')).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('should render streaming cursor when streaming', () => {
    render(
      <AiReplyStream content="Partial" isStreaming={true} />,
    );

    expect(screen.getByTestId('ai-reply-cursor')).toBeInTheDocument();
  });

  it('should not render streaming cursor when not streaming', () => {
    render(
      <AiReplyStream content="Complete" isStreaming={false} />,
    );

    expect(screen.queryByTestId('ai-reply-cursor')).not.toBeInTheDocument();
  });

  it('should render stop button when streaming with onStop', () => {
    render(
      <AiReplyStream content="text" isStreaming={true} onStop={vi.fn()} />,
    );

    expect(screen.getByTestId('ai-reply-stop')).toBeInTheDocument();
  });

  it('should not render stop button when not streaming', () => {
    render(
      <AiReplyStream content="text" isStreaming={false} onStop={vi.fn()} />,
    );

    expect(screen.queryByTestId('ai-reply-stop')).not.toBeInTheDocument();
  });

  it('should call onStop when stop button is clicked', () => {
    const onStop = vi.fn();
    render(
      <AiReplyStream content="text" isStreaming={true} onStop={onStop} />,
    );

    fireEvent.click(screen.getByTestId('ai-reply-stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('should render retry button on error when not streaming', () => {
    render(
      <AiReplyStream content="" isStreaming={false} error="Something failed" onRetry={vi.fn()} />,
    );

    expect(screen.getByTestId('ai-reply-error')).toBeInTheDocument();
    expect(screen.getByText('Something failed')).toBeInTheDocument();
    expect(screen.getByTestId('ai-reply-retry')).toBeInTheDocument();
  });

  it('should not render retry button on error when still streaming', () => {
    render(
      <AiReplyStream content="" isStreaming={true} error="Something failed" onRetry={vi.fn()} />,
    );

    expect(screen.getByTestId('ai-reply-error')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-reply-retry')).not.toBeInTheDocument();
  });

  it('should call onRetry when retry button is clicked', () => {
    const onRetry = vi.fn();
    render(
      <AiReplyStream content="" isStreaming={false} error="Failed" onRetry={onRetry} />,
    );

    fireEvent.click(screen.getByTestId('ai-reply-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should render error message with icon', () => {
    render(
      <AiReplyStream content="" isStreaming={false} error="Network error" />,
    );

    expect(screen.getByTestId('ai-reply-error')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('should not render stop button when onStop is not provided', () => {
    render(
      <AiReplyStream content="text" isStreaming={true} />,
    );

    expect(screen.queryByTestId('ai-reply-stop')).not.toBeInTheDocument();
  });

  it('should not render retry button when onRetry is not provided', () => {
    render(
      <AiReplyStream content="" isStreaming={false} error="Error" />,
    );

    expect(screen.queryByTestId('ai-reply-retry')).not.toBeInTheDocument();
  });

  it('should render nothing when no content, not streaming, and no error', () => {
    render(
      <AiReplyStream content="" isStreaming={false} />,
    );

    expect(screen.queryByTestId('ai-reply-thinking')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-reply-cursor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-reply-error')).not.toBeInTheDocument();
  });

  it('should not show thinking indicator when content is present', () => {
    render(
      <AiReplyStream content="some text" isStreaming={true} />,
    );

    expect(screen.queryByTestId('ai-reply-thinking')).not.toBeInTheDocument();
  });

  it('should have proper accessibility attributes on stop button', () => {
    render(
      <AiReplyStream content="text" isStreaming={true} onStop={vi.fn()} />,
    );

    const stopBtn = screen.getByTestId('ai-reply-stop');
    expect(stopBtn).toHaveAttribute('aria-label', '停止生成');
    expect(stopBtn).toHaveAttribute('title', '停止生成');
  });

  it('should have proper accessibility attributes on retry button', () => {
    render(
      <AiReplyStream content="" isStreaming={false} error="err" onRetry={vi.fn()} />,
    );

    const retryBtn = screen.getByTestId('ai-reply-retry');
    expect(retryBtn).toHaveAttribute('aria-label', '重试');
    expect(retryBtn).toHaveAttribute('title', '重试');
  });
});
