/**
 * IPC Channel Constants
 *
 * 集中定义所有 IPC 通道名称，避免 main / preload 之间的字符串硬编码。
 * 命名规范：<domain>:<action>
 */

// ── System ──────────────────────────────────────────────────────────────────
export const IPC_CHANNELS = {
  /** 获取应用版本号 */
  SYSTEM_GET_VERSION: 'system:getVersion',

  // ── Workspace ───────────────────────────────────────────────────────────
  /** 创建工作区 */
  WORKSPACE_CREATE: 'workspace:create',
  /** 获取工作区列表 */
  WORKSPACE_LIST: 'workspace:list',
  /** 根据 ID 获取工作区 */
  WORKSPACE_GET_BY_ID: 'workspace:getById',

  // ── Document ────────────────────────────────────────────────────────────
  /** 导入文档（从内容字符串） */
  DOCUMENT_IMPORT: 'document:import',
  /** 获取工作区下的文档列表 */
  DOCUMENT_LIST: 'document:list',
  /** 根据 ID 获取文档详情 */
  DOCUMENT_GET_BY_ID: 'document:getById',
  /** 获取文档的章节列表 */
  DOCUMENT_GET_CHAPTERS: 'document:getChapters',
  /** 删除文档 */
  DOCUMENT_DELETE: 'document:delete',

  // ── Generation Job ──────────────────────────────────────────────────────
  /** 创建生成任务 */
  JOB_CREATE: 'job:create',
  /** 获取任务详情 */
  JOB_GET_BY_ID: 'job:getById',
  /** 获取文档的所有任务 */
  JOB_LIST_BY_DOCUMENT: 'job:listByDocument',
  /** 启动任务 */
  JOB_START: 'job:start',
  /** 更新任务进度 */
  JOB_UPDATE_PROGRESS: 'job:updateProgress',
  /** 标记任务完成 */
  JOB_MARK_COMPLETED: 'job:markCompleted',
  /** 标记任务失败 */
  JOB_MARK_FAILED: 'job:markFailed',

  // ── Annotation ──────────────────────────────────────────────────────────
  /** 创建批注 */
  ANNOTATION_CREATE: 'annotation:create',
  /** 根据 ID 获取批注 */
  ANNOTATION_GET_BY_ID: 'annotation:getById',
  /** 获取章节的所有批注 */
  ANNOTATION_LIST_BY_SECTION: 'annotation:listBySection',
  /** 获取文章的所有批注 */
  ANNOTATION_LIST_BY_ARTICLE: 'annotation:listByArticle',
  /** 删除批注 */
  ANNOTATION_DELETE: 'annotation:delete',

  // ── File Dialog ─────────────────────────────────────────────────────────
  /** 打开文件选择对话框 */
  DIALOG_OPEN_FILE: 'dialog:openFile',
} as const;

/** IPC 频道名称联合类型 */
export type IPCChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
