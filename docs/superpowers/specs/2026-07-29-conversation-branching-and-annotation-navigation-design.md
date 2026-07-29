# AI-Reader 会话分支与批注定位设计规格

> 日期：2026-07-29
>
> 状态：待用户审阅
>
> 范围：代码分析工作台中的多轮会话、会话管理、非破坏式回退/分支、批注双向定位

## 1. 背景

当前代码分析工作台将每次输入保存为一条独立的 `analysis_document`。这导致：

- 用户每次输入都会形成新的会话，无法在同一会话中连续追问。
- LLM 只收到当前输入，未拼接同一会话的历史上下文。
- 项目文件夹下没有明确的“新建会话”入口。
- 会话无法重命名、归档、恢复或永久删除。
- 无法从历史回合非破坏式回退并创建新分支。
- 批注只能在右侧列表中查看，不能和原文双向定位。
- 原文没有持久化批注标记，批注内容也始终全部展开。

本规格在保留现有项目目录授权、无项目本地文档、工具轨迹、批注和导出能力的基础上，补齐上述能力。

## 2. 已确认决策

1. 回退采用非破坏式语义，不删除原分支后续内容。
2. 从历史回合继续输入时自动创建新分支。
3. 永久删除需要二次确认，并删除会话下所有关联数据。
4. 归档只隐藏会话，可恢复。
5. 批注默认仅展开当前批注，其余折叠。
6. 点击批注可以定位原文；点击原文标记可以展开对应批注。
7. 项目文件夹和无项目文件夹都提供“新建会话”入口。
8. 新会话使用草稿模式；发送第一条消息后才写入数据库。
9. 同一会话内的后续输入追加为新回合，不创建新会话。
10. LLM 上下文使用当前分支从根回合到当前回合的祖先链。

## 3. 目标

### 3.1 产品目标

- 让项目、会话、分支和回合形成清晰且可持久化的层级。
- 支持类似 Codex Desktop 的多轮对话体验。
- 支持安全、可恢复的归档和明确的永久删除。
- 支持从任意历史回合继续探索，同时完整保留原有路径。
- 让批注和原文形成双向、稳定、可访问的导航关系。

### 3.2 技术目标

- 无损迁移所有现有项目、分析文档、批注、回复和工具轨迹。
- 会话写操作在主进程中校验项目、会话、分支和回合归属。
- 分支上下文严格隔离，不向 LLM 泄漏兄弟分支内容。
- 继续保持项目工具只读和目录边界校验。
- 无项目会话继续禁止目录工具，并写入默认本地文档目录。

## 4. 非目标

- 分支合并或冲突解决。
- Git 提交、Git 分支或源码修改语义。
- 多用户协作、共享会话或云同步。
- 跨会话分支。
- 永久删除后的恢复站。
- 复杂 DAG 可视化。
- 使用向量模型进行语义锚点重定位。
- 自动生成会话标题的额外 LLM 调用。
- 整个会话分支树的导出/导入；本阶段继续导出当前选中的单个回合。

## 5. 术语与核心不变量

### 5.1 术语

- **项目（Project）**：用户通过原生目录选择器授权的本地目录。
- **会话（Session）**：项目或无项目文件夹下的一次持续对话。
- **草稿会话（Draft Session）**：尚未发送第一条消息、只存在于渲染进程的临时状态。
- **分支（Branch）**：从某个历史回合延伸出的独立对话路径。
- **回合（Turn）**：一条用户输入及其对应的一条助手输出。继续沿用 `analysis_documents` 存储。
- **当前节点（Active Turn）**：当前阅读位置，也是下一次发送默认使用的父回合。
- **分支头（Branch Head）**：某个分支最后创建的回合。

### 5.2 不变量

