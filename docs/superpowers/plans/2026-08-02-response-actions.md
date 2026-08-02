# 回复操作与会话快捷操作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每条已完成 AI 回复提供复制、回退、分支和导出，并将会话菜单扩展为可分支和导出，同时移除独立导出入口。

**Architecture:** 新建一个只负责展示和派发回复操作的渲染组件；工作台继续拥有会话、导出和状态管理。项目侧边栏只发出“针对某个会话当前回复”的回调，工作台复用相同的分支和导出处理器。现有主进程 IPC、数据模型和独立会话复制行为不变。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Electron contextBridge API、Material Symbols。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `apps/desktop/src/renderer/components/code-analysis/ReplyActions.tsx` | 已完成 AI 回复的四项操作及 Markdown/JSON 导出选择。 |
| `apps/desktop/src/renderer/components/code-analysis/test/test_ReplyActions.tsx` | 回复操作组件的可见性、回调、禁用态和导出格式测试。 |
| `apps/desktop/src/renderer/components/code-analysis/CodeAnalysisComponents.module.css` | 回复操作栏及紧凑导出菜单的 M3 样式。 |
| `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx` | 为回复、会话菜单注入操作回调；将导出改为按 document ID 工作。 |
| `apps/desktop/src/renderer/pages/code-analysis-i18n.ts` | 新增中英文按钮、反馈和无内容提示文案。 |
| `apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx` | 工作台级回复操作、回退、复制失败与保存调用回归测试。 |
| `apps/desktop/src/renderer/components/code-analysis/ProjectSidebar.tsx` | 会话更多菜单新增分支和导出，并处理无活动回复状态。 |
| `apps/desktop/src/renderer/components/code-analysis/test/test_ProjectSidebar.tsx` | 会话菜单新入口、参数传递和禁用态测试。 |
| `apps/desktop/src/renderer/components/code-analysis/ExportMenu.tsx` | 删除；不再保留独立导出入口。 |
| `apps/desktop/src/renderer/components/code-analysis/index.ts` | 删除 `ExportMenu` 的导出。 |

### Task 1: 创建可复用的回复操作组件

**Files:**
- Create: `apps/desktop/src/renderer/components/code-analysis/ReplyActions.tsx`
- Create: `apps/desktop/src/renderer/components/code-analysis/test/test_ReplyActions.tsx`
- Modify: `apps/desktop/src/renderer/components/code-analysis/CodeAnalysisComponents.module.css`

- [ ] **Step 1: 写失败的组件测试**

  在 `test_ReplyActions.tsx` 建立以下测试：

  ```tsx
  it('emits copy, checkout, fork and both export formats for a completed reply', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const onCheckout = vi.fn();
    const onFork = vi.fn();
    const onExport = vi.fn();
    render(<ReplyActions labels={labels} onCopy={onCopy} onCheckout={onCheckout} onFork={onFork} onExport={onExport} />);

    await user.click(screen.getByRole('button', { name: 'Copy reply' }));
    await user.click(screen.getByRole('button', { name: 'Go back to this reply' }));
    await user.click(screen.getByRole('button', { name: 'Branch from this reply' }));
    await user.click(screen.getByRole('button', { name: 'Export reply' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export JSON' }));

    expect(onCopy).toHaveBeenCalledOnce();
    expect(onCheckout).toHaveBeenCalledOnce();
    expect(onFork).toHaveBeenCalledOnce();
    expect(onExport).toHaveBeenCalledWith('json');
  });
  ```

  另加两条测试：`disabled` 时四个主按钮均不可用；打开导出菜单后选择 Markdown 调用 `onExport('markdown')`。默认 labels 明确包含 Copy、Go back to this reply、Branch from this reply、Export reply、Export Markdown、Export JSON。

- [ ] **Step 2: 确认测试在组件尚不存在时失败**

  Run: `pnpm --filter @ai-reader/desktop test -- test_ReplyActions.tsx`

  Expected: FAIL，提示无法解析 `../ReplyActions`。

