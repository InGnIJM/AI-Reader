# AI-Reader 独立会话分支与树形管理设计规格

> 日期：2026-07-31
>
> 状态：待用户最终审核
>
> 范围：代码分析工作台的会话分支模型、完整复制、树形会话管理、旧数据迁移

## 1. 背景

当前实现采用“会话包含多个分支”的共享历史模型：

- `analysis_branches.parent_branch_id` 记录父分支。
- `analysis_branches.forked_from_document_id` 指向父分支回合。
- 子分支首个回合通过 `analysis_documents.parent_document_id` 引用父分支回合。
- `analysis_documents.branch_id` 将回合归属到分支。

该模型允许多个分支共享祖先回合，但带来以下问题：

1. 子分支不是独立数据副本，删除主分支会影响子分支历史。
2. 会话、分支和回合之间存在双向外键，级联删除会经过不满足触发器校验的中间状态。
3. 侧边栏只管理会话，分支功能隐藏在工作台局部控件中，用户无法直观看到分支关系。
4. “分支”和“独立学习会话”是两套管理语义，归档、删除和导航行为不一致。

## 2. 目标

1. 将用户可见分支改为完全独立的会话。
2. 创建分支时复制历史数据，不共享回合、批注、讨论、工具轨迹或文件。
3. 删除、归档或重命名一个会话时，不影响父会话、子会话或兄弟会话。
4. 在侧边栏使用树形结构展示会话来源关系。
5. 支持从会话列表复制完整会话。
6. 支持从指定历史回合复制截至该回合的完整历史。
7. 将现有多分支数据无损迁移为独立会话树。

## 3. 非目标

- 分支合并、冲突解决或内容回写。
- 跨项目复制会话。
- 多选批量归档、删除或移动。
- 在不同会话之间共享可变批注或讨论。
- 为重复内容引入引用计数、写时复制或内容寻址存储。
- 将代码分析分支映射为 Git 分支。

## 4. 核心术语

- **会话（Session）**：一条独立、线性的代码分析对话，拥有自己的回合及关联数据。
- **来源会话（Parent Session）**：创建当前会话副本时使用的源会话。
- **子会话（Child Session）**：通过复制来源会话全部或部分历史创建的新会话。
- **完整会话复制（Full Clone）**：复制来源会话的全部回合。
- **指定回合复制（Clone Through Turn）**：复制从首个回合到指定回合的祖先链。
- **会话树（Session Tree）**：通过 `parent_session_id` 构建的来源关系，仅用于组织和导航，不用于共享内容。

## 5. 已确认的产品决策

1. 用户可见分支采用“独立会话”模型。
2. 所有复制记录生成新 ID。
3. 完整复制包含回合、AI 输出、批注、讨论消息、工具轨迹和生成文件。
4. 侧边栏采用树形展示。
5. 删除父会话后，子会话保留并提升到父会话原层级。
6. 会话菜单提供“创建分支”，复制整个会话。
7. 对话时间线提供“从此处创建分支”，复制到选中回合。
8. 创建成功后自动打开新会话，来源会话保持不变。

## 6. 数据模型

### 6.1 `analysis_sessions`

会话自身成为用户可见分支节点：

```sql
CREATE TABLE analysis_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES code_projects(id) ON DELETE CASCADE,
  parent_session_id TEXT
    REFERENCES analysis_sessions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  head_document_id TEXT
    REFERENCES analysis_documents(id) ON DELETE SET NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

约束：

- `parent_session_id` 只表示来源关系，不表示内容依赖。
- 父会话和子会话必须属于同一个项目；无项目会话只能派生无项目会话。
- `parent_session_id` 不允许自引用或形成间接循环。
- `head_document_id` 必须属于当前会话，并指向线性回合链的最后一个回合。
- 删除会话前，服务将直接子会话的 `parent_session_id` 更新为被删会话的
  `parent_session_id`，使子会话提升到被删会话原层级。
- `ON DELETE SET NULL` 是异常路径的完整性兜底，不代替服务层的提升一级操作。
- 归档状态不级联。

父子项目一致性、父会话循环和头回合归属由 `BEFORE INSERT/UPDATE`
触发器校验。服务层在写入前重复校验并返回稳定业务错误码，触发器负责阻止
绕过服务层的非法 SQL。

索引：

```sql
CREATE INDEX idx_analysis_sessions_parent_status_updated
  ON analysis_sessions(parent_session_id, status, updated_at DESC);
```

### 6.2 `analysis_documents`

每个会话是一条线性回合链，不再需要 `branch_id`：

```sql
CREATE TABLE analysis_documents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL
    REFERENCES analysis_sessions(id) ON DELETE CASCADE,
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

