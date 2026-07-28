# AI Learning Agent - Phase 1 MVP 实施设计

> 版本：v1.0 | 日期：2026-07-13 | 状态：待审查
>
> 范围：Phase 1 MVP（W1-10），完成「导入文档 → 生成导读 → 阅读 → 批注 → AI 回复」最小闭环

---

## 一、概述

### 1.1 目标

完成 AI Learning Agent 的最小可用版本，包含：
- 项目脚手架（Electron + React 19 + TypeScript + Monorepo）
- 日志系统和测试框架
- 数据层（SQLite + Drizzle ORM + LanceDB）
- 抽象接口层（ILLMProvider / IContextBuilder / IMemoryManager）
- 后端核心服务（Document Parser + Companion Compiler + Vector Indexer）
- AI 层（LangChain + AI Reply Engine + 流式响应）
- 前端 UI（阅读器 + 批注面板 + AI 对话）
- MD3 双主题（亮色蓝白 + 暗色黑金）
- 集成测试 + 打包

### 1.2 团队

- 主要代码编写者：AI
- 验收者：用户
- 关键约束：完善的日志系统 + 测试系统

### 1.3 技术栈

| 层面 | 方案 |
|------|------|
| 桌面框架 | Electron 33+ |
| 前端 | React 19 + TypeScript |
| UI 框架 | Material Design 3（自定义 token） |
| 后端/Agent | LangChain + LangGraph + 抽象接口层 |
| 数据库 | SQLite + Drizzle ORM |
| 向量存储 | LanceDB（嵌入式） |
| 嵌入模型 | @xenova/transformers + all-MiniLM-L6-v2 |
| 构建 | electron-vite + pnpm + Turborepo |
| 测试 | Vitest + React Testing Library |
| 日志 | electron-log |

---

## 二、实施策略

采用**自底向上**策略（方案 A），质量优先：

```
W1-2: 脚手架 + 日志 + 测试框架 + CI
W3-4: 数据层（SQLite + LanceDB）+ 抽象接口定义
W5-6: 后端服务（Document Parser + Companion Compiler + Vector Indexer）
W7-8: AI 层（LangChain + 上下文工程 + AI Reply Engine）
W9:   前端 UI（阅读器 + 批注面板 + 主题系统）
W10:  集成测试 + 打包
```

---

## 三、详细设计

### 3.1 W1-2：脚手架与基础设施

#### Monorepo 结构

```
ai-learning-agent/
├── .github/workflows/          # CI
├── apps/desktop/               # Electron 应用
├── packages/
│   ├── shared/                 # 类型 + 工具
│   ├── core/                   # 核心算法 + 抽象接口
│   └── ai/                     # LangChain 实现
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

#### 日志系统

- 库：electron-log
- 分级：error / warn / info / debug / verbose
- 文件位置：
  - macOS：`~/Library/Logs/AI Learning Agent/`
  - Windows：`%USERPROFILE%\AppData\Roaming\AI Learning Agent\logs\`
- 轮转：按天轮转，保留 30 天，单文件上限 50MB
- 分类：main.log / error.log / renderer.log / ai.log

#### 测试框架

- 单元测试：Vitest
- 组件测试：React Testing Library
- 覆盖率目标：
  - packages/core：100%
  - packages/ai：80%+
  - apps/desktop/main：60%+
  - apps/desktop/renderer：不强制

#### CI

- GitHub Actions
- 触发：push / pull_request
- 步骤：lint → type-check → test --coverage

---

### 3.2 W3-4：数据层

#### SQLite 表结构

核心表：workspaces / documents / chapters / annotations / discussions / distillations

使用 Drizzle ORM 定义 schema，Drizzle Kit 管理迁移。

#### LanceDB 向量存储

- 嵌入模型：@xenova/transformers + all-MiniLM-L6-v2
- 分块策略：双层（标题分割 + 递归字符分割，512 tokens，50 overlap）
- 存储路径：`~/Documents/AI-Learning-Agent/vectors/<workspace-id>.lance/`

#### 测试策略

- SQLite：内存数据库（:memory:），测试 CRUD + 级联删除 + 事务
- LanceDB：临时目录，测试写入 + 检索 round-trip + 分块策略

---

### 3.3 W3-4（穿插）：抽象接口层

定义在 `packages/core/src/interfaces/`：

```typescript
interface ILLMProvider {
  id: string;
  tier: 'analysis' | 'simple';
  chat(messages: ChatMessage[]): Promise<ChatResult>;
  stream(messages: ChatMessage[]): AsyncIterable<StreamChunk>;
  healthCheck(): Promise<HealthStatus>;
}

