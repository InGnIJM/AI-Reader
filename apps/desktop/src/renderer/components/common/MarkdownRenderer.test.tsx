import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { MarkdownRenderer } from './MarkdownRenderer';

afterEach(() => {
  cleanup();
});

describe('MarkdownRenderer', () => {
  it('should render markdown content', () => {
    render(<MarkdownRenderer content="# Hello World" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello World');
  });

  it('should render paragraphs', () => {
    render(<MarkdownRenderer content="This is a paragraph." />);
    expect(screen.getByText('This is a paragraph.')).toBeInTheDocument();
  });

  it('should render multiple heading levels', () => {
    const md = '# H1\n\n## H2\n\n### H3';
    render(<MarkdownRenderer content={md} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('H1');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('H2');
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('H3');
  });

  it('should render unordered lists', () => {
    const md = '- Item 1\n- Item 2\n- Item 3';
    render(<MarkdownRenderer content={md} />);
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.getByText('Item 3')).toBeInTheDocument();
  });

  it('should render ordered lists', () => {
    const md = '1. First\n2. Second\n3. Third';
    render(<MarkdownRenderer content={md} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('Third')).toBeInTheDocument();
  });

  it('should render inline code', () => {
    const md = 'Use `console.log()` to debug.';
    render(<MarkdownRenderer content={md} />);
    expect(screen.getByText('console.log()')).toBeInTheDocument();
  });

  it('should render code blocks', () => {
    const md = '```javascript\nconst x = 1;\n```';
    render(<MarkdownRenderer content={md} />);
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  });

  it('should render blockquotes', () => {
    const md = '> This is a quote.';
    render(<MarkdownRenderer content={md} />);
    expect(screen.getByText('This is a quote.')).toBeInTheDocument();
  });

  it('should render GFM tables', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    render(<MarkdownRenderer content={md} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('should render strikethrough with GFM', () => {
    const md = '~~deleted~~';
    render(<MarkdownRenderer content={md} />);
    const el = screen.getByText('deleted');
    expect(el.tagName.toLowerCase()).toBe('del');
  });

  it('should render empty content without error', () => {
    const { container } = render(<MarkdownRenderer content="" />);
    expect(container).toBeDefined();
  });

  describe('text selection', () => {
    it('should call onTextSelect when text is selected on mouseup', async () => {
      const onTextSelect = vi.fn();
      const { container } = render(
        <MarkdownRenderer content="Hello World" onTextSelect={onTextSelect} />
      );

      // Simulate a text selection by overriding window.getSelection
      const mockRange = document.createRange();
      const textNode = container.querySelector('p')?.firstChild;
      if (textNode) {
        mockRange.selectNodeContents(textNode);
      }

      const mockSelection = {
        toString: () => 'Hello',
        rangeCount: 1,
        getRangeAt: () => mockRange,
      } as unknown as Selection;

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

      const contentDiv = container.firstChild as HTMLElement;
      contentDiv.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      expect(onTextSelect).toHaveBeenCalledWith('Hello', mockRange);
    });

    it('should not call onTextSelect when selection is empty', () => {
      const onTextSelect = vi.fn();
      const { container } = render(
        <MarkdownRenderer content="Hello World" onTextSelect={onTextSelect} />
      );

      vi.spyOn(window, 'getSelection').mockReturnValue({
        toString: () => '',
        rangeCount: 0,
        getRangeAt: () => { throw new Error('no range'); },
      } as unknown as Selection);

      const contentDiv = container.firstChild as HTMLElement;
      contentDiv.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      expect(onTextSelect).not.toHaveBeenCalled();
    });

    it('should not call onTextSelect when selection is whitespace only', () => {
      const onTextSelect = vi.fn();
      const { container } = render(
        <MarkdownRenderer content="Hello World" onTextSelect={onTextSelect} />
      );

      vi.spyOn(window, 'getSelection').mockReturnValue({
        toString: () => '   ',
        rangeCount: 1,
        getRangeAt: () => document.createRange(),
      } as unknown as Selection);

      const contentDiv = container.firstChild as HTMLElement;
      contentDiv.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      expect(onTextSelect).not.toHaveBeenCalled();
    });

    it('should not throw when onTextSelect is not provided', () => {
      const { container } = render(<MarkdownRenderer content="Hello" />);

      const mockSelection = {
        toString: () => 'Hello',
        rangeCount: 1,
        getRangeAt: () => document.createRange(),
      } as unknown as Selection;

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

      const contentDiv = container.firstChild as HTMLElement;
      expect(() => {
        contentDiv.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      }).not.toThrow();
    });

    it('should not call onTextSelect when getSelection returns null', () => {
      const onTextSelect = vi.fn();
      const { container } = render(
        <MarkdownRenderer content="Hello" onTextSelect={onTextSelect} />
      );

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const contentDiv = container.firstChild as HTMLElement;
      contentDiv.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      expect(onTextSelect).not.toHaveBeenCalled();
    });
  });

  describe('getHeadingId', () => {
    it('should assign id attributes to headings when getHeadingId is provided', () => {
      const getHeadingId = (text: string) => {
        const map: Record<string, string> = {
          'Chapter One': 'ch-1',
          'Chapter Two': 'ch-2',
        };
        return map[text];
      };
      const md = '# Chapter One\n\n## Chapter Two';
      render(<MarkdownRenderer content={md} getHeadingId={getHeadingId} />);

      const headings = screen.getAllByRole('heading');
      expect(headings).toHaveLength(2);
      expect(headings[0]).toHaveAttribute('id', 'ch-1');
      expect(headings[1]).toHaveAttribute('id', 'ch-2');
    });

    it('should not assign id when getHeadingId returns undefined', () => {
      const getHeadingId = () => undefined;
      render(<MarkdownRenderer content="# Unknown Heading" getHeadingId={getHeadingId} />);

      const h1 = screen.getByRole('heading', { level: 1 });
      expect(h1).not.toHaveAttribute('id');
    });

    it('should not assign id when getHeadingId is not provided', () => {
      render(<MarkdownRenderer content="# Some Heading" />);

      const h1 = screen.getByRole('heading', { level: 1 });
      expect(h1).not.toHaveAttribute('id');
    });

    it('should handle headings with inline formatting', () => {
      const getHeadingId = (text: string) => (text === 'Bold Title' ? 'bold-id' : undefined);
      render(<MarkdownRenderer content="# **Bold Title**" getHeadingId={getHeadingId} />);

      const h1 = screen.getByRole('heading', { level: 1 });
      expect(h1).toHaveAttribute('id', 'bold-id');
    });
  });
});
