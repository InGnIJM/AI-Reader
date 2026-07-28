# AI 学习 Agent 技术方案设计文档

> 版本：v1.1 | 日期：2026-07-13 | 作者：系统架构组
>
> v1.1 更新：移除内嵌 Ollama，改为纯 API 调用；LLM 路由改为 Agent 内置两档（分析/简单）；新增环境变量和可视化配置支持；支持不同厂商混搭（如 DeepSeek + Mimo）
>
> v1.2 更新：Agent 框架改为 LangChain + LangGraph + 抽象接口层；定义 ILLMProvider / IContextBuilder / IMemoryManager 抽象接口隔离框架依赖；未来可替换为自研实现
>
> 基于 6 个开源项目（reor、yomitomo、STORM、anything-llm、khoj、readpilot）的深度分析，
> 结合 4 个技术方向（文章生成、桌面架构、Agent/LLM 集成、批注系统）的横向对比结论撰写。

---

## 一、产品定义

### 一句话定位

**AI 学习 Agent** 是一款将任意长文本（书籍、论文、报告）转化为交互式课程，并提供逐章批注、AI 讨论、知识蒸馏全链路的桌面学习工具。

### 核心用户故事

**场景 1：深度学习一本技术书籍**

> 小明在读一本 800 页的《编译原理》，每章读完有疑问但无人讨论。
> 他将 PDF 导入 AI 学习 Agent，系统自动生成章节大纲和关键概念索引（Companion Compiler，参考 readpilot）。
> 读第 3 章"语法分析"时，他选中一段关于 LL(1) 文法冲突的描述，右键创建批注："为什么左递归会导致冲突？"
> AI 自动识别批注语义，结合当前章节上下文和全书索引，生成一个交互式回复，用具体例子解释原理。
> 小明追问后，AI 的回答自动关联到原批注下形成讨论线程。
> 学完这章后，小明在蒸馏面板中将所有批注和讨论提炼为 5 条学习笔记，AI 审核后发布到个人知识库。

**场景 2：研究论文精读**

> 研究员小红导入一篇 50 页的顶会论文。AI 学习 Agent 的 STORM 式文章生成器（参考 stanford-oval/storm）自动生成论文导读：背景动机 → 方法概览 → 实验分析 → 局限与展望。
> 小红在导读中标记 3 处疑问，分别对应方法细节、实验设置和统计显著性。
> 系统用提问驱动检索（Question-Driven Retrieval）在论文原文中定位相关段落，生成引用原文的 AI 回复。
> 小红将导读和批注导出为 Markdown 笔记，存入 Obsidian。

**场景 3：团队共读与知识沉淀**

> 技术团队 5 人共读《Designing Data-Intensive Applications》。
> 组长创建工作区，导入书籍，分配章节。每人阅读时产生的批注和讨论在工作区内共享（参考 khoj 的 Agent 共享机制）。
> 每周五下午，系统的蒸馏面板自动汇总本周所有成员的批注和讨论，AI 生成周报：关键概念、争议话题、待深入方向。
> 团队投票选出 3 条最有价值的蒸馏笔记，发布到团队飞书知识库。

### 产品边界

**做什么**：
- 导入 PDF/EPUB/Markdown/TXT 格式的长文本，自动构建结构化索引
- 基于 AI 生成文章的目录式导航阅读（参考 STORM 的大纲先行设计）
- 选中原文任意段落创建批注，AI 自动关联上下文生成回复
- 批注和讨论的树状组织、全文检索、跨章节关联
- 知识蒸馏：将批注和讨论提炼为结构化笔记，经 AI 审核后发布
- 多 LLM 提供商支持（云端 API），按任务复杂度两档路由（分析模型 / 简单模型）

**不做什么**：
- 不是通用笔记软件（不替代 Obsidian/Notion）
- 不是 PDF 阅读器（不替代 Adobe Acrobat，不处理复杂排版和表单）
- 不是社交平台（批注分享限于工作区成员，不做公域社区）
- 不是知识库搜索引擎（RAG 能力仅服务于当前工作区文本，不做企业级文档检索）
- 不是代码编辑器（代码块的阅读和批注支持有限，不处理复杂语法高亮和 LSP）

---

## 二、技术选型

### 技术选型总表

| 决策项 | 推荐方案 | 否决方案 | 决策理由 |
|--------|---------|---------|---------|
| 桌面框架 | **Electron 33+** | Tauri / PWA | reor、yomitomo、anything-llm 全部选 Electron，无一选 Tauri。原因：Node.js 生态对 AI/ML 库（@xenova/transformers、LanceDB Node binding）的支持远超 Rust 生态；PWA 无法访问本地文件系统和子进程 |
| 前端框架 | **React 19 + TypeScript** | Vue / Svelte | reor（React 18）、yomitomo（React 19）、anything-llm（React 18）全部选 React。Vercel AI SDK 的 React hooks 集成最成熟；社区 AI 组件库（聊天界面、Markdown 渲染、批注浮层）React 版本最完善 |
| 后端/Agent 框架 | **LangChain + LangGraph + 抽象接口层** | Claude Agent SDK / 纯自研 | 选 LangChain 理由：① 多厂商 LLM 统一接口内置；② 上下文工程（PromptTemplate、token 管理）现成；③ LangGraph 支持 STORM 管线多视角并行编排。通过**抽象接口层**隔离 LangChain 依赖，未来可替换为自研实现。Claude Agent SDK 深度绑定 Claude，不支持多厂商混搭，否决 |
| LLM 提供商集成策略 | **LangChain BaseChatModel + 两档路由 + 抽象接口** | 单一提供商锁定 | 基于 LangChain `BaseChatModel` 统一接口（内置 50+ 厂商适配），通过 `ModelRouter` 按两档（分析/简单）路由。定义 `ILLMProvider` 抽象接口隔离 LangChain 依赖，未来可替换为自研实现。用户通过环境变量或可视化设置页配置 |
| 数据存储（结构化） | **SQLite + Drizzle ORM** | JSON 文件 / PostgreSQL | yomitomo 的 19 表 SQLite 方案证明：SQLite 足够处理复杂关系模型（批注树、讨论线程、蒸馏链、记忆系统），Drizzle ORM 提供类型安全和迁移管理。不需要 PostgreSQL（太重，不适合桌面应用），JSON 文件无法高效查询和级联删除 |
| 数据存储（向量） | **LanceDB（嵌入式）** | pgvector / Chroma / Qdrant | reor 和 anything-llm 都选 LanceDB。嵌入式（无服务进程）、支持增量索引、文件体积小、查询速度快。Chroma 需要 Python 运行时，pgvector 需要 PostgreSQL，Qdrant 需要独立部署，都不适合桌面应用 |
| 本地嵌入模型 | **@xenova/transformers + all-MiniLM-L6-v2** | sentence-transformers（Python服务） | reor 的完全离线方案已验证。ONNX 运行时在 Node.js 中直接运行，无需 Python 环境 |
| 文章格式 | **Markdown（内部存储）+ HTML（渲染）** | 自定义格式 | reor 的"Markdown 文件即笔记"哲学：人可读可编辑，LLM 天然理解，版本控制友好。阅读时渲染为 HTML |
| 批注存储方案 | **SQLite + TextAnchor 三要素** | JSON / 独立文件 / 纯偏移量 | yomitomo 的 TextAnchor（exact → whitespace_insensitive → whitespace_agnostic 三层匹配）是唯一能可靠处理 AI 生成文本与原文精确绑定的方案 |
| 状态管理 | **React Context（简单场景）+ Effect（复杂场景）** | Redux / MobX / Zustand | yomitomo 用 Effect 函数式处理复杂异步流（AI 回复、批注同步、蒸馏管道），React Context 处理 UI 状态。按复杂度分级：全局 UI 状态用 Context，AI 交互流用 Effect |
| 构建工具 | **electron-vite** | Webpack / Turbopack | 专为 Electron 优化，同时处理 main/preload/renderer 三进程构建，HMR 支持好 |
| Monorepo 管理 | **pnpm + Turborepo** | npm workspaces / Lerna | yomitomo 的 Turborepo 方案：单向依赖分层、并行构建、远程缓存 |
| 国际化 | **i18next + react-i18next** | 自研 / FormatJS | yomitomo 的中英双语实践验证可行，插件生态丰富 |
| 定时任务调度 | **node-cron（单机）** | APScheduler（需要 Python） | readpilot 和 anything-llm 都用 node-cron 做本地定时任务（索引更新、自动蒸馏、备份）。不需要 khoj 式的分布式调度（桌面应用单用户） |

### 两档模型路由策略

Agent 内部按任务类型**自动路由**到对应档位，用户无需关心路由逻辑，只需配置每档使用哪个模型。

**路由逻辑（Agent 内置，不可更改）**：