interface IContextBuilder {
  build(ctx: ContextInput): Promise<BuiltContext>;
}

interface IMemoryManager {
  getConversation(annotationId: string): Promise<ChatMessage[]>;
  addToConversation(annotationId: string, msg: ChatMessage): Promise<void>;
  getRelevantMemory(query: string, workspaceId: string): Promise<MemoryEntry[]>;
  addMemory(entry: MemoryEntry): Promise<void>;
}
```

契约测试：任何实现都必须通过 `testLLMProviderContract` 等测试。

---

### 3.4 W5-6：后端核心服务

#### Document Parser

- PDF：pdf.js 提取文本 + 章节结构
- EPUB：epub.js 解析
- Markdown：按 # 标题分章节
- TXT：按段落分割

#### Companion Compiler（确定性索引，不消耗 token）

产出：book-profile + chapter-index + topic-index + entity-index

算法：正则 + 启发式 + TF-IDF

#### Vector Indexer

- 双层分块：标题分割 + 递归字符分割
- 嵌入：@xenova/transformers
- 写入：LanceDB

---

### 3.5 W7-8：AI 层

#### LangChain LLM 实现

```typescript
class LangChainLLM implements ILLMProvider {
  // 根据 provider 配置创建 ChatOpenAI 或 ChatAnthropic
  // 实现 chat / stream / healthCheck
}
```

#### AI Reply Engine

四层上下文注入：
1. 基础上下文（当前段落 ±1、章节路径）
2. 结构上下文（Companion Compiler 索引）
3. 语义上下文（LanceDB 向量检索 top-5）
4. 记忆上下文（Reading Memory 历史记录）

流式响应：SSE Block 协议（7 种 block 类型）

#### 两档路由

- 分析模型：文章生成、复杂批注回复
- 简单模型：大纲、摘要、翻译、简单回复
- 自动降级：分析模型不可用时 fallback 到简单模型

---

### 3.6 W9：前端 UI

#### MD3 主题系统

**亮色主题（蓝白）**：
- Primary: #1E3A8A（深蓝）
- Surface: #FFFFFF
- Background: #F8FAFC

**暗色主题（黑金）**：
- Primary: #F59E0B（琥珀金）
- Surface: #1C1917（暖黑）
- Background: #0C0A09

切换机制：ThemeContext + CSS 变量 + localStorage 持久化

#### 组件结构

```
renderer/
├── components/
│   ├── reader/        # OutlineTree, ContentRenderer, AnnotationMarker
│   ├── annotation/    # AnnotationPanel, DiscussionTree, AnnotationComposer
│   ├── ai/            # AiReplyStream, ToolCallCard, TokenUsageBadge
│   └── common/        # MarkdownRenderer, FloatingToolbar
├── hooks/             # useAnnotations, useDiscussion, useAiReply
├── contexts/          # WorkspaceContext, ReaderContext, ThemeContext
└── themes/            # light.ts, dark.ts, typography.ts, elevation.ts
```

#### IPC 通信

8 大命名空间：documents / annotations / agent / llm / vector / workspace / file / system

流式传输：agent:sendMessage 通过 IPC event 透传 SSE Block

#### 图标

- 库：Lucide React
- 尺寸：20px
- 描边：1.5px
- 颜色：currentColor

---

### 3.7 W10：集成测试 + 打包

#### 端到端流程测试

测试完整流程：导入文档 → 创建批注 → AI 回复 → 定位批注

#### electron-builder 打包

- macOS：DMG + ZIP
- Windows：NSIS + Portable
- Linux：AppImage + DEB

---

## 四、LLM 配置

### 环境变量

```bash
# 分析模型
ANALYSIS_PROVIDER=claude
ANALYSIS_API_KEY=sk-xxx
ANALYSIS_MODEL=claude-sonnet-4-20250514
ANALYSIS_BASE_URL=