- [ ] **Step 3: 实现最小可访问组件与样式**

  创建 `ReplyActions.tsx`，以受控局部状态保存导出菜单是否展开；实现以下接口和结构：

  ```tsx
  export interface ReplyActionsProps {
    disabled?: boolean;
    labels: {
      copy: string; checkout: string; fork: string; export: string;
      exportMarkdown: string; exportJson: string;
    };
    onCopy: () => void;
    onCheckout: () => void;
    onFork: () => void;
    onExport: (format: AnalysisExportFormat) => void;
  }

  export function ReplyActions({ disabled = false, labels, onCopy, onCheckout, onFork, onExport }: ReplyActionsProps) {
    const [exportOpen, setExportOpen] = useState(false);
    // four icon buttons, then a role="menu" with two role="menuitem" buttons
  }
  ```

  每个按钮都使用 `type="button"`、Material Symbols（`content_copy`、`history`、`fork_right`、`download`）以及 `aria-label` / `title`。导出子菜单被选中后必须先 `setExportOpen(false)`，再调用 `onExport(format)`。在 CSS module 中新增 `.replyActions`、`.replyActionButton`、`.replyExport` 与 `.replyExportMenu`：操作栏采用 4px 间距、可换行、36px 最小点击区；菜单以表面色和边框展示；`focus-visible` 有主题色焦点环；`disabled` 使用 `not-allowed`。

- [ ] **Step 4: 确认组件测试通过**

  Run: `pnpm --filter @ai-reader/desktop test -- test_ReplyActions.tsx`

  Expected: PASS，3 个新增测试均通过。

- [ ] **Step 5: 提交独立组件**

  ```powershell
  git add apps/desktop/src/renderer/components/code-analysis/ReplyActions.tsx apps/desktop/src/renderer/components/code-analysis/test/test_ReplyActions.tsx apps/desktop/src/renderer/components/code-analysis/CodeAnalysisComponents.module.css
  git commit -m "feat(desktop): add reply action controls"
  ```

### Task 2: 在工作台接入每条回复的四项操作

**Files:**
- Modify: `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx`
- Modify: `apps/desktop/src/renderer/pages/code-analysis-i18n.ts`
- Modify: `apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx`

- [ ] **Step 1: 为工作台行为编写失败测试**

  在 `test_CodeAnalysisWorkbench.tsx` 使用包含 `turn-1`、`turn-2` 的已加载会话，新增以下断言：

  ```tsx
  await user.click(await screen.findByRole('button', { name: 'Copy reply' }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('# First answer');

  await user.click(screen.getAllByRole('button', { name: 'Go back to this reply' })[0]);
  await waitFor(() => expect(window.api.codeAnalysis.checkoutTurn).toHaveBeenCalledWith({
    sessionId: 'session-actions', branchId: 'branch-1', documentId: 'turn-1',
  }));

  await user.click(screen.getAllByRole('button', { name: 'Branch from this reply' })[0]);
  await waitFor(() => expect(window.api.codeAnalysis.forkSession).toHaveBeenCalledWith({
    sessionId: 'session-actions', documentId: 'turn-1',
  }));
  ```

  在同一会话中展开该回复的导出菜单并选 Markdown，断言 `exportDocument('turn-1', 'markdown')` 和 `saveFile` 均被调用；另加 Clipboard 拒绝 Promise 的测试，断言页面出现 `copyFailed` 文案。测试 setup 需提供 `navigator.clipboard = { writeText: vi.fn() }`，并在每例后恢复 mock。

- [ ] **Step 2: 确认工作台测试失败**

  Run: `pnpm --filter @ai-reader/desktop test -- test_CodeAnalysisWorkbench.tsx`

  Expected: FAIL，因为不存在名为 `Copy reply` 的回复操作按钮。

