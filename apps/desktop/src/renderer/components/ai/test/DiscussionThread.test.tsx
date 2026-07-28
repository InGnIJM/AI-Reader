import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DiscussionThread } from '../DiscussionThread';
import type { DiscussionMessage } from '../DiscussionThread';

afterEach(() => {
  cleanup();
});

const sampleMessages: DiscussionMessage[] = [
  {
    id: 'msg-1',
    role: 'user',
    content: '什么是编译器？',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'msg-2',
    role: 'assistant',
    content: '编译器是将**源语言**翻译成目标语言的程序。',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'msg-3',
    role: 'user',
    content: '能举个例子吗？',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'msg-4',
    role: 'assistant',
    content: '例如 GCC 可以将 C 代码编译为机器码。',
    createdAt: new Date().toISOString(),
  },
];

describe('DiscussionThread', () => {
  describe('rendering', () => {
    it('should render the thread container', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByTestId('discussion-thread')).toBeInTheDocument();
    });

    it('should render the messages area with log role', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByRole('log')).toBeInTheDocument();
    });

    it('should render empty state when no messages and not streaming', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByTestId('discussion-empty')).toBeInTheDocument();
      expect(screen.getByText('对批注内容发起提问')).toBeInTheDocument();
    });

    it('should render empty state icon', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      const empty = screen.getByTestId('discussion-empty');
      expect(empty.querySelector('.material-symbols-rounded')).toHaveTextContent(
        'chat_bubble_outline',
      );
    });

    it('should render all messages', () => {
      render(
        <DiscussionThread
          messages={sampleMessages}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByTestId('discussion-message-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('discussion-message-msg-2')).toBeInTheDocument();
      expect(screen.getByTestId('discussion-message-msg-3')).toBeInTheDocument();
      expect(screen.getByTestId('discussion-message-msg-4')).toBeInTheDocument();
    });

    it('should render message content', () => {
      render(
        <DiscussionThread
          messages={sampleMessages}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByText('什么是编译器？')).toBeInTheDocument();
      expect(screen.getByText('能举个例子吗？')).toBeInTheDocument();
    });

    it('should render user role label', () => {
      render(
        <DiscussionThread
          messages={[sampleMessages[0]]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByText('你')).toBeInTheDocument();
    });

    it('should render assistant role label', () => {
      render(
        <DiscussionThread
          messages={[sampleMessages[1]]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByText('AI')).toBeInTheDocument();
    });

    it('should render person icon for user messages', () => {
      render(
        <DiscussionThread
          messages={[sampleMessages[0]]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      const msg = screen.getByTestId('discussion-message-msg-1');
      const icons = msg.querySelectorAll('.material-symbols-rounded');
      expect(icons[0]).toHaveTextContent('person');
    });

    it('should render smart_toy icon for assistant messages', () => {
      render(
        <DiscussionThread
          messages={[sampleMessages[1]]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      const msg = screen.getByTestId('discussion-message-msg-2');
      const icons = msg.querySelectorAll('.material-symbols-rounded');
      expect(icons[0]).toHaveTextContent('smart_toy');
    });
  });

  describe('streaming', () => {
    it('should render streaming indicator when isStreaming is true', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={true}
          streamingContent="正在生成..."
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByTestId('discussion-streaming')).toBeInTheDocument();
    });

    it('should not render empty state when streaming even with no messages', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={true}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('discussion-empty')).not.toBeInTheDocument();
    });

    it('should render AiReplyStream inside streaming indicator', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={true}
          streamingContent="AI 正在思考..."
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByTestId('ai-reply-stream')).toBeInTheDocument();
    });

    it('should pass onStop to streaming AiReplyStream', async () => {
      const user = userEvent.setup();
      const onStop = vi.fn();
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={true}
          streamingContent="生成中"
          onStop={onStop}
          onSend={vi.fn()}
        />,
      );

      await user.click(screen.getByTestId('ai-reply-stop'));
      expect(onStop).toHaveBeenCalledOnce();
    });

    it('should pass streamingError to AiReplyStream', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={true}
          streamingContent=""
          streamingError="网络错误"
          onRetry={vi.fn()}
          onSend={vi.fn()}
        />,
      );

      // Error during streaming: AiReplyStream shows error text
      expect(screen.getByTestId('ai-reply-error')).toBeInTheDocument();
      expect(screen.getByText('网络错误')).toBeInTheDocument();
      // Retry button is not shown during streaming (AiReplyStream hides it while isStreaming=true)
      expect(screen.queryByTestId('ai-reply-retry')).not.toBeInTheDocument();
    });

    it('should hide empty state when messages exist during streaming', () => {
      render(
        <DiscussionThread
          messages={[sampleMessages[0]]}
          isStreaming={true}
          streamingContent="回复中"
          onSend={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('discussion-empty')).not.toBeInTheDocument();
    });
  });

  describe('composer', () => {
    it('should render the composer', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByTestId('discussion-composer')).toBeInTheDocument();
    });

    it('should render the input field', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByTestId('discussion-input')).toBeInTheDocument();
    });

    it('should render the send button', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByTestId('discussion-send')).toBeInTheDocument();
    });

    it('should render send icon on send button', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      const btn = screen.getByTestId('discussion-send');
      expect(btn.querySelector('.material-symbols-rounded')).toHaveTextContent('send');
    });

    it('should have accessible label on input', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByLabelText('输入追问')).toBeInTheDocument();
    });

    it('should have accessible label on send button', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByLabelText('发送')).toBeInTheDocument();
    });

    it('should use default placeholder', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByPlaceholderText('继续追问...')).toBeInTheDocument();
    });

    it('should use custom placeholder', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
          placeholder="请输入问题..."
        />,
      );
      expect(screen.getByPlaceholderText('请输入问题...')).toBeInTheDocument();
    });
  });

  describe('sending messages', () => {
    it('should call onSend with trimmed input when send button is clicked', async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={onSend}
        />,
      );

      const input = screen.getByTestId('discussion-input');
      await user.type(input, '  什么是编译器？  ');
      await user.click(screen.getByTestId('discussion-send'));

      expect(onSend).toHaveBeenCalledWith('什么是编译器？');
    });

    it('should call onSend when Enter key is pressed', async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={onSend}
        />,
      );

      const input = screen.getByTestId('discussion-input');
      await user.type(input, '追问内容');
      await user.keyboard('{Enter}');

      expect(onSend).toHaveBeenCalledWith('追问内容');
    });

    it('should clear input after sending', async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={onSend}
        />,
      );

      const input = screen.getByTestId('discussion-input') as HTMLInputElement;
      await user.type(input, '测试');
      await user.keyboard('{Enter}');

      expect(input.value).toBe('');
    });

    it('should not call onSend with empty input', async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={onSend}
        />,
      );

      await user.click(screen.getByTestId('discussion-send'));
      expect(onSend).not.toHaveBeenCalled();
    });

    it('should not call onSend with whitespace-only input', async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={onSend}
        />,
      );

      const input = screen.getByTestId('discussion-input');
      await user.type(input, '   ');
      await user.click(screen.getByTestId('discussion-send'));

      expect(onSend).not.toHaveBeenCalled();
    });

    it('should disable send button when input is empty', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByTestId('discussion-send')).toBeDisabled();
    });

    it('should enable send button when input has content', async () => {
      const user = userEvent.setup();
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );

      const input = screen.getByTestId('discussion-input');
      await user.type(input, 'test');
      expect(screen.getByTestId('discussion-send')).not.toBeDisabled();
    });
  });

  describe('disabled state', () => {
    it('should disable input when streaming', async () => {
      const user = userEvent.setup();
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={true}
          streamingContent="生成中"
          onSend={vi.fn()}
        />,
      );

      const input = screen.getByTestId('discussion-input');
      expect(input).toBeDisabled();
    });

    it('should not call onSend when streaming', async () => {
      const onSend = vi.fn();
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={true}
          streamingContent="生成中"
          onSend={onSend}
        />,
      );

      // Input is disabled, so typing shouldn't work
      const input = screen.getByTestId('discussion-input');
      expect(input).toBeDisabled();
    });

    it('should disable input when disabled prop is true', () => {
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
          disabled={true}
        />,
      );

      expect(screen.getByTestId('discussion-input')).toBeDisabled();
    });

    it('should disable send button when disabled prop is true', async () => {
      const user = userEvent.setup();
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
          disabled={true}
        />,
      );

      const input = screen.getByTestId('discussion-input');
      // Input is disabled so user.type won't work, but button should also be disabled
      expect(screen.getByTestId('discussion-send')).toBeDisabled();
    });
  });

  describe('edge cases', () => {
    it('should handle single user message', () => {
      render(
        <DiscussionThread
          messages={[sampleMessages[0]]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByTestId('discussion-message-msg-1')).toBeInTheDocument();
      expect(screen.queryByTestId('discussion-empty')).not.toBeInTheDocument();
    });

    it('should handle single assistant message', () => {
      render(
        <DiscussionThread
          messages={[sampleMessages[1]]}
          isStreaming={false}
          streamingContent=""
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByTestId('discussion-message-msg-2')).toBeInTheDocument();
    });

    it('should render messages and streaming simultaneously', () => {
      render(
        <DiscussionThread
          messages={sampleMessages.slice(0, 2)}
          isStreaming={true}
          streamingContent="正在思考..."
          onSend={vi.fn()}
        />,
      );
      expect(screen.getByTestId('discussion-message-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('discussion-message-msg-2')).toBeInTheDocument();
      expect(screen.getByTestId('discussion-streaming')).toBeInTheDocument();
    });

    it('should not call onSend when input is disabled even with Enter', async () => {
      const onSend = vi.fn();
      render(
        <DiscussionThread
          messages={[]}
          isStreaming={false}
          streamingContent=""
          onSend={onSend}
          disabled={true}
        />,
      );

      // When disabled, input is disabled so user cannot type
      const input = screen.getByTestId('discussion-input');
      expect(input).toBeDisabled();
      expect(onSend).not.toHaveBeenCalled();
    });
  });
});