| 任务类型 | 路由档位 | 理由 |
|---------|---------|------|
| 文章结构解析（章节识别） | **规则引擎**（不消耗 token） | 正则/启发式算法 100% 准确，不需要 LLM |
| 关键概念提取 | 简单模型 | 结构化提取任务，廉价模型即可胜任 |
| 大纲生成 | 简单模型 | STORM 证明廉价模型可胜任大纲任务 |
| 批注 AI 回复（短/简单） | 简单模型 | 概念解释、翻译、摘要类回复 |
| 批注 AI 回复（长/复杂） | 分析模型 | 需要深度推理，如数学证明、代码分析、跨章节关联 |
| 文章全文生成 | 分析模型 | STORM 的分层策略：写作用昂贵模型 |
| 蒸馏总结 | 简单模型 | 已有充足上下文，只需归纳提炼 |
| 翻译 | 简单模型 | 翻译任务对模型能力要求低 |

**自动降级策略**：分析模型不可用（API 故障 / 超时 / 预算超限）时，自动 fallback 到简单模型，UI 中标注"已降级到简单模型，结果可能不够深入"。

### 模型配置方案

两档模型完全独立配置，支持**不同厂商混搭**（如分析模型用 DeepSeek，简单模型用 Mimo）。

配置方式：**环境变量 > 可视化设置页 > 内置默认值**。

**环境变量**：

```bash
# .env（开发环境）或系统环境变量（生产环境）
# 两档模型独立配置，支持任意厂商混搭

# ── 分析模型（复杂任务：文章生成、深度推理） ──
ANALYSIS_PROVIDER=deepseek           # claude / openai / deepseek / custom
ANALYSIS_API_KEY=sk-xxx
ANALYSIS_MODEL=deepseek-v4-pro
ANALYSIS_BASE_URL=                   # 可选，自定义 API 端点（代理 / 本地部署）

# ── 简单模型（日常任务：大纲、摘要、翻译） ──
SIMPLE_PROVIDER=custom               # 使用 OpenAI 兼容接口
SIMPLE_API_KEY=sk-xxx
SIMPLE_MODEL=mimo-v2.5-pro
SIMPLE_BASE_URL=https://api.example.com/v1

# ── 预算控制（可选） ──
LLM_BUDGET_PER_DOCUMENT=0.50        # 每文档上限（美元）
LLM_BUDGET_MONTHLY=20.00            # 每月上限（美元）
```

**本地模型接入**：无需特殊集成，通过 `BASE_URL` 指向本地 API 即可。例如用户本地部署了 Ollama：

```bash
SIMPLE_PROVIDER=custom
SIMPLE_API_KEY=ollama                # Ollama 不校验 key，填任意值
SIMPLE_MODEL=qwen2.5:7b
SIMPLE_BASE_URL=http://localhost:11434/v1
```

**可视化设置页**：

```
┌─────────────────────────────────────────────────────────┐
│  ⚙️ 设置 — AI 模型配置                                   │
│                                                         │
│  ┌─ 分析模型（复杂任务：文章生成、深度推理）──────────┐   │
│  │  提供商:  [DeepSeek                      ▾]        │   │
│  │  API Key: [sk-••••••••••••]  [👁] [测试连接]      │   │
│  │  模型:    [deepseek-v4-pro               ▾]       │   │
│  │  Base URL:[https://api.deepseek.com/v1   ]       │   │
│  │  状态:    🟢 已连接 | 延迟 150ms                  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─ 简单模型（日常任务：大纲、摘要、翻译）────────────┐   │
│  │  提供商:  [自定义 (OpenAI 兼容)            ▾]      │   │
│  │  API Key: [sk-••••••••••••]  [👁] [测试连接]      │   │
│  │  模型:    [mimo-v2.5-pro                  ▾]      │   │
│  │  Base URL:[https://api.example.com/v1    ]        │   │
│  │  状态:    🟢 已连接 | 延迟 95ms                   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─ 预算控制 ───────────────────────────────────────┐   │
│  │  每文档上限:  [$ 0.50]  每月上限:  [$ 20.00]      │   │
│  │  本月已用:    $ 3.42 / $ 20.00  ████████░░ 17%   │   │
│  │  [✓] 预算超限时自动降级到简单模型                  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─ 高级 ───────────────────────────────────────────┐   │
│  │  [ ] 从 .env 文件读取配置（优先级最高）            │   │
│  │  [重置默认]  [导出配置]  [导入配置]                │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│                        [保存]  [取消]                    │
└─────────────────────────────────────────────────────────┘
```
│                                                         │
│  ┌─ 高级 ───────────────────────────────────────────┐   │
│  │  [ ] 从 .env 文件读取配置（优先级最高）            │   │
│  │  [重置默认]  [导出配置]  [导入配置]                │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│                        [保存]  [取消]                    │
└─────────────────────────────────────────────────────────┘
```

---

## 三、系统架构

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    渲染进程 (Renderer)                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ 阅读器 UI │ │ 批注面板  │ │ AI 对话   │ │ 蒸馏/导出面板 │  │
│  │ (React)   │ │ (React)   │ │ (React)   │ │ (React)       │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘  │
│       │             │             │               │          │
│       └─────────────┴─────────────┴───────────────┘          │
│                         │ React Context (UI 状态)              │
│                         │ Effect Runtime (AI 交互流)           │
│                         │ Vercel AI SDK (流式响应)              │
├─────────────────────────┼────────────────────────────────────┤
│                contextBridge (类型安全 IPC)                     │
│  6 大命名空间: documents / annotations / agent / workspace    │
│               llm / vector / file / system                     │
├─────────────────────────┼────────────────────────────────────┤
│                    主进程 (Main)                                │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────────┐ │
│  │ 文档解析器  │ │ 索引引擎   │ │ Agent 调度 │ │ LLM 管理器   │ │
│  │ PDF/EPUB/  │ │ Companion │ │ Skill 注入 │ │ 适配器模式   │ │
│  │ MD/TXT     │ │ + 向量索引 │ │ 工作区隔离 │ │ 分层路由     │ │
│  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └──────┬──────┘ │
│        │              │              │               │        │
│        └──────────────┴──────────────┴───────────────┘        │
│                         │                                      │
│              ┌──────────┴──────────┐                          │
│              │   数据层             │                          │
│              │ ┌────────┐ ┌──────┐ │                          │
│              │ │ SQLite │ │LanceDB│ │                          │
│              │ │(Drizzle)│ │(向量) │ │                          │
│              │ └────────┘ └──────┘ │                          │
│              │ ┌──────────────────┐ │                          │
│              │ │ 文件系统          │ │                          │
│              │ │ (工作区目录/缓存)  │ │                          │
│              │ └──────────────────┘ │                          │
│              └─────────────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

架构说明：

1. **三进程 Electron**（参考 reor/yomitomo）：主进程专注 I/O 和计算，预加载层用 contextBridge 暴露类型安全 API，渲染进程纯 UI。
2. **无独立后端服务**（参考 reor/yomitomo 的"主进程即后端"模式，非 anything-llm 的"内嵌 Express"模式）：桌面应用无需服务进程，IPC 通信足够。未来若需要 Web 版本，再抽离 Express 服务层（参考 anything-llm 的架构演进路径）。
3. **数据双轨**：SQLite 存结构化数据（批注、讨论、蒸馏、工作区元数据），LanceDB 存向量索引（语义检索、跨章节关联），文件系统存原始文档和导出产物。

### 模块划分及职责

| 模块 | 运行进程 | 职责 |
|------|---------|------|
| **Document Parser** | 主进程 | PDF/EPUB/Markdown/TXT 解析，提取纯文本和章节结构，生成标准化 AST |
| **Companion Compiler** | 主进程 | 确定性算法（不消耗 LLM token）生成全书级索引：book-profile + chapter-index + topic-index + entity-index（参考 readpilot） |
| **Vector Indexer** | 主进程 | 文本分块（双层：标题分割 + 递归字符分割，参考 reor），调用 @xenova/transformers 生成嵌入，写入 LanceDB |
| **Article Generator** | 主进程 | STORM 式 4 阶段管线：知识策展 → 大纲生成 → 文章生成 → 润色，中间产物持久化支持断点续跑 |
| **Agent Scheduler** | 主进程 | 基于 LangGraph 的 Agent 工作流管理，Skill 注入，工作区 CWD 隔离，STORM 管线多视角并行编排 |
| **LLM Manager** | 主进程 | 适配器模式统一接口（Claude/OpenAI/DeepSeek/自定义），ModelRouter 两档路由（分析/简单）+ 失败冷却 fallback，支持环境变量和可视化配置（参考 anything-llm + khoj） |
| **Annotation Engine** | 主进程 | 批注 CRUD，TextAnchor 三层匹配，树状讨论管理，级联删除（参考 yomitomo） |
| **Distillation Pipeline** | 主进程 | 批注→讨论→蒸馏→AI review→发布，完整知识提炼链（参考 yomitomo 独有设计） |
| **Reading Memory** | 主进程 | 跨章节/跨批注记忆累积，增量更新 + 版本管理（参考 yomitomo） |
| **Workspace Manager** | 主进程 | 工作区 CRUD，目录结构管理，会话生命周期，权限控制（参考 readpilot 的工作区模式） |
| **Reader UI** | 渲染进程 | 目录导航、内容渲染（Markdown→HTML）、批注浮层、AI 对话面板、蒸馏面板 |
| **Export Service** | 主进程 | Markdown/HTML/PDF 导出，飞书知识库发布，Obsidian vault 同步 |

### 数据流图：用户操作 → 系统响应

```
用户选中原文段落 → 右键"创建批注"
  │
  ├─ 1. Annotation Engine 接收请求
  │     ├─ TextAnchor 计算三要素（exact_match / prefix_suffix / content_hash）
  │     ├─ 写入 SQLite annotations 表
  │     └─ 返回批注 ID
  │
  ├─ 2. AI Reply Engine 被触发（异步）
  │     ├─ 构建上下文窗口：
  │     │   ├─ 当前段落 ×3（前后各一段）                    [原文上下文]
  │     │   ├─ 当前章节的 chapter-index（Companion Compiler） [章节结构]
  │     │   ├─ 相关段落的向量检索结果（LanceDB top-5）       [语义关联]
  │     │   └─ Reading Memory 中与本批注相关的历史记忆         [跨章节记忆]
  │     ├─ ModelRouter 路由到合适 LLM（两档）
  │     │   ├─ 简单任务 → 简单模型（如 GPT-4o-mini）
  │     │   └─ 复杂任务 → 分析模型（如 Claude Sonnet）
  │     ├─ 流式生成 AI 回复（SSE Block 协议，参考 readpilot）
  │     └─ 写入 SQLite discussion 表（关联批注 ID）
  │
  ├─ 3. Reading Memory 更新
  │     ├─ 提取批注中的关键概念
  │     ├─ 增量更新记忆向量
  │     └─ 版本管理（可回溯）
  │
  └─ 4. UI 更新
        ├─ 批注浮层出现高亮标记
        ├─ AI 回复面板实时流式显示
        └─ 蒸馏面板统计更新