1. 一个持久化会话至少包含一个分支和一个回合。
2. 点击“新建会话”不会立即写数据库。
3. 草稿发送第一条消息时，在同一事务中创建会话、主分支和首个回合。
4. 在分支头发送消息时，回合追加到当前分支。
5. 在非分支头的历史回合发送消息时，自动创建新分支。
6. 回退只更新当前节点，不删除或改写任何回合。
7. 每个回合只属于一个会话和一个分支。
8. 回合的 `parent_document_id` 可以指向父分支中的分叉回合。
9. 批注绑定具体回合，不复制到兄弟分支。
10. 当前分支路径可看到祖先回合及其批注，看不到兄弟分支独有批注。
11. 项目归属只由会话持有；回合不得持有另一份可冲突的项目归属。
12. 已归档会话只读；恢复后才能继续发送。

## 6. 用户流程

### 6.1 在项目目录下新建会话

1. 用户展开项目文件夹。
2. 用户点击文件夹行上的“新建会话”图标，或从更多菜单选择“新建会话”。
3. 工作台切换到该项目下的空白草稿会话。
4. 用户输入第一条消息。
5. 发送时创建会话、主分支和首个运行中回合。
6. 首个回合完成后，会话出现在项目文件夹和全局最近会话中。

约束：

- 文件夹行的图标使用 Material Symbols。
- 图标按钮提供 `aria-label`、`title` 和键盘焦点。
- 草稿为空时离开页面直接丢弃。
- 草稿已有未发送内容时离开，显示确认对话框。
- 同一时刻只维护一个未持久化草稿。

### 6.2 新建无项目会话

流程与项目会话一致，但：

- 会话的 `project_id` 为 `NULL`。
- 不注册或调用目录工具。
- 每个完成回合写入默认本地目录：
  `generated-documents/<documentId>/document.md`。

### 6.3 多轮续写

1. 用户打开已有会话。
2. 系统加载当前分支从根节点到当前节点的全部回合。
3. 用户发送下一条消息。
4. 如果当前节点是分支头，新回合追加到当前分支。
5. UI 在同一个会话中追加用户消息、运行状态和助手输出。
6. 会话标题、项目归属和会话 ID 保持不变。

禁止把每次输入重新插入为新的会话。

### 6.4 回退与自动分支

1. 用户在历史助手回合上点击“回退到此处”。
2. 系统将会话当前节点切换到该回合。
3. 原分支后续回合继续存在，可通过分支选择器返回。
4. 用户只阅读或添加批注时，不创建新分支。
5. 用户从该历史回合发送新消息时，系统自动创建分支。
6. 新回合的父节点为所选历史回合。
7. 新分支成为当前分支，原分支保持不变。

显式点击“从此创建分支”时：

- 只进入以该历史回合为父节点的分支草稿状态。
- 发送第一条新消息时调用 `runTurn`，传入该历史回合 ID 和 `forceFork = true`，再持久化新分支和新回合。
- 离开前未发送消息时不产生空分支。

### 6.5 分支切换

1. 会话头部显示当前分支名称和分支菜单。
2. 菜单列出主分支和其他分支，并标注分叉来源。
3. 切换分支后，当前节点设为该分支头。
4. 中央对话区仅显示该分支的祖先路径。
5. 分支默认命名为“主分支”“分支 2”“分支 3”等。
6. 分支支持重命名，名称为 1 至 80 个字符。

### 6.6 会话标题编辑

- 默认标题来自第一条用户输入的首个非空行。
- 默认标题去除首尾空白并截断为最多 60 个字符。
- 用户可通过会话更多菜单进入原地编辑。
- 手工标题长度为 1 至 80 个字符。
- `Enter` 保存，`Esc` 取消，失焦保存。
- 空标题、仅空白标题或超长标题不提交，并显示行内错误。

### 6.7 归档与恢复

- 活跃会话菜单提供“归档”。
- 归档后从全局最近会话和项目默认列表隐藏。
- 项目会话计数默认只统计活跃会话。
- 侧边栏提供“已归档”视图。
- 归档会话可阅读、导出和恢复，但不可继续发送。
- 已归档会话菜单提供“恢复”和“永久删除”。

### 6.8 永久删除

