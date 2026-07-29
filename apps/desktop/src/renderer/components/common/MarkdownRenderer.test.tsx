import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

  // -----------------------------------------------------------------------
  // Source mapping & annotation marks
  // -----------------------------------------------------------------------
  describe('annotation marks', () => {
    it('should render no marks when annotations is undefined', () => {
      const { container } = render(<MarkdownRenderer content="Hello **bold** world" />);
      const marks = container.querySelectorAll('mark[data-annotation-ids]');
      expect(marks).toHaveLength(0);
    });

    it('should render no marks when annotations is empty', () => {
      const { container } = render(
        <MarkdownRenderer content="Hello **bold** world" annotations={[]} />,
      );
      const marks = container.querySelectorAll('mark[data-annotation-ids]');
      expect(marks).toHaveLength(0);
    });

    it('should render a single annotation mark for annotated bold text', () => {
      // "Hello **bold** world"
      // source offsets: H=0 e=1 l=2 l=3 o=4 ' '=5 *=6 *=7 b=8 o=9 l=10 d=11 *=12 *=13 ' '=14 w=15 ...
      // annotation [8, 12) covers "bold" in source (inside **)
      const { container } = render(
        <MarkdownRenderer
          content="Hello **bold** world"
          annotations={[{ id: 'ann-1', startOffset: 8, endOffset: 12 }]}
        />,
      );
      const marks = container.querySelectorAll('mark[data-annotation-ids]');
      expect(marks).toHaveLength(1);
      expect(marks[0]).toHaveAttribute('data-annotation-ids', 'ann-1');
      expect(marks[0]).toHaveTextContent('bold');
      expect(marks[0]).toHaveAttribute('tabindex', '0');
    });

    it('should render a mark for plain text annotation', () => {
      // "Hello world" - annotation [0, 5) covers "Hello"
      const { container } = render(
        <MarkdownRenderer
          content="Hello world"
          annotations={[{ id: 'a1', startOffset: 0, endOffset: 5 }]}
        />,
      );
      const marks = container.querySelectorAll('mark[data-annotation-ids]');
      expect(marks).toHaveLength(1);
      expect(marks[0]).toHaveTextContent('Hello');
      expect(marks[0]).toHaveAttribute('data-annotation-ids', 'a1');
    });

    it('should render a mark spanning across bold inline text', () => {
      // "Some **bold** text"
      // source: S=0 o=1 m=2 e=3 ' '=4 *=5 *=6 b=7 o=8 l=9 d=10 *=11 *=12 ' '=13 t=14 e=15 x=16 t=17
      // annotation [2, 10) covers "me **bol" in source → rendered "me bol" across plain+bold
      // Segments: "Some " source[0,5) rendered[0,5); "bold" source[7,11) rendered[5,9); " text" source[13,18)
      // Overlap with "Some ": source[2,5) → rendered[2,5) → "me "
      // Overlap with "bold": source[7,10) → rendered[5,8) → "bol"
      const { container } = render(
        <MarkdownRenderer
          content="Some **bold** text"
          annotations={[{ id: 'a-span', startOffset: 2, endOffset: 10 }]}
        />,
      );
      const marks = container.querySelectorAll('mark[data-annotation-ids]');
      expect(marks.length).toBeGreaterThanOrEqual(1);
      // Collect all text from all marks
      const allMarkText = Array.from(marks).map(m => m.textContent).join('');
      expect(allMarkText).toBe('me bol');
    });

    it('should merge overlapping annotations into a single mark', () => {
      // "Hello world"
      // Two annotations both covering [0, 5) → should merge into one mark
      const { container } = render(
        <MarkdownRenderer
          content="Hello world"
          annotations={[
            { id: 'ann-1', startOffset: 0, endOffset: 5 },
            { id: 'ann-2', startOffset: 0, endOffset: 5 },
          ]}
        />,
      );
      const marks = container.querySelectorAll('mark[data-annotation-ids]');
      expect(marks).toHaveLength(1);
      const ids = marks[0].getAttribute('data-annotation-ids')!.split(',');
      expect(ids).toContain('ann-1');
      expect(ids).toContain('ann-2');
    });

    it('should render separate marks for non-overlapping annotations', () => {
      // "Hello world"
      // ann-1 covers "Hello" [0,5), ann-2 covers "world" [6,11)
      const { container } = render(
        <MarkdownRenderer
          content="Hello world"
          annotations={[
            { id: 'ann-1', startOffset: 0, endOffset: 5 },
            { id: 'ann-2', startOffset: 6, endOffset: 11 },
          ]}
        />,
      );
      const marks = container.querySelectorAll('mark[data-annotation-ids]');
      expect(marks).toHaveLength(2);
      expect(marks[0]).toHaveAttribute('data-annotation-ids', 'ann-1');
      expect(marks[0]).toHaveTextContent('Hello');
      expect(marks[1]).toHaveAttribute('data-annotation-ids', 'ann-2');
      expect(marks[1]).toHaveTextContent('world');
    });
  });

  describe('active annotation styling', () => {
    it('should apply activeAnnotationMark class to the active annotation', () => {
      const { container } = render(
        <MarkdownRenderer
          content="Hello world"
          annotations={[{ id: 'ann-1', startOffset: 0, endOffset: 5 }]}
          activeAnnotationId="ann-1"
        />,
      );
      const marks = container.querySelectorAll('mark[data-annotation-ids]');
      expect(marks).toHaveLength(1);
      expect(marks[0].className).toContain('activeAnnotationMark');
    });

    it('should not apply activeAnnotationMark class to non-active annotation', () => {
      const { container } = render(
        <MarkdownRenderer
          content="Hello world"
          annotations={[{ id: 'ann-1', startOffset: 0, endOffset: 5 }]}
          activeAnnotationId="other-id"
        />,
      );
      const marks = container.querySelectorAll('mark[data-annotation-ids]');
      expect(marks).toHaveLength(1);
      expect(marks[0].className).not.toContain('activeAnnotationMark');
    });

    it('should always have the base annotationMark class', () => {
      const { container } = render(
        <MarkdownRenderer
          content="Hello world"
          annotations={[{ id: 'ann-1', startOffset: 0, endOffset: 5 }]}
          activeAnnotationId="ann-1"
        />,
      );
      const mark = container.querySelector('mark[data-annotation-ids]')!;
      expect(mark.className).toContain('annotationMark');
    });
  });

  describe('annotation interaction', () => {
    it('should call onAnnotationClick when mark is clicked', async () => {
      const onAnnotationClick = vi.fn();
      const user = userEvent.setup();
      const { container } = render(
        <MarkdownRenderer
          content="Hello world"
          annotations={[{ id: 'ann-1', startOffset: 0, endOffset: 5 }]}
          onAnnotationClick={onAnnotationClick}
        />,
      );
      const mark = container.querySelector('mark[data-annotation-ids]')!;
      await user.click(mark);
      expect(onAnnotationClick).toHaveBeenCalledWith('ann-1');
    });

    it('should call onAnnotationClick when Enter is pressed on focused mark', async () => {
      const onAnnotationClick = vi.fn();
      const user = userEvent.setup();
      const { container } = render(
        <MarkdownRenderer
          content="Hello world"
          annotations={[{ id: 'ann-1', startOffset: 0, endOffset: 5 }]}
          onAnnotationClick={onAnnotationClick}
        />,
      );
      const mark = container.querySelector('mark[data-annotation-ids]')!;
      mark.focus();
      await user.keyboard('{Enter}');
      expect(onAnnotationClick).toHaveBeenCalledWith('ann-1');
    });

    it('should call onAnnotationClick when Space is pressed on focused mark', async () => {
      const onAnnotationClick = vi.fn();
      const user = userEvent.setup();
      const { container } = render(
        <MarkdownRenderer
          content="Hello world"
          annotations={[{ id: 'ann-1', startOffset: 0, endOffset: 5 }]}
          onAnnotationClick={onAnnotationClick}
        />,
      );
      const mark = container.querySelector('mark[data-annotation-ids]')!;
      mark.focus();
      await user.keyboard(' ');
      expect(onAnnotationClick).toHaveBeenCalledWith('ann-1');
    });

    it('should make marks focusable via tabIndex', () => {
      const { container } = render(
        <MarkdownRenderer
          content="Hello world"
          annotations={[{ id: 'ann-1', startOffset: 0, endOffset: 5 }]}
        />,
      );
      const mark = container.querySelector('mark[data-annotation-ids]')!;
      expect(mark).toHaveAttribute('tabindex', '0');
    });
  });

  describe('source mapping across inline elements', () => {
    it('should correctly annotate text within inline code', () => {
      // "Use `code` here"
      // source: U=0 s=1 e=2 ' '=3 '=4 c=5 o=6 d=7 e=8 '=9 ' '=10 h=11 e=12 r=13 e=14
      // annotation [5, 8) covers "cod" inside the backticks
      const { container } = render(
        <MarkdownRenderer
          content="Use `code` here"
          annotations={[{ id: 'ann-1', startOffset: 5, endOffset: 8 }]}
        />,
      );
      const marks = container.querySelectorAll('mark[data-annotation-ids]');
      expect(marks).toHaveLength(1);
      expect(marks[0]).toHaveTextContent('cod');
    });

    it('should correctly annotate text across a link', () => {
      // "Click [here](http://x.com) now"
      // source: C=0 l=1 i=2 c=3 k=4 ' '=5 [=6 h=7 e=8 r=9 e=10 ]=11 (=12 ... )=25 ' '=26 n=27 o=28 w=29
      // annotation [7, 10) covers "her" inside the link text
      const { container } = render(
        <MarkdownRenderer
          content="Click [here](http://x.com) now"
          annotations={[{ id: 'ann-1', startOffset: 7, endOffset: 10 }]}
        />,
      );
      const marks = container.querySelectorAll('mark[data-annotation-ids]');
      expect(marks).toHaveLength(1);
      expect(marks[0]).toHaveTextContent('her');
    });

    it('should correctly handle duplicate text disambiguation', () => {
      // "hello hello"
      // source: h=0 e=1 l=2 l=3 o=4 ' '=5 h=6 e=7 l=8 l=9 o=10
      // annotation [6, 11) covers second "hello"
      const { container } = render(
        <MarkdownRenderer
          content="hello hello"
          annotations={[{ id: 'ann-2nd', startOffset: 6, endOffset: 11 }]}
        />,
      );
      const marks = container.querySelectorAll('mark[data-annotation-ids]');
      expect(marks).toHaveLength(1);
      expect(marks[0]).toHaveTextContent('hello');
      // Verify it's the second "hello" by checking it's not the first text node
      const p = container.querySelector('p')!;
      const firstTextNode = Array.from(p.childNodes).find(
        n => n.nodeType === Node.TEXT_NODE && n.textContent === 'hello ',
      );
      expect(firstTextNode).toBeTruthy();
    });

    it('should correctly annotate text inside emphasis (italic)', () => {
      // "Some *italic* text"
      // source: S=0 o=1 m=2 e=3 ' '=4 *=5 i=6 t=7 a=8 l=9 i=10 c=11 *=12 ' '=13 t=14 e=15 x=16 t=17
      // annotation [6, 10) covers "ital" inside the emphasis
      const { container } = render(
        <MarkdownRenderer
          content="Some *italic* text"
          annotations={[{ id: 'ann-1', startOffset: 6, endOffset: 10 }]}
        />,
      );
      const marks = container.querySelectorAll('mark[data-annotation-ids]');
      expect(marks).toHaveLength(1);
      expect(marks[0]).toHaveTextContent('ital');
    });
  });
});