```

### 前后端通信设计

采用 reor 的 contextBridge 模式，定义 8 大 IPC 命名空间：

```typescript
// 类型安全 IPC 工厂（参考 reor 的泛型 IPC 设计）
interface IPCNamespaces {
  documents: {
    import(path: string): Promise<DocumentMeta>;
    parse(docId: string): Promise<ParsedDocument>;
    getChapter(docId: string, chapterIndex: number): Promise<Chapter>;
  };
  annotations: {
    create(params: CreateAnnotationParams): Promise<Annotation>;
    listByChapter(docId: string, chapterIndex: number): Promise<Annotation[]>;
    createDiscussion(annotationId: string, content: string): Promise<Discussion>;
    getDiscussionTree(annotationId: string): Promise<DiscussionNode>;
  };
  agent: {
    startSession(workspaceId: string): Promise<SessionHandle>;
    sendMessage(sessionId: string, message: string): AsyncIterable<SSEBlock>;
    getTools(sessionId: string): Promise<Tool[]>;
  };
  llm: {
    listProviders(): Promise<LLMProviderMeta[]>;
    checkHealth(providerId: string): Promise<HealthStatus>;
  };
  vector: {
    search(workspaceId: string, query: string, topK: number): Promise<SearchResult[]>;
    indexDocument(docId: string): Promise<IndexProgress>;
  };
  workspace: {
    create(name: string): Promise<Workspace>;
    list(): Promise<Workspace[]>;
    getSession(workspaceId: string): Promise<Session[]>;
  };
  file: {
    readFile(path: string): Promise<Buffer>;
    writeFile(path: string, data: Buffer): Promise<void>;
    watchDirectory(path: string): AsyncIterable<FileChangeEvent>;
  };
  system: {
    getAppDataPath(): Promise<string>;
    checkDiskSpace(): Promise<DiskInfo>;
    getPlatform(): Promise<PlatformInfo>;
  };
}
```

通信协议选型：

- **命令-响应**（request/response）：适用于 CRUD 操作（创建批注、读取章节等），用 `ipcRenderer.invoke` / `ipcMain.handle`
- **流式传输**（streaming）：适用于 AI 回复生成，用统一 SSE Block 协议（参考 readpilot 的 7 种 block 类型：`thinking` / `text` / `tool_use` / `tool_result` / `citation` / `error` / `done`），通过 IPC 透传到渲染进程
- **事件推送**（push）：适用于文件变更通知、索引进度更新，用 `webContents.send` + `ipcRenderer.on`

---

## 四、核心模块设计

### 4.1 文章生成器（Article Generator）

参考 STORM 的 4 阶段管线设计，适配为"长文本导读生成器"：

```
Phase 1: 知识策展 (Knowledge Curation)
  ├─ 输入: 原始文档全文
  ├─ 处理:
  │   ├─ 1.1 多视角生成: LLM 生成 N=5 个专家视角（如：架构师、新手、批判者、实践者、领域专家）
  │   ├─ 1.2 并行对话: 每个视角独立与 LLM 进行 M=3 轮对话，每轮：
  │   │   ├─ 视角专家生成 3 个问题
  │   │   ├─ 提问驱动检索: 在文档中搜索相关段落（非关键词匹配，而是用 LLM 将问题转为搜索意图）
  │   │   └─ LLM 基于检索结果回答
  │   └─ 1.3 信息汇总: 合并 5 个视角的所有对话产出
  ├─ 输出: collected_info.json（持久化，支持断点续跑）
  ├─ LLM 成本策略:
  │   ├─ 提问生成: Claude Haiku（廉价）
  │   ├─ 对话回答: Claude Haiku（廉价）
  │   └─ 信息汇总: Claude Sonnet（中等）
  └─ 耗时估算: 约 2-5 分钟（取决于文档长度和 M 值）

Phase 2: 大纲生成 (Outline Generation)
  ├─ 输入: collected_info.json + 文档结构（Companion Compiler 的 chapter-index）
  ├─ 处理: LLM 生成分层大纲（≤3 层: 篇 → 章 → 节），每节附关键概念列表
  ├─ 输出: outline.json
  ├─ LLM: Claude Haiku / GPT-4o-mini（廉价）
  └─ 耗时估算: 约 30 秒

Phase 3: 文章生成 (Article Writing)
  ├─ 输入: outline.json + collected_info.json + 原文各章节
  ├─ 处理:
  │   ├─ 逐节生成（可并行，N 节用 N 个独立 LLM 调用）
  │   ├─ 每节生成时注入:
  │   │   ├─ 对应原文段落
  │   │   ├─ collected_info 中相关条目（向量检索 top-10）
  │   │   └─ 前一节摘要（保持连贯性）
  │   └─ 引用自然嵌入（STORM 方式: 不显式标注引用标记，通过 prompt 让 LLM 自然融入）
  ├─ 输出: article.md（每节独立文件，便于增量更新）
  ├─ LLM: Claude Sonnet（中等）
  └─ 耗时估算: 约 3-8 分钟（取决于章节数，可并行加速）

Phase 4: 文章润色 (Article Polishing)
  ├─ 输入: article.md
  ├─ 处理:
  │   ├─ 连贯性检查: 检测节间断裂、重复、矛盾
  │   ├─ 可读性优化: 段落长度、术语一致性、中文表达
  │   └─ 补充缺失: 检测 outline 中的概念是否都被覆盖
  ├─ 输出: article_final.md
  ├─ LLM: Claude Sonnet（中等，逐节检查）+ Claude Haiku（廉价，术语检查）
  └─ 耗时估算: 约 1-2 分钟