1. 用户选择“永久删除”。
2. 对话框显示会话标题和删除范围。
3. 用户必须点击明确的危险操作按钮确认。
4. 删除会话、分支、回合、批注、回复和工具轨迹。
5. 删除无项目回合对应的本地生成文件。
6. 删除后选择相邻会话；若无会话则进入空状态。

永久删除不可撤销。

### 6.9 批注双向定位

从批注到原文：

1. 批注卡片提供“查看原文”链接按钮。
2. 点击后滚动到对应回合和高亮文本。
3. 目标标记获得焦点并短暂强调。

从原文到批注：

1. 有批注的原文显示语义化 `<mark>` 标记。
2. 点击标记后，右侧批注面板滚动到对应批注。
3. 目标批注自动展开并获得焦点。
4. 其他批注保持折叠。

同一文本范围存在多条批注时：

- 原文只渲染一个标记。
- 标记显示批注数量。
- 点击后展开该范围的第一条批注，并在卡片组内显示其余批注。

## 7. 数据模型

### 7.1 `analysis_sessions`

```sql
CREATE TABLE analysis_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES code_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  active_branch_id TEXT
    REFERENCES analysis_branches(id) ON DELETE SET NULL,
  active_document_id TEXT
    REFERENCES analysis_documents(id) ON DELETE SET NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

规则：

- `project_id = NULL` 表示无项目会话。
- 草稿会话不进入此表。
- `active_branch_id` 和 `active_document_id` 必须属于当前会话。
- 会话删除级联删除所有分支和回合。

### 7.2 `analysis_branches`

```sql
CREATE TABLE analysis_branches (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL
    REFERENCES analysis_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_branch_id TEXT
    REFERENCES analysis_branches(id) ON DELETE SET NULL,
  forked_from_document_id TEXT
    REFERENCES analysis_documents(id) ON DELETE SET NULL,
  head_document_id TEXT
    REFERENCES analysis_documents(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

规则：

- 主分支的 `parent_branch_id` 和 `forked_from_document_id` 为 `NULL`。
- 自动分支记录父分支及分叉回合。
- `head_document_id` 必须属于当前分支。
- 当前版本不允许单独删除分支。

### 7.3 `analysis_documents`

`analysis_documents` 从“独立会话”调整为“会话回合”：

```sql
CREATE TABLE analysis_documents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL
    REFERENCES analysis_sessions(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL
    REFERENCES analysis_branches(id) ON DELETE CASCADE,
  parent_document_id TEXT
    REFERENCES analysis_documents(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  content_markdown TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  model_id TEXT,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

变更：

- 移除 `project_id`，项目归属通过 `analysis_sessions.project_id` 获取。
- `goal` 保存当前回合的用户输入。
- `content_markdown` 保存当前回合的助手输出。
- `parent_document_id` 建立跨分支祖先链。

### 7.4 `analysis_annotations`

新增可见选中文本：

```sql
ALTER TABLE analysis_annotations
  ADD COLUMN selected_text TEXT NOT NULL DEFAULT '';
```

字段语义：

- `anchor_start_offset` / `anchor_end_offset`：Markdown 源码偏移。
- `anchor_exact_text`：偏移对应的 Markdown 原始片段，用于重定位。
- `selected_text`：用户在渲染结果中看到并选中的文本。
- `anchor_prefix` / `anchor_suffix`：原始 Markdown 前后各最多 50 个字符。

旧批注迁移时：

- `selected_text = anchor_exact_text`。
- 现有偏移、前后文、回复和状态保持不变。

### 7.5 `analysis_file_cleanup_queue`

永久删除使用持久化清理队列，避免数据库记录删除后丢失待清理文件信息：

```sql
CREATE TABLE analysis_file_cleanup_queue (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  relative_path TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

规则：

- 此表不引用 `analysis_documents`，因为队列记录必须在回合被级联删除后继续存在。
- `relative_path` 只允许规范化后的 `generated-documents/<documentId>`，禁止绝对路径、`..` 和目录穿越。
- 队列消费者只处理此表中的路径，不扫描或推断其他孤立目录。
- 文件删除成功后删除队列记录；失败时递增 `attempts` 并保存 `last_error`。

### 7.6 关系完整性

- 普通外键保证会话、分支和回合记录存在。
- 主进程服务在同一事务内校验 `active_branch_id`、`active_document_id`、`forked_from_document_id` 和 `head_document_id` 的会话归属。
- 数据库触发器拒绝活动分支或活动回合属于其他会话。
- 数据库触发器拒绝回合的 `session_id` 与其 `branch_id` 所属会话不一致。
- 数据库触发器拒绝父分支属于其他会话。
- 数据库触发器拒绝分叉回合或父回合属于其他会话。
- 数据库触发器拒绝分支头不属于当前分支。
- 写入或修改 `parent_document_id` 时，数据库触发器使用递归 CTE 检查祖先链并拒绝自引用和间接环路。
- 首轮创建顺序为会话空指针记录、主分支空头记录、首个回合，再更新活动指针和分支头；事务提交前活动指针必须完整。

### 7.7 索引

```sql
CREATE INDEX idx_analysis_sessions_project_status_updated
  ON analysis_sessions(project_id, status, updated_at DESC);
CREATE INDEX idx_analysis_branches_session
  ON analysis_branches(session_id, created_at);
CREATE INDEX idx_analysis_documents_session
  ON analysis_documents(session_id, created_at);
CREATE INDEX idx_analysis_documents_branch
  ON analysis_documents(branch_id, created_at);
CREATE INDEX idx_analysis_documents_parent
  ON analysis_documents(parent_document_id);
CREATE INDEX idx_analysis_file_cleanup_queue_created
  ON analysis_file_cleanup_queue(created_at);
```

## 8. 旧数据迁移

每个旧 `analysis_document` 迁移为一个独立会话：

1. 创建一个 `analysis_session`。
2. 会话 `project_id` 使用旧文档的 `project_id`。
3. 会话标题使用旧文档 `goal` 的首个非空行，最多 60 字符。
4. 创建“主分支”。
5. 旧文档 ID 保持不变。
6. 旧文档设置新的 `session_id`、`branch_id`，父回合为 `NULL`。
7. 会话和主分支的当前节点、分支头指向旧文档。
8. 批注、讨论消息和工具轨迹外键保持不变。
9. 无项目旧文档迁移为 `project_id = NULL` 的会话。

迁移要求：

- 可重复执行。
- 启动失败时完整回滚。
- 迁移开始前确认当前连接不在事务中，再执行 `PRAGMA foreign_keys = OFF`；禁止在事务内部切换该开关。
- 关闭外键成功后执行 `BEGIN IMMEDIATE`，在单一事务中完成建表、回填和旧表重建。
- 提交前在当前事务中执行 `PRAGMA foreign_key_check`；返回任何记录时立即回滚。
- 检查通过后提交事务，再执行 `PRAGMA foreign_keys = ON`，并读取 `PRAGMA foreign_keys` 确认值为 `1`。
- 失败时先回滚事务，并在 `finally` 中恢复 `PRAGMA foreign_keys = ON`；恢复失败必须阻止应用继续启动。
- 对比迁移前后回合、批注、回复和工具轨迹数量。
- 不修改现有项目路径去重结果。

## 9. 多轮上下文构建

### 9.1 路径解析

发送新回合前：

1. 从 `active_document_id` 开始读取 `parent_document_id`。
2. 一直追溯到根回合。
3. 反转结果，得到从根到当前节点的稳定顺序。
4. 校验所有回合属于同一会话。
5. 校验当前分支可从该祖先链到达。

### 9.2 LLM 消息顺序

项目会话：

1. 系统只读约束。
2. 项目上下文、文件索引和工具预算。
3. 祖先回合 1 的用户输入。
4. 祖先回合 1 的助手输出。
5. 后续祖先回合，按相同方式拼接。
6. 当前用户输入。
7. 当前输出契约。

无项目会话：

1. 本地文档生成系统约束。
2. 明确没有项目目录和文件工具。
3. 当前分支的祖先用户/助手消息。
4. 当前用户输入。
5. Markdown 输出契约。

### 9.3 上下文预算

- 历史内容总预算为 60,000 个字符。
- 系统约束、当前输入和输出契约永不截断。
- 从最近回合向前保留完整用户/助手对。
- 超出预算时丢弃最旧的完整回合，不截断单个回合。
- 提示词中加入“较早回合因上下文预算被省略”的明确标记。
- 不使用兄弟分支、已删除会话或其他会话内容。

## 10. 回合与分支写入算法

### 10.1 草稿首轮

在一个数据库事务中：

1. 创建会话。
2. 创建主分支。
3. 创建运行中回合。
4. 设置会话当前分支和当前节点。
5. 设置主分支头节点。

LLM 失败时：

- 会话、主分支和失败回合仍保留。
- 用户可以在同一会话中重试或继续。

### 10.2 分支头续写

如果 `active_document_id = active_branch.head_document_id`：

1. 创建回合，父节点为当前回合。
2. 新回合继续使用当前分支。
3. 更新分支头、会话当前节点和更新时间。

### 10.3 历史节点续写

如果当前节点不是当前分支头：

1. 创建新分支。
2. 新分支父分支为当前分支。
3. `forked_from_document_id` 为当前历史节点。
4. 创建新回合，父节点为当前历史节点。
5. 新回合属于新分支。
6. 新分支成为会话当前分支。
7. 原分支不发生写入。

### 10.4 显式分支

如果 `forceFork = true`：

1. 忽略父回合是否为当前分支头，始终创建新分支。
2. 新分支父分支为请求中的分支上下文。
3. `forked_from_document_id` 和新回合父节点均为 `parentDocumentId`。
4. 创建新回合并更新新分支头、会话活动分支和活动回合。
5. 原分支不发生写入。

所有归属校验和关系更新必须在同一事务中完成。

## 11. 批注锚点与渲染

### 11.1 创建锚点

`MarkdownRenderer` 提供 Markdown 源码位置映射：

- 渲染文本节点携带源 `startOffset` 和 `endOffset`。
- 文本选择映射为源码起止偏移。
- IPC 发送 `analysisDocumentId`、`selectedText`、起止偏移和问题。
- 主进程从持久化 Markdown 中读取原始片段并生成前后文。
- 主进程不信任渲染进程提供的原始片段。

跨多个 Markdown 文本节点的选择必须合并为一个连续源码范围。无法映射时显示明确错误，不创建错误批注。

### 11.2 定位顺序

重新打开文档时按以下顺序定位：

1. 校验 offset 范围和 `anchor_exact_text`。
2. 在全文中匹配唯一的 `anchor_exact_text`。
3. 使用 `prefix + anchor_exact_text + suffix` 消除重复文本歧义。
4. 定位失败时标记为“原文位置已失效”。

不执行模糊语义匹配。

### 11.3 高亮渲染

- Markdown HAST 转换阶段按解析后的源码范围包装 `<mark>`。
- 标记包含 `data-annotation-ids`。
- 多条同范围批注合并为一个 `<mark>`。
- 标记颜色使用现有批注黄色语义 token。
- 当前标记同时使用边框和背景变化，不能只依赖颜色。
- 标记可聚焦，并支持 `Enter` / `Space` 打开批注。

### 11.4 折叠状态

- `activeAnnotationId` 由 `CodeAnalysisWorkbench` 持有。
- 当前批注自动展开。
- 其他批注默认折叠。
- 用户可手动展开其他批注。
- 切换回合或分支时，清理不存在于新路径中的活动批注。
- `aria-expanded` 必须反映真实状态。

## 12. IPC 契约

### 12.1 会话

- `codeAnalysis:listSessions({ projectId, status, limit? })`
- `codeAnalysis:listRecentSessions({ limit? })`
- `codeAnalysis:getSession(sessionId)`
- `codeAnalysis:renameSession({ sessionId, title })`
- `codeAnalysis:archiveSession(sessionId)`
- `codeAnalysis:restoreSession(sessionId)`
- `codeAnalysis:deleteSession({ sessionId, confirmed: true })`

### 12.2 回合与分支

- `codeAnalysis:runTurn({ sessionId?, projectId?, parentDocumentId?, goal, forceFork? })`
- `codeAnalysis:checkoutTurn({ sessionId, branchId, documentId })`
- `codeAnalysis:listBranches(sessionId)`
- `codeAnalysis:switchBranch({ sessionId, branchId })`
- `codeAnalysis:renameBranch({ sessionId, branchId, name })`

`runTurn` 规则：

- `sessionId` 缺省时表示提交草稿首轮，必须提供 `projectId`（允许 `NULL`）。
- `sessionId` 存在时禁止改变项目归属。
- `parentDocumentId` 缺省时使用会话当前节点。
- 历史父节点自动触发分支创建。
- `forceFork = true` 时即使父回合是当前分支头也创建新分支；该参数用于显式“从此创建分支”。
- `forceFork` 只允许已有会话且提供有效 `parentDocumentId` 时使用。
- 返回更新后的会话、分支和新回合。

`checkoutTurn` 规则：

- 目标回合必须属于指定会话，跨会话请求返回 `INVALID_OWNERSHIP`。
- 目标分支必须属于指定会话，目标回合必须位于该分支从根到分支头的祖先路径中。
- 允许目标回合的 `branch_id` 指向父分支，因为共享祖先回合不会复制到子分支。
- 将会话 `active_document_id` 更新为目标回合，并将 `active_branch_id` 更新为请求中的 `branchId`。
- 回退只改变会话活动指针，不修改任何分支的 `head_document_id`、回合内容或父子关系。
- 目标回合不是请求分支的头时，后续 `runTurn` 自动创建新分支。
- 目标回合就是请求分支的头时属于普通分支切换；仅显式“从此创建分支”传入 `forceFork = true`。

`switchBranch` 规则：

- 目标分支必须属于指定会话。
- 将会话 `active_branch_id` 更新为目标分支，并将 `active_document_id` 更新为该分支 `head_document_id`。
- 分支没有头回合时只允许处于尚未发送的前端草稿；持久化分支不得为空。

### 12.3 批注

现有批注接口扩展创建参数：

```ts
interface CreateAnnotationPayload {
  analysisDocumentId: string;
  selectedText: string;
  sourceStartOffset: number;
  sourceEndOffset: number;
  question: string;
}
```

批注定位和焦点切换属于渲染进程交互，不新增无必要的 IPC。

### 12.4 错误码

写操作返回稳定错误码：

- `SESSION_NOT_FOUND`
- `SESSION_ARCHIVED`
- `SESSION_RUNNING`
- `BRANCH_NOT_FOUND`
- `TURN_NOT_FOUND`
- `INVALID_OWNERSHIP`
- `INVALID_TITLE`
- `DELETE_CONFIRMATION_REQUIRED`
- `ANCHOR_NOT_MAPPABLE`
- `LOCAL_DOCUMENTS_PATH_UNAVAILABLE`

## 13. 主进程服务边界

新增或拆分：

- `AnalysisSessionService`
  - 列表、标题、归档、恢复、删除。
- `AnalysisBranchService`
  - 路径解析、回退、切换、自动分支。
- `AnalysisContextBuilder`
  - 当前分支祖先链和上下文预算。
- `AnalysisAnchorResolver`
  - 锚点校验、重定位和失效状态。

保留：

- `CodeAnalysisService`
  - 回合执行和项目/无项目模型调用。
- `AnalysisAnnotationService`
  - 批注和讨论消息持久化。
- `CodeAnalysisToolRegistry`
  - 项目目录内只读工具。

服务不得依赖渲染进程状态完成归属和权限校验。

## 14. UI 设计

### 14.1 左侧项目与会话树

- 项目文件夹行右侧提供“新建会话”图标按钮。
- 无项目文件夹行提供同样入口。
- 会话行显示标题，不再显示每个独立回合。
- 会话更多菜单包含重命名、归档/恢复和永久删除。
- 活跃与归档使用页签或分段控件切换。
- 全局最近会话跨项目显示活跃会话。
- 文件夹计数表示活跃会话数。

### 14.2 中央多轮对话

- 每个回合连续显示用户输入和助手 Markdown。
- 历史助手回合提供图标操作：
  - 回退到此处。
  - 从此创建分支。
- 当前节点有明确状态标识。
- 会话顶部显示标题和分支选择器。
- 发送后新回合以流式或运行中状态追加，不清空历史消息。
- 归档会话的输入框禁用，并提供恢复按钮。

### 14.3 右侧批注

- 批注按回合分组。
- 当前回合或当前原文标记对应的批注优先展示。
- 折叠头显示选中文本摘要、状态和批注数量。
- 展开内容显示问题、AI 回复和“查看原文”链接。
- 不使用嵌套卡片。
- 展开/折叠动画为 150 至 200ms，并支持 `prefers-reduced-motion`。

### 14.4 删除确认

确认对话框必须显示：

- 会话标题。
- “此操作不可恢复”。
- 将删除回合、分支、批注、回复、工具轨迹和本地文件。
- 取消按钮。
- 明确的危险操作按钮。

## 15. 文件删除与一致性

数据库是会话内容的权威来源。

永久删除流程：

1. 查询会话下所有回合 ID。
2. 对每个回合生成并校验 `generated-documents/<documentId>` 相对路径。
3. 在同一事务中先写入 `analysis_file_cleanup_queue`，再删除会话并依赖外键级联删除数据库记录。
4. 事务提交后，队列消费者逐条删除本地目录。
5. 删除成功后移除队列记录；失败时记录错误、递增尝试次数并返回 `cleanupPending: true`。
6. 应用启动时只重试清理队列表，不执行全目录孤立文件扫描。

文件或目录不存在视为清理成功。文件清理失败不恢复已删除的数据库会话。

## 16. 并发与状态保护

- 一个会话同一时刻只允许一个运行中回合。
- 发送时使用会话级运行锁。
- 运行中禁止归档、永久删除、切换分支和回退。
- 切换会话、分支和回合继续使用递增请求 ID 防止迟到响应覆盖新状态。
- LLM 失败保留失败回合和之前的所有历史。
- 批注回复失败不影响会话分支状态。

## 17. 测试策略

### 17.1 数据库迁移测试

- 旧文档迁移为独立会话和主分支。
- 项目与无项目会话归属正确。
- 批注、回复和工具轨迹数量不变。
- 迁移重复执行不产生重复会话或分支。
- 会话永久删除级联删除全部子记录。
- 永久删除在同一事务中持久化全部文件清理任务。
- 清理队列不受回合级联删除影响。
- 跨会话活动指针、分支归属、回合归属和父链写入被触发器拒绝。
- 回合父链的自引用和间接环路被触发器拒绝。
- `PRAGMA foreign_key_check` 为空。
- Electron 真实 SQLite ABI 下执行迁移验证。

### 17.2 服务单元测试

- 首轮发送原子创建会话、主分支和回合。
- 同一会话第二次输入追加回合，不创建新会话。
- 分支头续写不创建新分支。
- 历史节点续写创建新分支且保留原分支。
- `forceFork = true` 在分支头也创建新分支；无父回合或无会话时拒绝请求。
- 回退不删除任何记录。
- 回退使用请求中的分支上下文，并允许该路径上的共享祖先回合。
- 回退到非分支头后续写会自动分叉；选择分支头后续写不会误分叉。
- 跨会话回退被拒绝，且不修改任何活动指针。
- 切换分支返回正确祖先路径。
- 上下文只拼接当前分支祖先链。
- 60,000 字符预算按完整回合裁剪最旧历史。
- 无项目多轮会话不调用目录工具。
- 归档过滤、恢复、重命名和删除确认。
- 非法跨会话/跨分支归属被拒绝。
- 文件清理成功后删除队列记录。
- 文件清理失败后保留队列记录、递增尝试次数，并可在下次启动重试。
- 绝对路径和包含目录穿越的清理路径被拒绝。

### 17.3 锚点测试

- offset 校验成功。
- 重复文本由 prefix/suffix 正确消歧。
- Markdown 加粗、链接、行内代码和跨文本节点选择。
- 原文未变化时重新打开仍能定位。
- 锚点失效时不错误高亮其他文本。
- 同一范围多批注合并为一个标记。

### 17.4 UI 组件测试

- 项目文件夹和无项目文件夹均可新建草稿会话。
- 草稿未发送时不调用持久化 IPC。
- 同一会话连续发送追加回合。
- 标题编辑的保存、取消和校验。
- 归档、恢复和永久删除确认。
- 回退、自动分支和分支切换。
- 显式分支草稿在首次发送前不持久化，发送时使用 `forceFork`。
- 迟到响应不覆盖新会话或新分支。
- 点击批注定位原文。
- 点击原文标记展开批注。
- 批注折叠状态和键盘操作。

### 17.5 端到端验收

使用 Electron + Playwright 验证：

1. 选择项目目录。
2. 在项目文件夹下点击“新建会话”。
3. 发送第一条消息并生成首个回合。
4. 在同一会话发送第二条消息，确认上下文包含第一轮。
5. 回退到第一轮并发送新消息，确认创建新分支。
6. 在分支间切换，确认内容互不污染。
7. 创建批注并测试双向定位和折叠。
8. 重命名、归档、恢复会话。
9. 永久删除并验证所有关联记录和本地文件。
10. 重启应用，确认状态持久化。

## 18. 验收标准

### 会话

- [ ] 项目文件夹和无项目文件夹均有“新建会话”入口。
- [ ] 点击入口只创建前端草稿。
- [ ] 第一条消息发送后才持久化会话。
- [ ] 后续输入追加到同一会话。
- [ ] 重启应用后多轮历史仍存在。
- [ ] 会话标题可编辑并持久化。
- [ ] 会话可归档、恢复和永久删除。
- [ ] 最近会话跨项目显示，默认排除已归档会话。

### 多轮上下文

- [ ] LLM 收到当前分支从根到当前节点的历史用户/助手消息。
- [ ] 项目上下文只注入一次。
- [ ] 无项目会话不获得目录工具。
- [ ] 兄弟分支内容不会进入当前分支上下文。
- [ ] 超出预算时只裁剪最旧完整回合并明确标记。

### 回退与分支

- [ ] 回退不会删除后续内容。
- [ ] 从历史节点继续发送时自动创建新分支。
- [ ] 原分支可继续查看和切换。
- [ ] 分支切换后当前节点和消息路径正确。
- [ ] 应用重启后当前分支和当前节点保持。

### 批注

- [ ] 原文显示持久化批注标记。
- [ ] 点击标记可展开并定位批注。
- [ ] 点击“查看原文”可定位并强调原文。
- [ ] 默认只展开当前批注。
- [ ] 重复文本和常见 Markdown 格式能正确定位。
- [ ] 定位失败时显示明确失效状态，不高亮错误文本。

### 删除与安全

- [ ] 永久删除必须二次确认。
- [ ] 删除级联覆盖会话、分支、回合、批注、回复和轨迹。
- [ ] 无项目本地文件被清理或进入可重试清理状态。
- [ ] 清理失败重启后只按持久化队列重试，不扫描或删除未登记目录。
- [ ] 项目目录工具仍然只读且不能越过授权根目录。
- [ ] 所有写 IPC 校验对象归属。

## 19. 交付拆分建议

实现按以下顺序进行：

1. 数据模型、迁移和会话/分支服务。
2. 多轮上下文与回合执行。
3. 会话树、新建草稿和管理菜单。
4. 回退、自动分支和分支切换 UI。
5. Markdown 源位置映射和批注双向定位。
6. 永久删除文件清理。
7. Electron E2E 和回归验证。

每一步必须先写失败测试，再实现最小代码并验证。

## 20. 未决问题

无。本文已固定草稿持久化、多轮上下文、非破坏式回退、删除语义和批注展开策略。