- [ ] **Step 3: 接入操作、按 ID 导出与本地化**

  在 `CodeAnalysisWorkbench.tsx`：

  1. 从组件 barrel 之外直接导入 `ReplyActions`，以免在删除 `ExportMenu` 前改变 barrel 的稳定导出。
  2. 将 `handleExport(format)` 重构为 `handleExport(documentId, format)`；使用传入 ID 调用 `exportDocument(documentId, format)`，其余保存文件逻辑保持不变。
  3. 新增 `handleCopyReply(content)`，调用 `await navigator.clipboard.writeText(content)`；成功设置 `text.copiedReply`，失败设置 `text.copyFailed`。先检查 `navigator.clipboard?.writeText` 是否存在，缺失也走失败反馈。
  4. 在 assistant message 的 `article` 之后、同一个 `.assistantMessageRow` 内渲染：

  ```tsx
  {message.state === 'complete' && message.documentId ? (
    <ReplyActions
      disabled={isRunning || session?.status === 'archived'}
      labels={{
        copy: text.copyReply,
        checkout: text.checkoutReply,
        fork: text.forkReply,
        export: text.exportReply,
        exportMarkdown: text.exportMarkdown,
        exportJson: text.exportJson,
      }}
      onCopy={() => void handleCopyReply(message.content)}
      onCheckout={() => {
        const turn = turns.find((candidate) => candidate.id === message.documentId);
        if (turn) void checkoutTurn(turn);
      }}
      onFork={() => void forkSession(message.documentId!)}
      onExport={(format) => void handleExport(message.documentId!, format)}
    />
  ) : null}
  ```

  同时将工作台底部 `ExportMenu` 的两个回调改为新的签名，或在 Task 4 删除它前用 `document ? () => handleExport(document.id, format) : undefined` 维持类型正确。

  在 `code-analysis-i18n.ts` 的两个语言对象加入 `copyReply`、`copiedReply`、`copyFailed`、`checkoutReply`、`forkReply`、`exportReply`。英文固定为 `Copy reply`、`Reply copied`、`Copy failed. Try again.`、`Go back to this reply`、`Branch from this reply`、`Export reply`；中文分别为 `复制回复`、`已复制回复`、`复制失败，请重试`、`回退到此回复`、`从此回复创建分支`、`导出回复`。

- [ ] **Step 4: 运行测试并修复仅由接入引起的失败**

  Run: `pnpm --filter @ai-reader/desktop test -- test_CodeAnalysisWorkbench.tsx`

  Expected: PASS，原有工作台测试与新增复制、回退、分支、导出、复制失败测试均通过。

- [ ] **Step 5: 提交工作台接入**

  ```powershell
  git add apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx apps/desktop/src/renderer/pages/code-analysis-i18n.ts apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx
  git commit -m "feat(desktop): add actions to completed replies"
  ```

### Task 3: 扩展侧边栏会话菜单

**Files:**
- Modify: `apps/desktop/src/renderer/components/code-analysis/ProjectSidebar.tsx`
- Modify: `apps/desktop/src/renderer/components/code-analysis/test/test_ProjectSidebar.tsx`
- Modify: `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx`

- [ ] **Step 1: 写侧边栏菜单的失败测试**

  在 `test_ProjectSidebar.tsx` 以 `activeDocumentId: 'turn-7'` 的活动会话渲染，打开 `Manage session: ...` 菜单并验证：

  ```tsx
  fireEvent.click(screen.getByRole('menuitem', { name: 'Branch' }));
  expect(onForkSession).toHaveBeenCalledWith('session-7', 'turn-7');

  fireEvent.click(screen.getByRole('menuitem', { name: 'Export Markdown' }));
  expect(onExportSession).toHaveBeenCalledWith('session-7', 'turn-7', 'markdown');
  ```

  增加 JSON 路径断言，并针对 `activeDocumentId: null` 断言 Branch、Export Markdown、Export JSON 都具有 `disabled`。测试标签中提供 `branch`、`exportMarkdown`、`exportJson`、`noActiveReply`，不依赖默认英文。

- [ ] **Step 2: 确认侧边栏测试失败**

  Run: `pnpm --filter @ai-reader/desktop test -- test_ProjectSidebar.tsx`

  Expected: FAIL，因为 `ProjectSidebarProps` 还没有分支和导出会话回调，也没有相应菜单项。

- [ ] **Step 3: 实现菜单和工作台回调**

  在 `ProjectSidebarProps` 添加：

  ```tsx
  onForkSession?: (sessionId: string, documentId: string) => void;
  onExportSession?: (
    sessionId: string,
    documentId: string,
    format: AnalysisExportFormat,
  ) => void;
  ```

  从 shared 导入 `AnalysisExportFormat`。在 session context menu 中，将 Branch、Export Markdown、Export JSON 放在 Rename 前；每项的 `disabled` 为 `!sessionMenu.session.activeDocumentId || (sessionActionsDisabled && sessionMenu.session.id === selectedSessionId)`。点击时从 `sessionMenu.session` 取 ID，调用对应回调，再关闭菜单。`title` 和 `aria-describedby` 使用 `labels.noActiveReply`，但不新增嵌套菜单，以保持键盘菜单线性和当前 CSS 行为。

  在工作台传入：

  ```tsx
  onForkSession={(sessionId, documentId) => {
    if (session?.id === sessionId) void forkSession(documentId);
  }}
  onExportSession={(sessionId, documentId, format) => {
    if (session?.id === sessionId) void handleExport(documentId, format);
  }}
  ```

  对非当前会话菜单，先调用 `window.api.codeAnalysis.getSession(sessionId)` 并以返回会话的活动回复执行动作；实现为 `forkSessionFrom(sessionId, documentId)` 和 `exportSessionDocument(sessionId, documentId, format)`，不可假定当前 `session`。这两个函数在成功分支后调用 `selectSession(forkedSession)`，导出沿用保存逻辑。更新 Task 2 的测试 mock，以覆盖 `getSession` 返回非当前会话详情。