```

**管线设计原则**：
- 每阶段产物持久化到 `workspace/<id>/pipeline/` 目录，支持断点续跑
- 所有 LLM 调用都有超时和重试机制（最多 3 次）
- 用户可中断任意阶段，已完成的阶段不会丢失

### 4.2 阅读器（Reader UI）

参考 yomitomo 的阅读 UI 设计：

```
┌──────────────────────────────────────────────────┐
│  [目录]  阅读区                              [面板] │
│ ┌────────┬─────────────────────────┬──────────┐ │
│ │        │                         │          │ │
│ │ 大纲树  │   AI 生成的导读文章       │  批注面板  │ │
│ │        │   (Markdown 渲染)        │  ┌─────┐ │ │
│ │ ├─ 1章  │                         │  │批注1 │ │ │
│ │ │ ├─1.1│  ## 1.1 语法分析概述      │  │ 💬3  │ │ │
│ │ │ ├─1.2│                         │  │ 讨论  │ │ │
│ │ │ └─1.3│  LL(1) 文法是自顶向下     │  └─────┘ │ │
│ │ ├─ 2章  │  语法分析中最常用的一类。   │  ┌─────┐ │ │
│ │ │ ...  │                         │  │批注2 │ │ │
│ │        │  > 左递归会导致预测分析    │  │ 💬1  │ │ │
│ │        │  > 表产生冲突...    ←选中  │  └─────┘ │ │
│ │        │                         │          │ │
│ └────────┴─────────────────────────┴──────────┘ │
│                                                  │
│  [导读模式] [原文模式] [对照模式]    [蒸馏面板] [导出] │
└──────────────────────────────────────────────────┘
```

**三种阅读模式**：

1. **导读模式**（默认）：显示 AI 生成的结构化导读（Phase 3 产物），左侧大纲树联动导航
2. **原文模式**：显示解析后的原文（Markdown 格式），保留原始章节结构
3. **对照模式**：左右分栏，左侧导读右侧原文，同步滚动

**交互设计**：
- 选中文本 → 弹出浮动工具栏（创建批注 / AI 提问 / 复制 / 高亮）
- 批注标记以侧边竖线 + 图标显示在文本左侧
- 点击批注标记 → 右侧批注面板滚动到对应批注，展开讨论树
- 大纲树中的节点可折叠/展开，章节标题旁显示批注数量徽标

### 4.3 批注系统（Annotation System）

以 yomitomo 的批注系统为蓝本，融合 readpilot 的 Agent 工作区模式。

#### 数据模型

```typescript
// 批注 — 核心实体
interface Annotation {
  id: string;                    // UUID
  workspaceId: string;           // 所属工作区
  documentId: string;            // 所属文档
  chapterId: string;             // 所属章节

  // TextAnchor 三要素（yomitomo 方案）
  anchor: {
    exactMatch: string;          // 精确匹配字符串（原始文本）
    prefixSuffix: {              // 前后缀上下文（用于模糊匹配）
      prefix: string;            // 前面 50 字符
      suffix: string;            // 后面 50 字符
    };
    contentHash: string;         // 内容 SHA256（去重和版本检测）
  };

  // 批注内容
  type: AnnotationType;          // 'highlight' | 'note' | 'question' | 'dispute' | 'summary'
  content: string;               // Markdown 格式
  aiReplyStatus: 'pending' | 'generating' | 'done' | 'error';

  // 元数据
  createdAt: Date;
  updatedAt: Date;
  userId: string;                // 批注创建者（单用户模式为 'local'）
  tags: string[];                // 用户自定义标签

  // SEO/检索
  searchableText: string;        // content 的纯文本版本
}

// 讨论（树状嵌套，参考 yomitomo）
interface Discussion {
  id: string;
  annotationId: string;          // 关联批注
  parentId: string | null;       // 父讨论 ID（null 表示顶层）

  role: 'user' | 'ai';          // 发言者
  content: string;               // Markdown 格式
  modelId?: string;              // 如果是 AI，记录用了哪个模型

  // AI 元数据
  tokenUsage?: {                 // 本次回复的 token 消耗
    input: number;
    output: number;
    model: string;
    cost: number;                // 美元
  };
  contextDigest?: string;        // AI 回复时注入了哪些上下文（人类可读摘要）

  createdAt: Date;
  updatedAt: Date;
}

// 蒸馏条目（yomitomo 独有）
interface Distillation {
  id: string;
  workspaceId: string;
  sourceIds: string[];           // 来源批注 ID 列表
  sourceDiscussionIds: string[]; // 来源讨论 ID 列表

  content: string;               // Markdown 格式的提炼笔记
  status: 'draft' | 'pending_review' | 'approved' | 'published';

  aiReview?: {                   // AI 审核结果
    score: number;               // 质量评分 1-10
    suggestions: string[];       // 改进建议
    reviewedAt: Date;
  };

  publishedTo?: {                // 发布目标
    type: 'local' | 'feishu' | 'obsidian' | 'notion';
    url?: string;
    publishedAt: Date;
  };

  createdAt: Date;
  updatedAt: Date;
}
```

#### TextAnchor 三层匹配策略

参考 yomitomo，这是整个批注系统最关键的技术点：

```
用户创建批注时：
  1. 获取选中的精确文本 → exactMatch
  2. 取选中文本前 50 字符 → prefix
  3. 取选中文本后 50 字符 → suffix
  4. 计算 exactMatch 的 SHA256 → contentHash
  5. 写入数据库

用户重新打开文档时（定位批注）：
  Layer 1: exact_match — 在渲染后的文本中查找 exactMatch 字符串
    ├─ 找到 → 定位成功，渲染批注标记
    └─ 未找到 → 进入 Layer 2

  Layer 2: whitespace_insensitive — 忽略空白字符差异后查找
    ├─ 原文可能被重新排版（换行位置改变、多余空格）
    ├─ 将 exactMatch 和渲染文本都 normalize（合并连续空白）
    ├─ 找到 → 定位成功
    └─ 未找到 → 进入 Layer 3

  Layer 3: whitespace_agnostic + prefix_suffix — 用前后缀定位
    ├─ 在渲染文本中查找 prefix 的最长公共子串
    ├─ 在渲染文本中查找 suffix 的最长公共子串
    ├─ 取 prefix 结束位置和 suffix 开始位置之间的文本
    ├─ 对比 contentHash 确认一致性
    ├─ 找到 → 定位成功
    └─ 未找到 → 标记批注为"原文已变更"，降级显示
```

**为什么不用纯偏移量**：文档重新排版后行号/字符偏移全部失效。TextAnchor 基于内容匹配，排版变化不影响定位。

#### UI 锚定方案

```
阅读区渲染时：
  1. 加载当前章节的所有批注
  2. 对每个批注，用 TextAnchor 在渲染后的 HTML 中查找匹配文本
  3. 在匹配位置注入 <mark data-annotation-id="xxx" class="annotation-highlight">
  4. 点击 <mark> → 触发 IPC → 右侧批注面板滚动到对应条目
  5. 悬停 <mark> → 浮窗显示批注摘要

批注面板：
  - 按章节分组显示
  - 每个批注卡片：原文片段 + 用户批注内容 + 讨论数徽标
  - 点击卡片 → 展开讨论树（树状嵌套渲染）
  - AI 回复用流式渲染（逐 token 显示）
  - 支持内联追问（在讨论树下新增回复）
```

### 4.4 AI 回复引擎（AI Reply Engine）

#### 上下文构建策略

参考 yomitomo 的 Reading Memory + readpilot 的 Companion Compiler + khoj 的混合搜索：

```
上下文窗口构建流程（每次 AI 回复前执行）：

Step 1: 基础上下文（必须注入）
  ├─ 当前选中段落（用户批注的原文）
  ├─ 前后各 1 段（±1 paragraph context）
  ├─ 当前章节标题和层级路径（如 "第 3 章 > 3.2 语法分析 > 3.2.1 LL(1) 文法"）
  └─ 文档元信息（书名/论文标题、作者、类型）

Step 2: 结构上下文（Companion Compiler）
  ├─ chapter-index: 当前章节在整个文档中的位置和前后章节摘要
  ├─ topic-index: 当前段落涉及的关键概念及其在文档中的分布
  └─ entity-index: 当前段落提到的人名/术语/公式的交叉引用

Step 3: 语义上下文（向量检索，参考 reor + khoj）
  ├─ 将批注内容转为查询向量
  ├─ LanceDB 中检索 top-5 最相关段落（跨章节）
  ├─ CrossEncoder 重排序（参考 khoj 的 pgvector 粗排 → CrossEncoder 精排）
  └─ 只注入排名前 3 的段落（控制 token 消耗）

Step 4: 记忆上下文（Reading Memory，参考 yomitomo）
  ├─ 检索 Reading Memory 中与本批注关键词相关的历史记录
  ├─ 只注入近 30 天内、相关性 > 0.7 的记忆
  └─ 附带记忆的时间戳和来源批注引用

Step 5: 组装 System Prompt
  ├─ prompt = template(role, bookContext, chapterContext, semanticContext, memoryContext)
  ├─ 注入当前工作区的 Skill（从 skills/ 目录读取 SKILL.md）
  └─ 注入工具列表（向量搜索、章节查询、记忆查询）
```

#### 流式响应协议

参考 readpilot 的统一 SSE Block 协议：

```typescript
// 7 种 Block 类型
type SSEBlock =
  | { type: 'thinking'; content: string }        // AI 思考过程（可折叠显示）
  | { type: 'text'; content: string }            // 正文内容（逐 token 流式）
  | { type: 'tool_use'; toolName: string; input: Record<string, unknown> }  // AI 调用工具
  | { type: 'tool_result'; toolName: string; output: string }               // 工具执行结果
  | { type: 'citation'; source: string; excerpt: string }                   // 引用原文
  | { type: 'error'; code: string; message: string }                        // 错误
  | { type: 'done'; tokenUsage: TokenUsage }     // 完成信号 + token 统计
