import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnalysisMarkdownViewer } from '../AnalysisMarkdownViewer';
import type { AnnotationDef } from '../../common/MarkdownRenderer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeAnnotations(overrides: Partial<AnnotationDef> = {}): AnnotationDef[] {
  return [{ id: 'ann-1', startOffset: 0, endOffset: 5, ...overrides }];
}

describe('AnalysisMarkdownViewer annotations', () => {
  it('should render highlight marks for annotations', () => {
    const { container } = render(
      <AnalysisMarkdownViewer
        content="Hello world"
        onTextSelect={vi.fn()}
        annotations={makeAnnotations()}
      />,
    );

    const marks = container.querySelectorAll('mark[data-annotation-ids]');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveAttribute('data-annotation-ids', 'ann-1');
    expect(marks[0]).toHaveTextContent('Hello');
  });

  it('should not render marks when annotations prop is omitted', () => {
    const { container } = render(
      <AnalysisMarkdownViewer content="Hello world" onTextSelect={vi.fn()} />,
    );

    expect(container.querySelectorAll('mark[data-annotation-ids]')).toHaveLength(0);
  });

  it('should call onAnnotationClick when a mark is clicked', async () => {
    const onAnnotationClick = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <AnalysisMarkdownViewer
        content="Hello world"
        onTextSelect={vi.fn()}
        annotations={makeAnnotations()}
        onAnnotationClick={onAnnotationClick}
      />,
    );

    const mark = container.querySelector('mark[data-annotation-ids]')!;
    await user.click(mark);
    expect(onAnnotationClick).toHaveBeenCalledWith('ann-1');
  });

  it('should apply active styling to the active annotation mark', () => {
    const { container } = render(
      <AnalysisMarkdownViewer
        content="Hello world"
        onTextSelect={vi.fn()}
        annotations={makeAnnotations()}
        activeAnnotationId="ann-1"
      />,
    );

    const mark = container.querySelector('mark[data-annotation-ids]')!;
    expect(mark.className).toContain('activeAnnotationMark');
  });

  it('should not apply active styling to a non-active annotation mark', () => {
    const { container } = render(
      <AnalysisMarkdownViewer
        content="Hello world"
        onTextSelect={vi.fn()}
        annotations={makeAnnotations()}
        activeAnnotationId="other-id"
      />,
    );

    const mark = container.querySelector('mark[data-annotation-ids]')!;
    expect(mark.className).not.toContain('activeAnnotationMark');
  });

  it('should still trigger text selection via onTextSelect with source offsets', () => {
    const onTextSelect = vi.fn();
    const { container } = render(
      <AnalysisMarkdownViewer
        content="Hello world"
        onTextSelect={onTextSelect}
        annotations={makeAnnotations()}
      />,
    );

    const range = document.createRange();
    range.selectNodeContents(container.querySelector('p')!);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Hello world',
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection);

    fireEvent.mouseUp(container.querySelector('[data-testid="markdown-renderer"]')!);

    expect(onTextSelect).toHaveBeenCalledWith('Hello world', {
      sourceStartOffset: 0,
      sourceEndOffset: 11,
    });
  });

  it('should render emptyLabel when content is empty', () => {
    render(
      <AnalysisMarkdownViewer content="" onTextSelect={vi.fn()} emptyLabel="Empty doc" />,
    );

    expect(screen.getByText('Empty doc')).toBeInTheDocument();
  });

  it('reports a document when it reaches the reader viewport center', () => {
    class MockIntersectionObserver {
      static instances: MockIntersectionObserver[] = [];
      readonly targets = new Set<Element>();

      constructor(
        private readonly callback: IntersectionObserverCallback,
        readonly options?: IntersectionObserverInit,
      ) {
        MockIntersectionObserver.instances.push(this);
      }

      observe = (target: Element) => this.targets.add(target);
      disconnect = vi.fn();

      emit(target: Element) {
        this.callback(
          [{ isIntersecting: true, intersectionRatio: 0.1, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
    }

    const originalIntersectionObserver = window.IntersectionObserver;
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: MockIntersectionObserver,
    });

    const visibilityRoot = document.createElement('section');
    const onVisible = vi.fn();
    type ViewerPropsWithVisibilityRoot = ComponentProps<typeof AnalysisMarkdownViewer> & {
      visibilityRoot: Element;
    };
    const props: ViewerPropsWithVisibilityRoot = {
      content: 'Visible document',
      onTextSelect: vi.fn(),
      documentId: 'doc-visible',
      onVisible,
      visibilityRoot,
    };

    const { container } = render(<AnalysisMarkdownViewer {...props} />);
    const renderedDocument = container.querySelector('[data-analysis-document-id="doc-visible"]')!;
    const observer = MockIntersectionObserver.instances.find((instance) =>
      instance.targets.has(renderedDocument),
    )!;
    observer.emit(renderedDocument);

    expect(onVisible).toHaveBeenCalledWith('doc-visible');
    expect(observer.options).toMatchObject({
      root: visibilityRoot,
      rootMargin: '-45% 0px -45% 0px',
      threshold: [0],
    });

    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: originalIntersectionObserver,
    });
  });
});
