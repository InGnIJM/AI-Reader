import { useState, useCallback } from 'react';
import ReaderLayout from './layouts/ReaderLayout';
import { OutlineTree } from './components/reader/OutlineTree';
import { MarkdownRenderer } from './components/common/MarkdownRenderer';

interface Chapter {
  id: string;
  title: string;
  level: number;
  index: number;
  content?: string;
}

export default function App() {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | undefined>();
  const [activeContent, setActiveContent] = useState<string>('');

  const handleDocumentImported = useCallback(
    async (result: { documentId: string; chapters: Array<{ id: string; title: string }> }) => {
      // 获取章节内容
      const chaptersWithContent = await Promise.all(
        result.chapters.map(async (ch, i) => {
          try {
            const chaptersData = await window.api.documents.getChapters(result.documentId);
            const chapterData = chaptersData.find((c: any) => c.id === ch.id);
            return {
              id: ch.id,
              title: ch.title,
              level: 1,
              index: i,
              content: chapterData?.content || '',
            };
          } catch {
            return { id: ch.id, title: ch.title, level: 1, index: i, content: '' };
          }
        }),
      );

      setChapters(chaptersWithContent);
      setActiveIndex(0);
      setActiveContent(chaptersWithContent[0]?.content || '');
    },
    [],
  );

  const handleSelectChapter = useCallback(
    (index: number) => {
      setActiveIndex(index);
      const chapter = chapters.find((ch) => ch.index === index);
      setActiveContent(chapter?.content || '');
    },
    [chapters],
  );

  return (
    <ReaderLayout
      outline={
        chapters.length > 0 ? (
          <OutlineTree items={chapters} activeIndex={activeIndex} onSelect={handleSelectChapter} />
        ) : undefined
      }
      onDocumentImported={handleDocumentImported}
    >
      {activeContent ? (
        <MarkdownRenderer content={activeContent} />
      ) : (
        <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
          选择章节开始阅读
        </div>
      )}
    </ReaderLayout>
  );
}