约束：

- `parent_document_id` 为空表示会话首回合。
- 父回合必须属于同一会话。
- 每个非首回合只能指向当前会话中的直接前一回合。
- 不允许自引用或间接循环。
- 一个会话最多存在一个没有子回合的头节点。
- 正常写入只能追加到头节点；历史回合续写必须先创建独立子会话。

线性链索引：

```sql
CREATE UNIQUE INDEX ux_analysis_documents_session_root
  ON analysis_documents(session_id)
  WHERE parent_document_id IS NULL;

CREATE UNIQUE INDEX ux_analysis_documents_parent
  ON analysis_documents(parent_document_id)
  WHERE parent_document_id IS NOT NULL;
```

第一个索引保证每个会话最多一个首回合，第二个索引保证每个回合最多一个直接子回合。
父回合同会话、回合循环和会话头归属由数据库触发器校验。追加回合与更新
`head_document_id` 必须位于同一个 `BEGIN IMMEDIATE` 事务。

### 6.3 移除旧分支结构

最终迁移完成后移除：

- `analysis_branches` 表。
- `analysis_sessions.active_branch_id`。
- `analysis_sessions.active_document_id`，由语义明确的 `head_document_id` 取代。
- `analysis_documents.branch_id`。
- `listBranches`、`switchBranch`、`renameBranch` 等分支 IPC。
- 基于跨分支祖先链的解析和校验触发器。

## 7. 复制语义

### 7.1 复制范围

完整会话复制：

- 复制来源会话从首回合到头回合的全部回合。

指定回合复制：

- 校验目标回合属于来源会话。
- 复制从首回合到目标回合的完整祖先链。
- 目标回合成为新会话的头回合。

两种复制均包含：

- `analysis_documents`
- `analysis_tool_traces`
- `analysis_annotations`
- `analysis_discussion_messages`
- 每个回合对应的 `generated-documents/<document-id>/` 文件目录

不复制：

- 来源会话的归档状态；新会话始终为 `active`。
- 来源会话的创建时间和更新时间；新会话使用当前时间。
- 文件清理队列中的任务。
- 运行中回合的未完成流式状态。

### 7.2 ID 映射

复制操作在开始时生成：

- 新会话 ID。
- 每个回合的新 ID。
- 每条工具轨迹的新 ID。
- 每条批注的新 ID。
- 每条讨论消息的新 ID。

运行时复制建立旧 ID 到新 ID 的映射。旧数据迁移可能把一个共享祖先复制到
多个目标会话，因此迁移映射必须使用 `(targetSessionId, oldId) -> newId`，
不能使用全局 `oldId -> newId`。

映射完成后：

- 回合的 `parent_document_id` 指向复制后的父回合。
- 工具轨迹指向复制后的回合。
- 批注指向复制后的回合。
- 讨论消息指向复制后的批注。
- 文件目录使用复制后的回合 ID。

复制后的内容不保留指向来源回合、来源批注或来源讨论的外键。

### 7.3 默认名称

- 默认名称格式为 `<来源会话标题> - 分支 N`。
- `N` 为当前来源会话现存直接子会话标题中未使用的最小正整数。
- 名称计算和插入在 `BEGIN IMMEDIATE` 事务保护下完成。
- 创建对话框允许用户覆盖默认名称。
- 名称去除首尾空格，长度限制为 1 至 80 个字符。
- 会话标题不要求全局唯一；用户明确输入的重复标题允许保存。

### 7.4 可复制状态

- 活动且没有运行中回合的会话可以创建分支。
- 运行中的会话禁用两个创建入口。
- 已归档会话必须先恢复。
- 包含已完成或失败回合的会话可以复制，原状态和内容按历史记录保留。
- 来源会话为空时不允许创建分支。

## 8. 文件与事务一致性

SQLite 事务不能覆盖文件系统，因此引入持久化操作日志
`analysis_clone_operations`：

