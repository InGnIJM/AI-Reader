import React, { useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import styles from './MarkdownRenderer.module.css';

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
}

/**
 * Custom Markdown component overrides using M3 design tokens.
 *
 * Maps Markdown AST nodes to styled HTML elements that follow
 * the project's Material Design 3 color and spacing system.
 */
const createMarkdownComponents = (
  getHeadingId?: (text: string) => string | undefined,
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

  return {
  h1: ({ node: _node, children, ...props }) => (
    <h1 id={headingId(children)} className={styles.h1} {...props}>
      {children}
    </h1>
  ),
  h2: ({ node: _node, children, ...props }) => (
    <h2 id={headingId(children)} className={styles.h2} {...props}>
      {children}
    </h2>
  ),
  h3: ({ node: _node, children, ...props }) => (
    <h3 id={headingId(children)} className={styles.h3} {...props}>
      {children}
    </h3>
  ),
  h4: ({ node: _node, children, ...props }) => (
    <h4 id={headingId(children)} className={styles.h4} {...props}>
      {children}
    </h4>
  ),
  p: ({ node: _node, children, ...props }) => (
    <p className={styles.paragraph} {...props}>
      {children}
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
      {children}
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
      {children}
    </th>
  ),
  td: ({ node: _node, children, ...props }) => (
    <td className={styles.td} {...props}>
      {children}
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
 * MarkdownRenderer -- renders Markdown content with M3 styling and text selection support.
 *
 * Usage:
 * ```tsx
 * <MarkdownRenderer
 *   content={markdownString}
 *   onTextSelect={(text, range) => { ... }}
 * />
 * ```
 */
export function MarkdownRenderer({ content, onTextSelect, getHeadingId }: MarkdownRendererProps) {
  const components = useMemo(() => createMarkdownComponents(getHeadingId), [getHeadingId]);

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
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