```

前端渲染规则：
- `thinking` 默认折叠，用户可展开（减少视觉干扰）
- `text` 用 Markdown 渲染，支持代码高亮、数学公式
- `tool_use` / `tool_result` 显示为可折叠的工具调用卡片
- `citation` 渲染为悬浮引用卡片（鼠标悬停显示原文）
- `error` 渲染为红色错误提示，附带重试按钮
- `done` 更新 token 用量统计面板

### 4.5 Agent 调度器（Agent Scheduler）

基于 LangGraph 的 Agent 工作流管理，通过抽象接口隔离框架依赖：

```
Agent Scheduler 架构：

┌─────────────────────────────────────────────────┐
│              Agent Scheduler                     │
│                                                  │
│  ┌──────────────┐  ┌──────────────┐             │
│  │ Skill Manager │  │ LLM Manager   │             │
│  │              │  │              │             │
│  │ - 加载 Skill  │  │ - 适配器注册  │             │
│  │ - 注入 CWD   │  │ - 健康检查    │             │
│  │ - 工具注入   │  │ - 分层路由    │             │
│  │ - MCP 管理   │  │ - 失败冷却    │             │
│  └──────┬───────┘  └──────┬───────┘             │
│         │                  │                     │
│  ┌──────┴──────────────────┴───────┐             │
│  │       Session Manager            │             │
│  │                                  │             │
│  │ - 每个工作区独立 CWD              │             │
│  │ - 会话上下文隔离                  │             │
│  │ - 工具权限按工作区分级            │             │
│  └──────────────────────────────────┘             │
└─────────────────────────────────────────────────┘

工作区模式（参考 readpilot）：
  workspace/<id>/
    ├── cwd/                    # Agent 工作目录
    │   ├── source/             # 原始文档副本
    │   ├── pipeline/           # 管线中间产物
    │   └── exports/            # 导出产物
    ├── skills/                 # 工作区级 Skill
    │   └── SKILL.md
    ├── memory/                 # Reading Memory 持久化
    └── sessions/               # 会话历史
        ├── session_001.json
        └── session_002.json

工具权限三层（参考 readpilot）：
  Layer 1: 只读 — 向量搜索、章节查询、记忆查询、文档搜索
  Layer 2: 全放行（需确认）— 创建批注、写入讨论、更新记忆
  Layer 3: 按内容判断 — 删除批注/讨论（需用户确认，带撤销窗口）
```

#### LLM Manager 设计（LangChain + 抽象接口）

**架构分层**：通过抽象接口隔离 LangChain 依赖，未来可替换为自研实现。

```
┌─────────────────────────────────────────────────────────────┐
│                    上层业务代码                               │
│         （Article Generator、AI Reply Engine 等）             │
│                         ↓ 调用                               │
├─────────────────────────────────────────────────────────────┤
│              抽象接口层（零依赖）                              │
│  ┌─────────────┐ ┌──────────────┐ ┌───────────────┐         │
│  │ ILLMProvider │ │IContextBuilder│ │IMemoryManager │         │
│  └──────┬──────┘ └──────┬───────┘ └───────┬───────┘         │
├─────────┼───────────────┼─────────────────┼─────────────────┤
│         ↓               ↓                 ↓                 │
│              LangChain 实现层（可替换）                        │
│  ┌─────────────┐ ┌──────────────┐ ┌───────────────┐         │
│  │LangChainLLM │ │LangChainCtx  │ │LangChainMem   │         │
│  │(BaseChatModel)│ │(PromptTemplate)│ │(Memory)       │         │
│  └─────────────┘ └──────────────┘ └───────────────┘         │
│                         ↓                                    │
├─────────────────────────────────────────────────────────────┤
│              LangChain 生态                                  │
│  @langchain/core + @langchain/openai + @langchain/anthropic │
│  @langchain/langgraph                                        │
└─────────────────────────────────────────────────────────────┘
```

**抽象接口定义**（`packages/core/src/interfaces/`）：

```typescript
// ── LLM 抽象接口 ──
interface ILLMProvider {
  id: string;
  tier: 'analysis' | 'simple';

  // 统一调用接口
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
  stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<StreamChunk>;

  // 健康检查
  healthCheck(): Promise<{ ok: boolean; latencyMs?: number }>;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResult {
  content: string;
  usage: { input: number; output: number };
  model: string;
}

interface StreamChunk {
  type: 'text' | 'thinking' | 'tool_use' | 'done';
  content: string;
}

// ── 上下文构建抽象接口 ──
interface IContextBuilder {
  // 构建四层上下文
  build(context: {
    paragraph: string;           // 当前段落
    chapter: ChapterIndex;       // 章节结构
    annotation: string;          // 用户批注
    vectorResults: VectorResult[]; // 向量检索结果
    memoryEntries: MemoryEntry[];  // 历史记忆
  }): Promise<BuiltContext>;
}

interface BuiltContext {
  systemPrompt: string;
  messages: ChatMessage[];
  tokenCount: number;
}

// ── 记忆管理抽象接口 ──
interface IMemoryManager {
  // 对话记忆（短期）
  getConversationHistory(annotationId: string): Promise<ChatMessage[]>;
  addToHistory(annotationId: string, message: ChatMessage): Promise<void>;