```sql
CREATE TABLE analysis_clone_operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('clone', 'migration')),
  source_session_id TEXT,
  target_session_id TEXT,
  state TEXT NOT NULL CHECK (
    state IN ('preparing', 'complete', 'failed')
  ),
  manifest_json TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

`manifest_json` 只保存受信任的相对文件路径、目标 ID 和清理范围，不保存对话
正文或用户提供的绝对路径。复制采用以下顺序：

1. 读取来源会话并完成全部归属校验。
2. 生成所有新 ID 和文件目录映射。
3. 单独提交一条 `state = 'preparing'` 的操作日志和可信清理清单。
4. 将来源文件复制到该操作专属的临时目录。
5. 确认所有文件复制成功。
6. 开启 `BEGIN IMMEDIATE` 数据库事务。
7. 再次校验来源会话状态、头回合和更新时间，防止复制期间发生写入。
8. 写入新会话及全部关联记录。
9. 将临时目录原子重命名为正式目录。
10. 在同一数据库事务中将操作日志更新为 `complete`。
11. 提交数据库事务。

失败处理：

- 数据库提交前失败：回滚数据库并删除临时目录和已创建的正式目录。
- 文件重命名失败：回滚数据库并删除本次复制产生的文件。
- 进程在数据库提交前退出：启动时根据 `preparing` 操作的可信清单删除临时目录
  和已经切换的正式目录，不执行全盘孤儿目录扫描。
- 数据库提交后清理失败：写入现有文件清理队列，由后台任务重试。
- `complete` 操作在确认所有目标记录可读取后异步清除；审计日志只记录稳定错误码。
- 来源会话始终保持不变。

## 9. 服务与 IPC

### 9.1 新服务

新增 `AnalysisSessionCloneService`，职责仅包括：

- 解析完整复制或指定回合复制范围。
- 构建全量 ID 映射。
- 复制关联数据库记录。
- 协调文件准备、事务提交和失败清理。
- 返回新会话详情。

会话列表、归档、恢复、重命名和删除仍由 `AnalysisSessionService` 负责。

### 9.2 IPC 契约

新增统一接口：

```ts
interface CodeAnalysisCloneSessionPayload {
  requestId: string;
  sourceSessionId: string;
  throughDocumentId?: string;
  title?: string;
}

interface CodeAnalysisCloneSessionResult {
  session: AnalysisSession;
  turns: AnalysisTurn[];
}