- [ ] **Step 4: 运行侧边栏与工作台回归测试**

  Run: `pnpm --filter @ai-reader/desktop test -- test_ProjectSidebar.tsx test_CodeAnalysisWorkbench.tsx`

  Expected: PASS；会话菜单操作的会话 ID、回复 ID 和导出格式都准确，空会话不会调用 IPC。

- [ ] **Step 5: 提交侧边栏功能**

  ```powershell
  git add apps/desktop/src/renderer/components/code-analysis/ProjectSidebar.tsx apps/desktop/src/renderer/components/code-analysis/test/test_ProjectSidebar.tsx apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx
  git commit -m "feat(desktop): add session branch and export actions"
  ```

### Task 4: 删除独立导出入口并完成验证

**Files:**
- Delete: `apps/desktop/src/renderer/components/code-analysis/ExportMenu.tsx`
- Modify: `apps/desktop/src/renderer/components/code-analysis/index.ts`
- Modify: `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx`

- [ ] **Step 1: 写并运行移除入口的失败断言**

  在 `test_CodeAnalysisWorkbench.tsx` 的已加载会话场景加断言，确认左侧栏不再有独立 `Export MD` / `Export JSON` 控件；回复下方和会话菜单中的导出入口仍存在。先运行测试，验证当前独立入口会导致断言失败。

  Run: `pnpm --filter @ai-reader/desktop test -- test_CodeAnalysisWorkbench.tsx`

  Expected: FAIL，页面仍存在旧 `Export MD`、`Export JSON` 按钮。

- [ ] **Step 2: 删除旧入口与陈旧导出**

  从 `CodeAnalysisWorkbench.tsx` 删除 `ExportMenu` 导入与左栏 JSX：

  ```tsx
  <ExportMenu
    disabled={!document}
    markdownLabel={text.exportMarkdown}
    jsonLabel={text.exportJson}
    onExportMarkdown={() => void handleExport(document.id, 'markdown')}
    onExportJson={() => void handleExport(document.id, 'json')}
  />
  ```

  删除 `ExportMenu.tsx`，并从 `components/code-analysis/index.ts` 删除 `export { ExportMenu } from './ExportMenu';`。使用 `rg -n "ExportMenu" apps/desktop/src` 确认没有残留引用。

- [ ] **Step 3: 运行全量验证**

  Run: `pnpm --filter @ai-reader/desktop test -- test_ReplyActions.tsx test_ProjectSidebar.tsx test_CodeAnalysisWorkbench.tsx`

  Expected: PASS。

  Run: `pnpm --filter @ai-reader/desktop type-check`

  Expected: PASS，且无缺失 `ExportMenu`、翻译键或回调类型错误。

  Run: `pnpm test`

  Expected: PASS，仓库现有 Vitest 套件无回归。

- [ ] **Step 4: 提交移除与测试断言**

  ```powershell
  git add apps/desktop/src/renderer/components/code-analysis/ExportMenu.tsx apps/desktop/src/renderer/components/code-analysis/index.ts apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx
  git commit -m "refactor(desktop): remove standalone export menu"
  ```

  若提交钩子严格执行三文件限制，将此任务拆为两个提交：先提交 `ExportMenu.tsx` 与 `index.ts`，再提交 `CodeAnalysisWorkbench.tsx` 与其测试。

## 计划自检

- 规格覆盖：回复四操作（Task 1–2）、剪贴板失败与禁用态（Task 1–2）、会话菜单分支/两种导出/空回复禁用（Task 3）、删除独立入口（Task 4）均有明确任务和验收。
- 无占位步骤：每项测试、接口、回调、IPC 参数、命令与预期结果均明确。
- 类型一致性：所有导出操作统一使用 `AnalysisExportFormat`；所有分支和导出调用都以 `(sessionId, documentId)` 为目标身份；工作台导出核心函数以 `documentId` 而非隐式当前 document 为输入。