  // Reading Memory（长期）
  getRelevantMemory(query: string, workspaceId: string): Promise<MemoryEntry[]>;
  addMemory(entry: MemoryEntry): Promise<void>;
}
```

**LangChain 实现**（`packages/ai/src/langchain/`）：

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { ConversationSummaryBufferMemory } from '@langchain/memory';

// ── LLM Provider 实现 ──
class LangChainLLM implements ILLMProvider {
  private model: BaseChatModel;

  constructor(config: LLMProviderConfig) {
    // 根据 provider 类型创建 LangChain 模型实例
    switch (config.provider) {
      case 'claude':
        this.model = new ChatAnthropic({
          apiKey: config.apiKey,
          model: config.model,
          ...(config.baseUrl && { baseURL: config.baseUrl }),
        });
        break;
      case 'openai':
      case 'deepseek':
      case 'custom':
        this.model = new ChatOpenAI({
          apiKey: config.apiKey,
          model: config.model,
          ...(config.baseUrl && { configuration: { baseURL: config.baseUrl } }),
        });
        break;
    }
  }

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    const lcMessages = messages.map(m => new HumanMessage(m.content)); // 简化示例
    const result = await this.model.invoke(lcMessages);
    return {
      content: result.content.toString(),
      usage: result.usage ?? { input: 0, output: 0 },
      model: this.model.model,
    };
  }

  async *stream(messages: ChatMessage[]): AsyncIterable<StreamChunk> {
    const lcMessages = messages.map(m => new HumanMessage(m.content));
    const stream = await this.model.stream(lcMessages);
    for await (const chunk of stream) {
      yield { type: 'text', content: chunk.content.toString() };
    }
  }

  async healthCheck() {
    try {
      const start = Date.now();
      await this.model.invoke([new HumanMessage('ping')]);
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false };
    }
  }
}

// ── 上下文构建实现 ──
class LangChainContextBuilder implements IContextBuilder {
  private prompt: ChatPromptTemplate;

  constructor() {
    this.prompt = ChatPromptTemplate.fromMessages([
      ['system', `你是一个专业的学习助手。根据以下上下文回答用户的问题。

{bookContext}
{chapterContext}
{semanticContext}
{memoryContext}`],
      new MessagesPlaceholder('history'),
      ['user', '{question}'],
    ]);
  }

  async build(ctx): Promise<BuiltContext> {
    const formatted = await this.prompt.format({
      bookContext: ctx.paragraph,
      chapterContext: JSON.stringify(ctx.chapter),
      semanticContext: ctx.vectorResults.map(r => r.text).join('\n'),
      memoryContext: ctx.memoryEntries.map(m => m.content).join('\n'),
      history: [],
      question: ctx.annotation,
    });
    return { systemPrompt: formatted, messages: [], tokenCount: 0 };
  }
}

// ── 记忆管理实现 ──
class LangChainMemoryManager implements IMemoryManager {
  private conversationMemory: Map<string, ConversationSummaryBufferMemory>;

  constructor() {
    this.conversationMemory = new Map();
  }

  async getConversationHistory(annotationId: string) {
    const memory = this.getOrCreateMemory(annotationId);
    const vars = await memory.loadMemoryVariables({});
    return vars.history ?? [];
  }

  // ... 其他实现
}
```

**两档路由器**（与框架无关）：

```typescript
class ModelRouter {
  private analysisProvider: ILLMProvider;  // 抽象接口，不依赖 LangChain
  private simpleProvider: ILLMProvider;
  private cooldownMap: Map<string, number> = new Map();
  private failureCounts: Map<string, number> = new Map();

  constructor(analysis: ILLMProvider, simple: ILLMProvider) {
    this.analysisProvider = analysis;
    this.simpleProvider = simple;
  }

  async route(task: TaskContext): Promise<ILLMProvider> {
    const tier = this.resolveTier(task);

    if (tier === 'analysis') {
      if (await this.isHealthy(this.analysisProvider)) {
        return this.analysisProvider;
      }
      console.warn('分析模型不可用，降级到简单模型');
      return this.simpleProvider;
    }
    return this.simpleProvider;
  }

  private resolveTier(task: TaskContext): 'analysis' | 'simple' {
    const SIMPLE_TASKS = [
      'outline_generation', 'concept_extraction',
      'distillation', 'translation', 'simple_reply',
    ];
    return SIMPLE_TASKS.includes(task.type) ? 'simple' : 'analysis';
  }

  private async isHealthy(provider: ILLMProvider): Promise<boolean> {
    const cooldownEnd = this.cooldownMap.get(provider.id);
    if (cooldownEnd && Date.now() < cooldownEnd) return false;

    try {
      const status = await provider.healthCheck();
      if (!status.ok) this.recordFailure(provider);
      return status.ok;
    } catch {
      this.recordFailure(provider);
      return false;
    }
  }

  private recordFailure(provider: ILLMProvider): void {
    const count = (this.failureCounts.get(provider.id) || 0) + 1;
    this.failureCounts.set(provider.id, count);
    if (count >= 3) {
      this.cooldownMap.set(provider.id, Date.now() + 5 * 60 * 1000);
      this.failureCounts.set(provider.id, 0);
    }
  }
}
```

**依赖引入**：

```json
{
  "@langchain/core": "^0.3",
  "@langchain/openai": "^0.3",
  "@langchain/anthropic": "^0.3",
  "@langchain/langgraph": "^0.2"
}
```

**未来替换路径**：当需要移除 LangChain 时，只需：
1. 在 `packages/ai/src/custom/` 下实现新的 `ILLMProvider`、`IContextBuilder`、`IMemoryManager`
2. 修改 `ConfigManager` 的实例化逻辑，指向新实现
3. 上层业务代码零改动

**Skill 系统**（参考 readpilot 的 SKILL.md 格式）：

```markdown
# 书籍导读生成器

当用户导入一本书时，自动调用本 Skill 生成结构化导读。

## 触发条件
- 用户导入新文档
- 用户在任意章节请求"生成导读"

## 依赖工具
- Companion Compiler（全书索引）
- LanceDB 向量检索（语义关联段落）
- LLM（文章生成）

## 执行流程
1. 检查 pipeline/ 目录是否有已缓存的产物
2. 如有缓存 → 从断点续跑
3. 如无缓存 → 执行 STORM 4 阶段管线
4. 将产物写入 pipeline/ 目录
5. 通知前端更新大纲树

## 注意事项
- 大文档（>1000 段）的 Phase 3 需要分段并行
- Phase 1 的多视角数量根据文档长度动态调整（默认 5，小文档 3，超大文档 8）
```

### 4.6 工作区管理

```
运行时数据目录：
  ~/Documents/AI-Learning-Agent/
    ├── workspaces/
    │   ├── <workspace-id-1>/       # 工作区 1（如"编译原理学习"）
    │   │   ├── meta.json           # 工作区元数据
    │   │   ├── documents/          # 导入的原始文档
    │   │   │   └── <doc-id>.pdf
    │   │   ├── parsed/             # 解析产物
    │   │   │   └── <doc-id>.md
    │   │   ├── pipeline/           # STORM 管线产物
    │   │   │   ├── collected_info.json
    │   │   │   ├── outline.json
    │   │   │   └── article/
    │   │   │       ├── chapter_01.md
    │   │   │       └── chapter_02.md
    │   │   ├── skills/            # 工作区级 Skill
    │   │   ├── sessions/          # 会话历史（JSON 序列化）
    │   │   └── exports/           # 导出产物
    │   └── <workspace-id-2>/
    ├── global-config.json         # 全局配置
    ├── llm-providers.json         # LLM 提供商配置
    ├── database.sqlite            # 全局 SQLite（批注、讨论、蒸馏）
    └── vectors/                   # LanceDB 数据目录
        └── <workspace-id>.lance/
```

单用户模式下，所有工作区共享一个 SQLite 数据库（通过 `workspaceId` 字段隔离），LanceDB 按工作区分目录。

---

## 五、数据模型

### 核心实体 ER 图（文字描述）

```
Workspace (1) ──── (N) Document
Workspace (1) ──── (N) Session
Document  (1) ──── (N) Chapter
Document  (1) ──── (1) GeneratedArticle
Chapter   (1) ──── (N) Annotation
Chapter   (1) ──── (1) ChapterIndex     (Companion Compiler)
Annotation (1) ──── (N) Discussion       (树状嵌套, parentId)
Annotation (N) ──── (M) Tag
Annotation (1) ──── (N) MemoryEntry      (Reading Memory)
Workspace (1) ──── (N) Distillation
Distillation (N) ──── (M) Annotation     (sourceIds)
Distillation (N) ──── (M) Discussion     (sourceDiscussionIds)
Session   (1) ──── (N) Message           (会话历史)
```

### 关键数据结构（JSON Schema 精简版）

```jsonc
// meta.json — 工作区元数据
{
  "id": "uuid",
  "name": "编译原理学习",
  "description": "研读龙书",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601",
  "documents": [
    {
      "id": "uuid",
      "fileName": "dragon_book.pdf",
      "fileType": "pdf",
      "fileHash": "sha256",
      "title": "Compilers: Principles, Techniques, and Tools",
      "author": "Alfred V. Aho",
      "totalChapters": 12,
      "totalParagraphs": 3420,
      "importedAt": "ISO8601"
    }
  ],
  "stats": {
    "totalAnnotations": 45,
    "totalDiscussions": 128,
    "totalDistillations": 5,
    "totalTokenCost": 0.0234,
    "lastReadChapter": "chapter_03",
    "readingProgress": 0.35
  }
}
```

### SQLite 核心表结构

```sql
-- 批注表
CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  -- TextAnchor
  anchor_exact_match TEXT NOT NULL,
  anchor_prefix TEXT NOT NULL,
  anchor_suffix TEXT NOT NULL,
  anchor_content_hash TEXT NOT NULL,
  -- 批注内容
  type TEXT NOT NULL CHECK(type IN ('highlight','note','question','dispute','summary')),
  content TEXT NOT NULL,
  ai_reply_status TEXT DEFAULT 'pending',
  -- 元数据
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  user_id TEXT DEFAULT 'local',
  tags TEXT DEFAULT '[]',  -- JSON array
  searchable_text TEXT NOT NULL,  -- content 纯文本，用于 FTS5
  -- 索引
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX idx_annotations_doc_chapter ON annotations(document_id, chapter_id);

-- 讨论表（树状嵌套）
CREATE TABLE discussions (
  id TEXT PRIMARY KEY,
  annotation_id TEXT NOT NULL,
  parent_id TEXT,  -- null = 顶层
  role TEXT NOT NULL CHECK(role IN ('user','ai')),
  content TEXT NOT NULL,
  model_id TEXT,
  token_usage TEXT,  -- JSON {input, output, model, cost}
  context_digest TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (annotation_id) REFERENCES annotations(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES discussions(id) ON DELETE CASCADE
);
CREATE INDEX idx_discussions_annotation ON discussions(annotation_id);

-- 蒸馏表
CREATE TABLE distillations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_annotation_ids TEXT NOT NULL,  -- JSON array
  source_discussion_ids TEXT NOT NULL,   -- JSON array
  content TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','pending_review','approved','published')),
  ai_review_score REAL,
  ai_review_suggestions TEXT,  -- JSON array
  published_to_type TEXT,
  published_to_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- FTS5 全文搜索
CREATE VIRTUAL TABLE annotations_fts USING fts5(
  content, searchable_text,
  content='annotations', content_rowid='rowid'
);
```

---

## 六、目录结构

### 代码目录布局（Monorepo，参考 yomitomo）

```
ai-learning-agent/
├── .github/                       # CI/CD
│   └── workflows/
│       ├── ci.yml                 # 类型检查 + lint + 测试
│       └── release.yml            # electron-builder 打包
├── apps/
│   └── desktop/                   # Electron 桌面应用入口
│       ├── electron.vite.config.ts
│       ├── package.json
│       ├── src/
│       │   ├── main/              # 主进程
│       │   │   ├── index.ts
│       │   │   ├── ipc/           # IPC 处理器（按命名空间）
│       │   │   │   ├── documents.ts
│       │   │   │   ├── annotations.ts
│       │   │   │   ├── agent.ts
│       │   │   │   ├── llm.ts
│       │   │   │   ├── vector.ts
│       │   │   │   └── workspace.ts
│       │   │   ├── services/      # 核心服务
│       │   │   │   ├── document-parser/
│       │   │   │   ├── companion-compiler/
│       │   │   │   ├── article-generator/
│       │   │   │   │   ├── phase1_curation.ts
│       │   │   │   │   ├── phase2_outline.ts
│       │   │   │   │   ├── phase3_writing.ts
│       │   │   │   │   └── phase4_polishing.ts
│       │   │   │   ├── annotation-engine/
│       │   │   │   ├── ai-reply-engine/
│       │   │   │   ├── distillation-pipeline/
│       │   │   │   └── reading-memory/
│       │   │   ├── llm/           # LLM 管理层
│       │   │   │   ├── interfaces/          # 抽象接口（零依赖，可替换实现）
│       │   │   │   │   ├── llm-provider.ts  # ILLMProvider 接口
│       │   │   │   │   ├── context-builder.ts # IContextBuilder 接口
│       │   │   │   │   └── memory-manager.ts  # IMemoryManager 接口
│       │   │   │   ├── langchain/           # LangChain 实现（可替换为自研）
│       │   │   │   │   ├── llm.ts           # LangChainLLM 实现
│       │   │   │   │   ├── context.ts       # LangChainContextBuilder 实现
│       │   │   │   │   └── memory.ts        # LangChainMemoryManager 实现
│       │   │   │   ├── router.ts            # 两档路由（分析/简单）
│       │   │   │   ├── config-manager.ts    # 环境变量 + UI 配置
│       │   │   │   └── cost-tracker.ts
│       │   │   ├── db/            # 数据层
│       │   │   │   ├── sqlite/
│       │   │   │   │   ├── schema.ts       # Drizzle ORM schema
│       │   │   │   │   └── migrations/
│       │   │   │   └── lancedb/
│       │   │   │       ├── client.ts
│       │   │   │       └── indexer.ts
│       │   │   └── utils/
│       │   │       ├── text-anchor.ts      # TextAnchor 三层匹配
│       │   │       ├── text-splitter.ts    # 双层分块策略
│       │   │       └── file-watcher.ts    # chokidar 增量索引
│       │   ├── preload/           # 预加载层
│       │   │   └── index.ts       # contextBridge 8 大命名空间
│       │   └── renderer/          # 渲染进程
│       │       ├── index.html
│       │       ├── App.tsx
│       │       ├── layouts/
│       │       │   └── ReaderLayout.tsx
│       │       ├── pages/
│       │       │   ├── Home.tsx
│       │       │   ├── Reader.tsx
│       │       │   └── Settings.tsx
│       │       ├── components/
│       │       │   ├── reader/
│       │       │   │   ├── OutlineTree.tsx
│       │       │   │   ├── ContentRenderer.tsx
│       │       │   │   ├── AnnotationMarker.tsx
│       │       │   │   └── ModeSwitcher.tsx
│       │       │   ├── annotation/
│       │       │   │   ├── AnnotationPanel.tsx
│       │       │   │   ├── AnnotationCard.tsx
│       │       │   │   ├── DiscussionTree.tsx
│       │       │   │   └── AnnotationComposer.tsx
│       │       │   ├── ai/
│       │       │   │   ├── AiReplyStream.tsx
│       │       │   │   ├── ToolCallCard.tsx
│       │       │   │   └── TokenUsageBadge.tsx
│       │       │   ├── distillation/
│       │       │   │   ├── DistillationPanel.tsx
│       │       │   │   └── DistillationCard.tsx
│       │       │   └── common/
│       │       │       ├── MarkdownRenderer.tsx
│       │       │       └── FloatingToolbar.tsx
│       │       ├── hooks/
│       │       │   ├── useAnnotations.ts
│       │       │   ├── useDiscussion.ts
│       │       │   ├── useAiReply.ts
│       │       │   └── useReadingMemory.ts
│       │       ├── contexts/
│       │       │   ├── WorkspaceContext.tsx
│       │       │   └── ReaderContext.tsx
│       │       ├── effects/       # Effect 函数式（复杂异步流）
│       │       │   ├── ai-reply.effect.ts
│       │       │   └── distillation.effect.ts
│       │       └── styles/
│       │           └── globals.css
│       └── resources/             # 应用资源
│           └── skills/            # 内置 Skill
│               └── book-to-course.md
├── packages/
│   ├── shared/                    # 共享类型和工具
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── annotation.ts
│   │   │   │   ├── document.ts
│   │   │   │   ├── agent.ts
│   │   │   │   └── sse-block.ts
│   │   │   └── utils/
│   │   │       └── index.ts
│   │   └── package.json
│   ├── core/                      # 核心逻辑（无 UI 依赖）
│   │   ├── src/
│   │   │   ├── companion-compiler.ts
│   │   │   ├── text-anchor.ts
│   │   │   └── text-splitter.ts
│   │   └── package.json
│   └── ai/                        # AI 模块（LangChain + LangGraph）
│       ├── src/
│       │   ├── interfaces/        # 抽象接口定义
│       │   │   ├── llm-provider.ts
│       │   │   ├── context-builder.ts
│       │   │   └── memory-manager.ts
│       │   ├── langchain/         # LangChain 实现
│       │   │   ├── llm.ts         # BaseChatModel 封装
│       │   │   ├── context.ts     # PromptTemplate 封装
│       │   │   └── memory.ts      # Memory 封装
│       │   ├── graphs/            # LangGraph 工作流
│       │   │   └── storm/         # STORM 管线图定义
│       │   ├── router.ts          # 两档路由
│       │   └── config-manager.ts
│       └── package.json
├── turbo.json                     # Turborepo 配置
├── pnpm-workspace.yaml
├── package.json                   # 根 workspace
├── tsconfig.json
└── README.md
```

分层原则（参考 yomitomo 的 Monorepo 单向依赖）：
- `shared`（无依赖）：纯类型和工具函数
- `core`（依赖 shared）：核心算法 + **抽象接口定义**（ILLMProvider / IContextBuilder / IMemoryManager）
- `ai`（依赖 shared + core）：LangChain 实现 + LangGraph 工作流
- `desktop`（依赖以上全部）：Electron 壳 + UI

**框架隔离设计**：
- `packages/core/src/interfaces/` 定义零依赖的抽象接口
- `packages/ai/src/langchain/` 提供 LangChain 实现
- `apps/desktop/src/main/llm/` 通过接口调用，不直接依赖 LangChain
- 未来替换时：只需在 `packages/ai/src/custom/` 下实现新接口，上层代码零改动

---

## 七、开发路线图

### Phase 1: MVP（核心闭环） — 预计 8-10 周

**目标**：完成"导入文档 → 生成导读 → 阅读 → 创建批注 → AI 回复"的最小闭环。

| 周次 | 任务 | 交付物 |
|------|------|--------|
| W1-2 | 项目脚手架搭建：Electron + electron-vite + React 19 + TypeScript + Drizzle ORM + SQLite + LanceDB 集成 | 可运行的空壳应用 |
| W3-4 | Document Parser: PDF/EPUB/Markdown 解析，提取纯文本和章节结构；Companion Compiler: 确定性索引生成（book-profile + chapter-index + topic-index） | 文档导入和解析完成 |
| W5 | Vector Indexer: 双层分块（标题分割 + 递归字符分割），@xenova/transformers 本地嵌入，LanceDB 写入和检索 | 向量搜索可用 |
| W6-7 | Article Generator Phase 1-3（跳过润色阶段）: 知识策展 + 大纲生成 + 文章生成（单模型，暂不分层）；LangGraph 编排 STORM 管线 | AI 导读生成可用 |
| W8 | Reader UI: 大纲树 + 内容渲染 + 导读/原文模式切换 + Annotation Engine: TextAnchor 三层匹配 + 批注 CRUD | 阅读和批注可用 |
| W9 | AI Reply Engine: LangChain 上下文构建（基础+结构+语义）、ILLMProvider 接口 + LangChainLLM 实现、流式 SSE Block 协议 | AI 回复可用 |
| W10 | 集成测试 + Bug 修复 + 打包（electron-builder 生成 macOS DMG） | MVP v0.1.0 发布 |

**MVP 不做的事情**：
- 多 LLM 提供商（MVP 只支持一个提供商，如 Claude）
- 两档路由（MVP 不分档，统一用一个模型）
- 蒸馏系统（Phase 2）
- Reading Memory（Phase 2）
- 可视化模型配置页（Phase 2）
- 多格式导出（Phase 2）
- 工作区共享（Phase 3）

### Phase 2: 功能完善 — 预计 6-8 周

| 周次 | 任务 |
|------|------|
| W11-12 | 基于 LangChain 的多厂商支持（OpenAI + DeepSeek + 自定义 OpenAI 兼容）、两档路由（分析/简单）+ 失败冷却 |
| W13 | 可视化模型配置页：环境变量 + UI 设置双模式，API Key 加密存储，连接测试；实现 IContextBuilder 接口 |
| W14-15 | Distillation Pipeline: 批注→讨论→蒸馏→AI review→发布 |
| W16 | Reading Memory: 跨章节/跨批注记忆累积，增量更新+版本管理 |
| W17 | Article Generator Phase 4 润色 + 两档 LLM 成本优化 |
| W18 | 导出系统：Markdown / HTML / PDF / Obsidian vault / 飞书知识库 |

### Phase 3: 生态扩展 — 预计 8-12 周

| 周次 | 任务 |
|------|------|
| W19-20 | Skill 市场：用户自定义 Skill 上传/下载/评分，GitHub 集成 |
| W21-22 | 多人协作：工作区共享，实时同步批注和讨论（CRDT / WebSocket） |
| W23-24 | 知识图谱：基于实体共现关系构建跨文档知识图谱，可视化探索 |
| W25-26 | Web 版本：抽离 Express 服务层（参考 anything-llm），支持浏览器访问 |
| W27-28 | 移动端适配：PWA 阅读器（只读模式），iOS/Android |
| W29-30 | 开放 API：REST API + WebSocket，第三方集成（Obsidian 插件 / VS Code 插件） |

---

## 八、风险与应对

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|---------|
| **PDF 解析准确度不足** | 🟡 中 | 高 | 学术界和工业界 PDF 提取都是未完全解决的问题。MVP 阶段优先支持 Markdown 和纯文本格式，PDF 解析用 pdf.js 做 best-effort，明确告知用户复杂排版（数学公式、表格、多栏）可能丢失格式。Phase 2 引入 OCR 和多模态模型做视觉增强 |
| **TextAnchor 在极端排版变化下失效** | 🟡 中 | 中 | yomitomo 三层匹配已覆盖大多数场景。极端情况（文本被 AI 改写而非排版变化）标记为"原文已变更"，提示用户手动重新定位。Phase 2 引入语义锚定（向量相似度兜底） |
| **STORM 管线 token 成本过高** | 🟡 中 | 中 | 内置成本上限设置（默认每文档 $0.50），超过上限自动降级（减少视角数、减少轮次、换用简单模型）。成本追踪器在 UI 中显式展示预估费用，用户可控 |
| **云端 API 不可用** | 🟡 中 | 高 | 两档 fallback 机制：分析模型不可用时自动降级到简单模型；简单模型也不可用时，UI 提示"AI 服务暂时不可用"，用户可继续阅读和批注（离线可用），AI 功能排队等待恢复 |
| **Electron 应用体积过大** | 🟢 低 | 低 | electron-builder 按平台打包（macOS ~200MB）。向量模型（~80MB）首次启动下载，增量更新 |
| **LanceDB Node.js binding 稳定性** | 🟡 中 | 低 | LanceDB Node.js SDK 相对年轻（截至 2026 年 7 月）。备选方案：sqlite-vss（SQLite 向量扩展）或回退到 Chroma（需要 Python 子进程）。MVP 阶段充分测试，Phase 2 评估迁移成本 |
| **多人协作的数据一致性** | 🟢 低 | 高 | Phase 1-2 不涉及多人协作。Phase 3 引入 CRDT（Yjs 或 Automerge）做冲突解决，SQLite 作为本地优先数据库，WebSocket 同步 |
| **Skill 市场的安全风险** | 🟢 低 | 高 | Phase 3 引入 Skill 市场前，建立沙箱执行环境：Skill 在受限的 Node.js vm2/isolated-vm 中运行，禁止文件系统和网络访问，白名单工具调用 |

### 关键技术风险缓释

1. **TextAnchor 不可靠的兜底方案**：如果三层匹配全失败，记录错误日志，前端显示"批注定位失败"状态，用户可手动重新关联。每次定位失败自动收集数据（原文变化类型、文件大小差异），用于改进匹配算法。

2. **STORM 管线 Token 爆炸的预算控制**：
```typescript
class CostController {
  private budget: number;  // 美元
  private spent: number = 0;

  async executeWithBudget<T>(task: () => Promise<T>, estimatedCost: number): Promise<T> {
    if (this.spent + estimatedCost > this.budget) {
      // 自动降级
      throw new BudgetExceededError({
        spent: this.spent,
        budget: this.budget,
        suggestion: 'suggest switching to cheaper model or reducing perspectives'
      });
    }
    const result = await task();
    this.spent += await this.llmManager.getActualCost();
    return result;
  }
}
```

3. **云端模型回退策略**：
```
尝试分析模型（如 Claude Sonnet）
  ├─ 可用 → 使用分析模型
  ├─ API 故障 / 超时 / 预算超限 → 静默降级到简单模型（如 GPT-4o-mini）
  └─ 简单模型也不可用 → UI 提示"AI 服务暂时不可用"，排队等待恢复

降级时 UI 标注：⚠️ 已降级到简单模型，结果可能不够深入
```

---

## 附录 A：参考项目技术栈速查

| 项目 | Stars | 桌面框架 | 前端 | 数据库 | 向量库 | Agent 框架 | LLM 集成 |
|------|-------|---------|------|--------|--------|-----------|---------|
| reor | 8,564 | Electron 33 | React 18 | LanceDB | LanceDB | Vercel AI SDK | Ollama 内嵌 |
| yomitomo | - | Electron 41 | React 19 | SQLite + Drizzle | - | Vercel AI SDK | 多 provider |
| anything-llm | 30,000 | Electron | React 18 | Prisma 5.3 | LanceDB | aibitat (自研) | 37 个 provider |
| khoj | 36,000+ | FastAPI Web | - | PostgreSQL | pgvector | 自研 Agent ORM | 多 provider |
| readpilot | - | Electron 39 | React 19 | better-sqlite3 | - | Claude Agent SDK | Claude/Codex/Hermes |

## 附录 B：关键设计决策记录

| 决策 | 结论 | 理由 | 日期 |
|------|------|------|------|
| 桌面框架选型 | Electron | Node.js AI/ML 生态；3 个参考项目全选 Electron | 2026-07-10 |
| 批注锚定方案 | TextAnchor 三层匹配 | yomitomo 验证可行；纯偏移量在重排版后失效 | 2026-07-10 |
| 文章生成方案 | STORM 4 阶段管线 | 产物持久化支持断点续跑；分层 LLM 成本优化 | 2026-07-10 |
| 上下文构建 | 四层注入（基础+结构+语义+记忆） | 综合 yomitomo 的 Reading Memory + readpilot 的 Companion Compiler + khoj 的混合搜索 | 2026-07-10 |
| 流式协议 | 统一 SSE Block（7 种类型） | readpilot 验证前后端解耦；新增 provider 只需适配 | 2026-07-10 |
| Skill 格式 | SKILL.md（人可读 + AI 可解析） | readpilot 验证；即写即用，无需复杂注册 | 2026-07-10 |
| Monorepo | pnpm + Turborepo | yomitomo 验证；单向依赖分层，并行构建 | 2026-07-10 |
| 状态管理 | React Context + Effect 函数式 | 简单 UI 状态用 Context；复杂 AI 异步流用 Effect | 2026-07-10 |
| LLM 部署策略 | 无内嵌模型，纯 API 调用 | 桌面应用不适合内嵌 Ollama；用户可自行部署本地模型并通过 base_url 配置接入 | 2026-07-13 |
| LLM 路由策略 | Agent 内置两档（分析/简单） | 路由逻辑由 Agent 内置，用户无需关心；按任务类型自动选择档位；分析模型故障自动降级 | 2026-07-13 |
| 模型配置方式 | 环境变量 + 可视化设置页 | 两档独立配置，支持不同厂商混搭；环境变量优先；本地模型通过 base_url 接入 | 2026-07-13 |
| Agent 框架 | LangChain + LangGraph + 抽象接口层 | LangChain 提供多厂商统一接口、上下文工程、对话记忆；LangGraph 支持 STORM 管线多视角并行编排；抽象接口隔离框架依赖，未来可替换为自研实现 | 2026-07-13 |
| 框架隔离策略 | 抽象接口层（ILLMProvider / IContextBuilder / IMemoryManager） | 定义零依赖的抽象接口，LangChain 作为实现层；上层业务代码只依赖接口，未来移除 LangChain 时只需替换实现，业务代码零改动 | 2026-07-13 |