# 简单模型
SIMPLE_PROVIDER=openai
SIMPLE_API_KEY=sk-xxx
SIMPLE_MODEL=gpt-4o-mini
SIMPLE_BASE_URL=
```

### 优先级

环境变量 > UI 设置（Phase 2）> 内置默认值

---

## 五、目录结构

```
ai-learning-agent/
├── .github/workflows/
│   ├── ci.yml
│   └── release.yml
├── apps/desktop/
│   ├── electron.vite.config.ts
│   ├── electron-builder.json
│   ├── package.json
│   ├── resources/
│   │   ├── icon.icns
│   │   ├── icon.ico
│   │   └── icon.png
│   └── src/
│       ├── main/
│       │   ├── index.ts
│       │   ├── ipc/
│       │   │   ├── documents.ts
│       │   │   ├── annotations.ts
│       │   │   ├── agent.ts
│       │   │   ├── llm.ts
│       │   │   ├── vector.ts
│       │   │   └── workspace.ts
│       │   ├── services/
│       │   │   ├── document-parser/
│       │   │   ├── companion-compiler/
│       │   │   ├── article-generator/
│       │   │   ├── annotation-engine/
│       │   │   ├── ai-reply-engine/
│       │   │   └── reading-memory/
│       │   ├── llm/
│       │   │   ├── interfaces/
│       │   │   │   ├── llm-provider.ts
│       │   │   │   ├── context-builder.ts
│       │   │   │   └── memory-manager.ts
│       │   │   ├── langchain/
│       │   │   │   ├── llm.ts
│       │   │   │   ├── context.ts
│       │   │   │   └── memory.ts
│       │   │   ├── router.ts
│       │   │   ├── config-manager.ts
│       │   │   └── cost-tracker.ts
│       │   ├── db/
│       │   │   ├── sqlite/
│       │   │   │   ├── schema.ts
│       │   │   │   └── migrations/
│       │   │   └── lancedb/
│       │   │       ├── client.ts
│       │   │       └── indexer.ts
│       │   └── utils/
│       │       ├── text-anchor.ts
│       │       ├── text-splitter.ts
│       │       └── file-watcher.ts
│       ├── preload/
│       │   └── index.ts
│       └── renderer/
│           ├── index.html
│           ├── App.tsx
│           ├── layouts/
│           │   └── ReaderLayout.tsx
│           ├── pages/
│           │   ├── Home.tsx
│           │   ├── Reader.tsx
│           │   └── Settings.tsx
│           ├── components/
│           │   ├── reader/
│           │   ├── annotation/
│           │   ├── ai/
│           │   └── common/
│           ├── hooks/
│           ├── contexts/
│           │   ├── WorkspaceContext.tsx
│           │   ├── ReaderContext.tsx
│           │   └── ThemeContext.tsx
│           ├── themes/
│           │   ├── light.ts
│           │   ├── dark.ts
│           │   ├── typography.ts
│           │   └── elevation.ts
│           └── styles/
│               └── globals.css
├── packages/
│   ├── shared/
│   │   ├── src/
│   │   │   ├── types/
│   │   │   └── utils/
│   │   └── package.json
│   ├── core/
│   │   ├── src/
│   │   │   ├── interfaces/
│   │   │   ├── companion-compiler.ts
│   │   │   ├── text-anchor.ts
│   │   │   └── text-splitter.ts
│   │   └── package.json
│   └── ai/
│       ├── src/
│       │   ├── interfaces/
│       │   ├── langchain/
│       │   ├── graphs/
│       │   ├── router.ts
│       │   └── config-manager.ts
│       └── package.json
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.json
└── README.md
```

---

## 六、里程碑验收标准

### M1（W2 结束）

- [ ] Monorepo 可运行（pnpm dev 启动空壳 Electron 应用）
- [ ] 日志系统工作（文件输出 + 控制台输出）
- [ ] 测试框架工作（vitest 运行空测试通过）
- [ ] CI 通过（lint + type-check + test）

### M2（W4 结束）

- [ ] SQLite 表创建成功，CRUD 测试通过
- [ ] LanceDB 写入 + 检索测试通过
- [ ] 抽象接口定义完成，契约测试通过
- [ ] Document Parser 可解析 Markdown

### M3（W6 结束）

- [ ] PDF/EPUB/Markdown 解析测试通过
- [ ] Companion Compiler 生成索引正确
- [ ] Vector Indexer 分块 + 嵌入 + 检索 round-trip 通过

### M4（W8 结束）

- [ ] LangChainLLM 契约测试通过
- [ ] AI Reply Engine 可生成流式回复（mock 或真实 LLM）
- [ ] 两档路由 + 自动降级测试通过

### M5（W10 结束）

- [ ] 前端 UI 可运行，双主题切换工作
- [ ] 完整流程测试通过：导入 → 阅读 → 批注 → AI 回复
- [ ] 打包成功（macOS DMG / Windows NSIS）
- [ ] 日志文件正确输出

---

## 七、风险与应对

| 风险 | 应对 |
|------|------|
| LangChain 在 Electron 主进程中的兼容性 | 充分测试，准备 fallback 到直调 API |
| PDF 解析准确度不足 | MVP 优先支持 Markdown，PDF best-effort |
| LanceDB Node.js binding 稳定性 | 备选 sqlite-vss |
| 向量模型下载慢 | 首次启动提示下载，提供手动安装指引 |
