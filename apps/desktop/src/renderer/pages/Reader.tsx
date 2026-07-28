import ReaderLayout from '../layouts/ReaderLayout';

/**
 * Reader 页面 — 阅读器主视图
 *
 * 组合 ReaderLayout 三栏布局，后续接入：
 * - OutlineTree（目录大纲组件）
 * - ContentRenderer（文档渲染组件）
 * - AnnotationPanel（批注面板组件）
 */
export default function Reader() {
  return <ReaderLayout />;
}
