import React, { useCallback, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import styles from './MarkdownRenderer.module.css';

/**
 * Source mapping segment: maps a range in rendered text to source offsets.
 */
interface TextSegment {
  renderedStart: number;
  renderedEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

/**
 * Annotation definition with source offsets.
 */
interface AnnotationDef {
  id: string;
  startOffset: number;
  endOffset: number;
}

/**
 * MarkdownRenderer props
 */
export interface MarkdownRendererProps {
  /** Markdown source content to render */
  content: string;
  /** Called when the user selects text via mouse. Receives the trimmed selected text and the DOM Range. */
  onTextSelect?: (text: string, range: Range) => void;
  /**
   * Function that maps heading text to a DOM id for scroll navigation.
   * When provided, each heading element receives an `id` attribute.
   */
  getHeadingId?: (headingText: string) => string | undefined;
  /**
   * Annotations to highlight in the rendered content.
   * Offsets are in source (markdown) coordinates.
   */
  annotations?: AnnotationDef[];
  /** ID of the currently active/focused annotation. */
  activeAnnotationId?: string;
  /** Called when an annotation mark is clicked or activated via keyboard. */
  onAnnotationClick?: (annotationId: string) => void;
}

// ---------------------------------------------------------------------------
// Source mapping: build a mapping from rendered text offsets to source offsets
// by walking the mdast tree produced by remark-parse.
// ---------------------------------------------------------------------------

function buildSourceMapping(tree: any, content: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let renderedOffset = 0;

  function walk(node: any): void {
    if (!node) return;

    if (node.type === 'text') {
      const text: string = node.value;
      const pos = node.position;
      if (pos && pos.start && pos.end) {
        segments.push({
          renderedStart: renderedOffset,
          renderedEnd: renderedOffset + text.length,
          sourceStart: pos.start.offset ?? 0,
          sourceEnd: pos.end.offset ?? 0,
        });
      }
      renderedOffset += text.length;
    } else if (node.type === 'inlineCode') {
      // inlineCode node: value is the content, position covers the backticks
      const text: string = node.value;
      const pos = node.position;
      if (pos && pos.start && pos.end) {
        const nodeStart = pos.start.offset ?? 0;
        const nodeEnd = pos.end.offset ?? 0;
        const nodeText = content.slice(nodeStart, nodeEnd);
        const valueIdx = nodeText.indexOf(text);
        const sourceStart = valueIdx >= 0 ? nodeStart + valueIdx : nodeStart;
        segments.push({
          renderedStart: renderedOffset,
          renderedEnd: renderedOffset + text.length,
          sourceStart,
          sourceEnd: sourceStart + text.length,
        });
      }
      renderedOffset += text.length;
    } else if (node.type === 'code') {
      // Fenced/indented code block: value is the code content
      const text: string = node.value;
      const pos = node.position;
      if (pos && pos.start && pos.end) {
        const nodeStart = pos.start.offset ?? 0;
        const nodeEnd = pos.end.offset ?? 0;
        const nodeText = content.slice(nodeStart, nodeEnd);
        const valueIdx = nodeText.indexOf(text);
        const sourceStart = valueIdx >= 0 ? nodeStart + valueIdx : nodeStart;
        segments.push({
          renderedStart: renderedOffset,
          renderedEnd: renderedOffset + text.length,
          sourceStart,
          sourceEnd: sourceStart + text.length,
        });
      }
      renderedOffset += text.length;
    } else if (node.type === 'break') {
      renderedOffset += 1;
    } else if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(tree);
  return segments;
}

// ---------------------------------------------------------------------------
// Annotation merging: find annotations that overlap a rendered text range,
// convert to local offsets within the text, and merge overlapping ones.
// ---------------------------------------------------------------------------

interface MergedRange {
  localStart: number;
  localEnd: number;
  ids: string[];
}

function findAndMergeAnnotations(
  renderedStart: number,
  renderedEnd: number,
  segments: TextSegment[],
  annotations: AnnotationDef[],
): MergedRange[] {
  // For each annotation, find the rendered range it covers within [renderedStart, renderedEnd)
  const raw: Array<{ localStart: number; localEnd: number; id: string }> = [];

  for (const ann of annotations) {
    let annRenderedStart = -1;
    let annRenderedEnd = -1;

    for (const seg of segments) {
      const overlapSourceStart = Math.max(seg.sourceStart, ann.startOffset);
      const overlapSourceEnd = Math.min(seg.sourceEnd, ann.endOffset);

      if (overlapSourceStart < overlapSourceEnd) {
        const renderedOverlapStart = seg.renderedStart + (overlapSourceStart - seg.sourceStart);
        const renderedOverlapEnd = seg.renderedStart + (overlapSourceEnd - seg.sourceStart);

        if (annRenderedStart === -1 || renderedOverlapStart < annRenderedStart) {
          annRenderedStart = renderedOverlapStart;
        }
        if (renderedOverlapEnd > annRenderedEnd) {
          annRenderedEnd = renderedOverlapEnd;
        }
      }
    }

    if (annRenderedStart !== -1 && annRenderedEnd !== -1) {
      const localStart = Math.max(annRenderedStart, renderedStart) - renderedStart;
      const localEnd = Math.min(annRenderedEnd, renderedEnd) - renderedStart;

      if (localStart < localEnd && localStart >= 0 && localEnd <= renderedEnd - renderedStart) {
        raw.push({ localStart, localEnd, id: ann.id });
      }
    }
  }

  if (raw.length === 0) return [];

  // Sort by localStart
  raw.sort((a, b) => a.localStart - b.localStart || a.localEnd - b.localEnd);

  // Merge overlapping ranges
  const merged: MergedRange[] = [];
  for (const item of raw) {
    const last = merged[merged.length - 1];
    if (last && item.localStart <= last.localEnd) {
      last.localEnd = Math.max(last.localEnd, item.localEnd);
      last.ids.push(item.id);
    } else {
      merged.push({ localStart: item.localStart, localEnd: item.localEnd, ids: [item.id] });
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Text annotation: split a text string at annotation boundaries and wrap
// annotated portions in <mark> elements.
// ---------------------------------------------------------------------------

function splitTextWithMarks(
  text: string,
  renderedStart: number,
  mergedRanges: MergedRange[],
  activeAnnotationId: string | undefined,
  onAnnotationClick: ((id: string) => void) | undefined,
): React.ReactNode {
  if (mergedRanges.length === 0) return text;

  const parts: React.ReactNode[] = [];
  let pos = 0;

  for (const range of mergedRanges) {
    if (pos < range.localStart) {
      parts.push(text.slice(pos, range.localStart));
    }

    const isActive = activeAnnotationId != null && range.ids.includes(activeAnnotationId);
    const markText = text.slice(range.localStart, range.localEnd);
    const key = `ann-${renderedStart + range.localStart}`;

    parts.push(
      React.createElement(
        'mark',
        {
          key,
          'data-annotation-ids': range.ids.join(','),
          'data-testid': 'annotation-mark',
          className: `${styles.annotationMark}${isActive ? ` ${styles.activeAnnotationMark}` : ''}`,
          tabIndex: 0,
          onClick: onAnnotationClick
            ? (e: React.MouseEvent) => {
                e.stopPropagation();
                for (const id of range.ids) onAnnotationClick(id);
              }
            : undefined,
          onKeyDown: onAnnotationClick
            ? (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  for (const id of range.ids) onAnnotationClick(id);
                }
              }
            : undefined,
        },
        markText,
      ),
    );

    pos = range.localEnd;
  }

  if (pos < text.length) {
    parts.push(text.slice(pos));
  }

  return parts.length === 1 ? parts[0] : parts;
}

// ---------------------------------------------------------------------------
// annotateChildren: walk a ReactNode tree (children of a block-level element)
// and replace text strings that overlap annotations with annotated versions.
// Tracks the global rendered text position via positionRef.
// ---------------------------------------------------------------------------

function annotateChildren(
  children: React.ReactNode,
  positionRef: React.MutableRefObject<number>,
  segments: TextSegment[],
  annotations: AnnotationDef[],
  activeAnnotationId: string | undefined,
  onAnnotationClick: ((id: string) => void) | undefined,
): React.ReactNode {
  let childArray: React.ReactNode[] | null = null;

  React.Children.forEach(children, (child, index) => {
    if (typeof child === 'string') {
      const startPos = positionRef.current;
      const endPos = startPos + child.length;
      positionRef.current = endPos;

      const merged = findAndMergeAnnotations(startPos, endPos, segments, annotations);
      if (merged.length > 0) {
        const annotated = splitTextWithMarks(child, startPos, merged, activeAnnotationId, onAnnotationClick);
        if (annotated !== child) {
          if (!childArray) {
            childArray = React.Children.toArray(children);
          }
          childArray[index] = annotated;
        }
      }
    } else if (typeof child === 'number') {
      positionRef.current += String(child).length;
    } else if (React.isValidElement(child)) {
      // Recurse into inline elements (strong, a, em, code, del, etc.)
      const props = child.props as { children?: React.ReactNode };
      if (props.children != null) {
        const newChildren = annotateChildren(
          props.children, positionRef, segments, annotations, activeAnnotationId, onAnnotationClick,
        );
        if (newChildren !== props.children) {
          if (!childArray) {
            childArray = React.Children.toArray(children);
          }
          childArray[index] = React.cloneElement(child, { key: child.key } as Record<string, unknown>, newChildren);
        }
      }
    }
  });

  return childArray ?? children;
}

// ---------------------------------------------------------------------------
// Custom Markdown component overrides using M3 design tokens.
// ---------------------------------------------------------------------------

const createMarkdownComponents = (
  getHeadingId?: (text: string) => string | undefined,
  annotations?: AnnotationDef[],
  activeAnnotationId?: string,
  onAnnotationClick?: (id: string) => void,
  segmentsRef?: React.MutableRefObject<TextSegment[]>,
  positionRef?: React.MutableRefObject<number>,
): Components => {
  /**
   * Extracts plain text from React children (handles nested elements).
   */
  function extractText(children: React.ReactNode): string {
    let text = '';
    React.Children.forEach(children, (child) => {
      if (typeof child === 'string') {
        text += child;
      } else if (typeof child === 'number') {
        text += String(child);
      } else if (React.isValidElement<{ children?: React.ReactNode }>(child) && child.props.children) {
        text += extractText(child.props.children);
      }
    });
    return text;
  }

  function headingId(children: React.ReactNode): string | undefined {
    if (!getHeadingId) return undefined;
    return getHeadingId(extractText(children).trim());
  }

  /**
   * Process block-level children: track position and inject annotation marks.
   */
  function processBlock(children: React.ReactNode): React.ReactNode {
    if (!annotations?.length || !segmentsRef?.current || !positionRef) {
      return children;
    }
    return annotateChildren(
      children, positionRef, segmentsRef.current, annotations, activeAnnotationId, onAnnotationClick,
    );
  }

  return {
  h1: ({ node: _node, children, ...props }) => (
    <h1 id={headingId(children)} className={styles.h1} {...props}>
      {processBlock(children)}
    </h1>
  ),
  h2: ({ node: _node, children, ...props }) => (
    <h2 id={headingId(children)} className={styles.h2} {...props}>
      {processBlock(children)}
    </h2>
  ),
  h3: ({ node: _node, children, ...props }) => (
    <h3 id={headingId(children)} className={styles.h3} {...props}>
      {processBlock(children)}
    </h3>
  ),
  h4: ({ node: _node, children, ...props }) => (
    <h4 id={headingId(children)} className={styles.h4} {...props}>
      {processBlock(children)}
    </h4>
  ),
  p: ({ node: _node, children, ...props }) => (
    <p className={styles.paragraph} {...props}>
      {processBlock(children)}
    </p>
  ),
  ul: ({ node: _node, children, ...props }) => (
    <ul className={styles.list} {...props}>
      {children}
    </ul>
  ),
  ol: ({ node: _node, children, ...props }) => (
    <ol className={styles.orderedList} {...props}>
      {children}
    </ol>
  ),
  li: ({ node: _node, children, ...props }) => (
    <li className={styles.listItem} {...props}>
      {processBlock(children)}
    </li>
  ),
  code: ({ node: _node, children, className, ...props }) => {
    const isCodeBlock = Boolean(className);
    if (isCodeBlock) {
      return (
        <pre className={styles.codeBlock}>
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      );
    }
    return (
      <code className={styles.inlineCode} {...props}>
        {children}
      </code>
    );
  },
  blockquote: ({ node: _node, children, ...props }) => (
    <blockquote className={styles.blockquote} {...props}>
      {children}
    </blockquote>
  ),
  table: ({ node: _node, children, ...props }) => (
    <div className={styles.tableWrapper}>
      <table className={styles.table} {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ node: _node, children, ...props }) => (
    <th className={styles.th} {...props}>
      {processBlock(children)}
    </th>
  ),
  td: ({ node: _node, children, ...props }) => (
    <td className={styles.td} {...props}>
      {processBlock(children)}
    </td>
  ),
  hr: ({ node: _node, ...props }) => <hr className={styles.hr} {...props} />,
  a: ({ node: _node, children, href, ...props }) => (
    <a className={styles.link} href={href} {...props}>
      {children}
    </a>
  ),
  };
};

/**
 * MarkdownRenderer -- renders Markdown content with M3 styling, text selection
 * support, and optional annotation marks backed by source-position mapping.
 *
 * Usage:
 * ```tsx
 * <MarkdownRenderer
 *   content={markdownString}
 *   onTextSelect={(text, range) => { ... }}
 *   annotations={[{ id: 'a1', startOffset: 10, endOffset: 20 }]}
 *   activeAnnotationId="a1"
 *   onAnnotationClick={(id) => console.log(id)}
 * />
 * ```
 */
export function MarkdownRenderer({
  content,
  onTextSelect,
  getHeadingId,
  annotations,
  activeAnnotationId,
  onAnnotationClick,
}: MarkdownRendererProps) {
  const segmentsRef = useRef<TextSegment[]>([]);
  const positionRef = useRef(0);

  // Reset the global rendered-text position counter at the start of each render.
  // Components are rendered in document order, so this gives correct global offsets.
  positionRef.current = 0;

  // Remark plugin that captures the mdast tree and builds the source mapping.
  const sourceMappingPlugin = useCallback(() => {
    return (tree: unknown) => {
      segmentsRef.current = buildSourceMapping(tree, content);
    };
  }, [content]);

  const components = useMemo(
    () => createMarkdownComponents(
      getHeadingId,
      annotations,
      activeAnnotationId,
      onAnnotationClick,
      segmentsRef,
      positionRef,
    ),
    [getHeadingId, annotations, activeAnnotationId, onAnnotationClick],
  );

  const handleMouseUp = useCallback(() => {
    if (!onTextSelect) return;

    const selection = window.getSelection();
    if (!selection) return;

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    if (selection.rangeCount > 0) {
      onTextSelect(selectedText, selection.getRangeAt(0));
    }
  }, [onTextSelect]);

  return (
    <div
      className={styles.container}
      onMouseUp={handleMouseUp}
      data-testid="markdown-renderer"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm, sourceMappingPlugin]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