interface CodeAnalysisCloneProgress {
  requestId: string;
  stage:
    | 'preparing'
    | 'copying-files'
    | 'writing-database'
    | 'finalizing';
}
```

```text
codeAnalysis:cloneSession(payload)
codeAnalysis:cloneProgress(event)
```

规则：

- 不提供 `throughDocumentId` 表示完整会话复制。
- 提供 `throughDocumentId` 表示复制到指定回合。
- 不提供 `title` 时由主进程在事务中生成默认名称；提供时使用用户确认后的名称。
- `requestId` 由渲染进程生成，只用于关联阶段事件，不参与路径构造。
- 跨会话回合返回 `INVALID_OWNERSHIP`。
- 来源不存在返回 `SESSION_NOT_FOUND`。
- 来源已归档返回 `SESSION_ARCHIVED`。
- 来源正在运行返回 `SESSION_RUNNING`。
- 来源为空返回 `SESSION_EMPTY`。
- 标题无效返回 `INVALID_TITLE`。
- 文件复制失败返回 `CLONE_FILE_COPY_FAILED`。

移除用户可见分支后：

- 新会话首轮继续使用 `runTurn({ projectId, goal })`。
- 已有会话使用
  `runTurn({ sessionId, expectedHeadDocumentId, goal })`，其中
  `expectedHeadDocumentId` 必须与数据库中的 `head_document_id` 一致。
- `runTurn` 不再接受 `parentDocumentId` 和 `forceFork`。
- 头节点不一致返回 `SESSION_CHANGED`，渲染进程重新加载会话，不产生第二个头节点。
- `runTurn` 只允许在 `BEGIN IMMEDIATE` 事务中向会话头回合追加。
- 渲染进程选择历史回合只改变本地查看状态。
- 从历史回合继续必须先调用 `cloneSession`，然后在新会话追加回合。

### 9.3 下游服务调整

- 上下文构建按当前会话的线性回合链读取，不再解析跨分支祖先。
- 批注和讨论接口继续以回合 ID 为归属入口，无需接受来源会话 ID。
- 导出继续针对指定回合及其批注，不自动导出整棵会话树。
- 导入创建一个顶级线性会话，`parent_session_id` 为空。
- 文件清理按被删会话拥有的回合目录执行，不遍历子会话。
- `AnalysisSession` 增加 `parentSessionId` 和 `headDocumentId`，移除
  `activeBranchId` 和 `activeDocumentId`。
- `AnalysisTurn` 移除 `branchId`。

## 10. 侧边栏会话树

### 10.1 树构建

- 主进程返回扁平会话记录，渲染进程按 `parentSessionId` 构建树。
- 同级节点按 `updatedAt DESC` 排序。
- 父节点不在当前状态视图时，符合过滤条件的子节点提升为当前视图的顶级节点。
- 删除会话时，直接子节点改为指向被删会话的父节点；删除顶级会话时才设置为空。
- 支持任意深度；视觉缩进设置最大值，超过视觉上限后仍保留层级连接图标。

### 10.2 会话行

每个会话行提供：

- 展开或折叠子会话。
- 打开会话。
- 新建完整分支。
- 重命名。
- 归档或恢复。
- 永久删除。

子会话使用分支图标和层级连接线，不使用额外卡片。

### 10.3 创建对话框

会话列表入口：

- 标题为“创建会话分支”。
- 显示来源会话名称。
- 范围固定为“完整会话”。
- 提供预填充名称输入框。

时间线入口：

- 标题为“从此回合创建分支”。
- 显示来源会话和目标回合摘要。
- 范围显示“第 1 回合至第 N 回合”。
- 提供预填充名称输入框。

提交期间：

- 禁用确认和取消按钮。
- 显示确定性进度状态，不伪造百分比。
- 成功后关闭对话框并打开新会话。
- 失败时保留输入内容并显示可重试错误。

### 10.4 删除确认

存在子会话时，确认框必须显示：

```text
仅删除当前会话。其子会话不会被删除，并将提升一级。
```

删除当前选中会话后：

1. 优先选择同级下一会话。
2. 没有下一会话时选择同级上一会话。
3. 没有同级会话时选择父会话。
4. 均不存在时清空工作台。

主进程在一个 `BEGIN IMMEDIATE` 事务中完成删除：

1. 读取被删会话的 `parent_session_id`。
2. 将所有直接子会话改为指向该父会话。
3. 清空被删会话的 `head_document_id`。
4. 写入文件清理任务。
5. 删除指定会话。

`BEGIN IMMEDIATE` 保证步骤 1 至 5 期间不能并发插入新的直接子会话。

## 11. 对话时间线

- 接入现有 `ConversationTimeline` 的回合列表能力。
- 每个非运行中回合提供“从此处创建分支”操作。
- 当前头回合也允许创建分支，其语义是复制完整历史。
- 选择历史回合只用于查看，不修改数据库中的会话头节点。
- 历史回合查看状态下，输入区提示用户先创建分支才能继续。
- 创建成功后，新会话自动选中复制后的目标回合。
- 旧的分支切换下拉框、分支重命名和 `checkoutTurn` 持久化行为移除。

## 12. 旧数据迁移

### 12.1 目标版本

新增代码分析会话 schema 版本 3。

`analysis_clone_operations` 作为版本 2 可安全新增的恢复日志表，在准备文件前先
以独立幂等步骤创建；版本 3 正式结构继续保留该表。这样迁移事务尚未提交时，
启动恢复逻辑仍能读取可信清理清单。

迁移入口必须同时支持：

- 版本 2 多分支数据库迁移到版本 3。
- 全新数据库直接创建版本 3。
- 版本 3 重复启动不执行任何数据变更。

### 12.2 分支到会话的映射

对每个旧会话：

1. 校验分支父子关系、分叉回合归属和回合父链。
2. 找到 `parent_branch_id IS NULL` 的根分支。
3. 原会话 ID 保留给根分支对应的新线性会话。
4. 根分支保留原会话标题、项目、状态和时间字段。
5. 每个子分支按照拓扑顺序创建独立子会话。
6. 子会话的 `parent_session_id` 指向父分支对应的会话。
7. 子会话标题使用 `<原会话标题> - <旧分支名称>`，超过 80 字符时安全截断。
8. 子会话复制从根回合到该分支头回合的完整祖先链。
9. 每条祖先记录的批注、讨论、工具轨迹和文件完整复制。
10. 子会话状态继承旧会话状态。

迁移映射规则：

- 根分支对应的会话保留原会话 ID。
- 根分支原有回合及其关联记录保留原 ID。
- 每个子分支建立独立的
  `(targetSessionId, oldDocumentId) -> newDocumentId` 映射。
- 同一个共享祖先被复制到不同子会话时必须获得不同的新 ID。
- 旧 `active_branch_id` 不再表示全局选中状态；迁移后原会话的
  `head_document_id` 指向根分支头回合。
- 子会话的 `head_document_id` 指向该目标会话复制后的分支头回合。
- 应用当前没有持久化“最后打开会话”，迁移不猜测用户应自动打开哪个旧分支。

遗留状态：

- 旧回合文件目录不存在表示该回合没有文件产物，迁移继续。
- 文件目录存在但读取或复制失败时，迁移失败并完整回滚。
- 旧数据库中的 `running` 回合按异常退出处理，迁移后改为 `failed`，保留已有
  输入、输出片段和工具轨迹。

旧会话存在多个根分支、循环、缺失头节点或跨会话引用时，迁移必须失败并回滚，不得猜测修复。

### 12.3 迁移顺序

1. 在内存中生成全部目标会话维度的 ID 映射。
2. 写入 `kind = 'migration'`、`state = 'preparing'` 的持久化操作日志。
3. 准备所有需要复制的文件。
4. 开启数据库事务。
5. 创建版本 3 临时表和索引。
6. 写入线性会话、回合及关联记录。
7. 执行 `foreign_key_check` 和业务约束检查。
8. 替换旧表并移除旧触发器。
9. 写入 schema 版本 3。
10. 对不再由根会话保留的旧回合目录写入文件清理队列；共享祖先和根分支
    继续使用的旧目录不得进入清理队列。
11. 切换文件目录，并将迁移操作日志更新为 `complete`。
12. 提交数据库事务。
13. 提交成功后异步处理旧回合目录清理队列。

任何步骤失败：

- 数据库保持版本 2。
- 原文件保持不变。
- 本次生成的新文件被清理。
- 未提交的旧目录清理任务随事务回滚，不得删除版本 2 仍在使用的目录。
- 下次启动允许重新迁移。

## 13. 性能边界

- 单次复制默认不限制回合数量，但必须逐表批量写入，不能逐记录开启事务。
- 文件复制使用受限并发，默认最多同时复制 4 个回合目录。
- 复制期间不阻塞其他会话读取。
- 同一来源会话在复制期间禁止写入和再次复制。
- 大会话复制超过 500 ms 时显示持续进度状态。
- 进度只显示当前确定性阶段，不显示无法准确计算的百分比。
- 不在本阶段实现去重；数据库和文件体积增长属于独立会话语义的预期成本。

## 14. 安全与完整性

- 所有来源归属校验在主进程执行。
- 渲染进程不能提供目标项目 ID，新会话项目由来源会话派生。
- 文件路径只能由受信任的新回合 ID 构造，不能接受渲染进程路径。
- SQL 全部使用参数化语句。
- 日志记录会话 ID、复制阶段和稳定错误码，不记录完整对话内容。
- 删除和迁移完成后执行必要的外键检查。

## 15. 测试门禁

### 15.1 数据库与迁移

- 全新数据库创建版本 3。
- 版本 2 单分支迁移。
- 版本 2 多级分支迁移。
- 共享祖先回合在子会话中生成独立 ID。
- 批注、讨论和工具轨迹正确重映射。
- 文件复制成功和失败回滚。
- 删除父会话后子会话提升。
- 归档父会话不影响子会话。
- 迁移失败保持版本 2。
- 重复启动幂等。
- `foreign_key_check` 无错误。

### 15.2 服务

- 完整会话复制。
- 指定首回合、中间回合和头回合复制。
- 多级子会话创建。
- 默认名称递增和并发保护。
- 空会话、归档会话、运行中会话和跨会话回合拒绝。
- 来源在文件复制期间发生变化时拒绝提交。
- 删除父、子和兄弟会话互不影响。

### 15.3 渲染进程

- 树形构建、排序、展开和折叠。
- 父节点不在状态过滤结果时子节点提升。
- 会话菜单完整复制入口。
- 时间线指定回合复制入口。
- 创建对话框校验、提交状态、失败重试和焦点管理。
- 删除父会话后的选择规则。
- 运行中和归档状态禁用规则。
- 中英文文案和键盘操作。

### 15.4 E2E

1. 从会话列表复制完整会话并打开新会话。
2. 从中间回合创建子会话并继续分析。
3. 新旧会话内容、批注和讨论互不影响。
4. 删除父会话后子会话仍可打开、继续和再次分支。
5. 多级会话树在重启后保持。
6. 归档视图正确提升状态不同的子会话。
7. 旧版本多分支数据库启动后迁移并可正常使用。

## 16. 验收标准

- [ ] 用户可以从会话菜单完整复制会话。
- [ ] 用户可以从任意历史回合复制截至该回合的会话。
- [ ] 新会话拥有独立的回合、批注、讨论、工具轨迹和文件。
- [ ] 修改新会话不会改变来源会话。
- [ ] 删除来源会话不会删除或破坏子会话。
- [ ] 侧边栏以树形结构显示来源关系。
- [ ] 子会话支持相同的会话管理和再次分支操作。
- [ ] 旧多分支数据无损迁移为会话树。
- [ ] 不再存在跨会话文档引用。
- [ ] 类型检查、构建、单元测试和 E2E 门禁通过。
