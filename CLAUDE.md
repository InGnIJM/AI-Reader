# AI-Reader 项目规范

> 将长文本转化为交互式课程的桌面学习工具
> 详细技术方案见 `AI学习Agent技术方案.md`，MVP 规范见 `docs/superpowers/specs/`

---

## 一、项目定位

**AI 学习 Agent** 是一款将任意长文本（书籍、论文、报告）转化为交互式课程，并提供逐章批注、AI 讨论、知识蒸馏全链路的桌面学习工具。

### 核心用户故事

1. **深度学习技术书籍**：导入 PDF → AI 生成章节导读 → 阅读时选中文字创建批注 → AI 结合上下文回答 → 蒸馏为学习笔记
2. **研究论文精读**：导入论文 → AI 生成导读（背景→方法→实验→局限）→ 标记疑问 → AI 引用原文回复 → 导出 Markdown 笔记
3. **团队共读与知识沉淀**：创建工作区 → 分配章节 → 批注共享 → AI 生成周报 → 发布到知识库

---

## 二、设计目标

### MVP（Phase 1）目标

完成最小闭环：**导入文档 → 解析结构 → AI 生成导读 → 阅读 → 创建批注 → AI 回答**

#### 验收标准

**文档导入**
- [ ] Markdown、TXT、文本 PDF 可正常导入
- [ ] 导入后可看到章节目录
- [ ] 失败时有明确错误信息
- [ ] 应用重启后文档仍然存在

**AI 生成文档**
- [ ] 能根据导入内容生成学习大纲
- [ ] 能按照大纲逐节生成 Markdown
- [ ] UI 能显示生成进度
- [ ] 某一节失败后可以重试，已完成章节不丢失

**AI 批注**
- [ ] 用户可以选中 AI 文档中的文字
- [ ] 可以输入问题或创建普通批注
- [ ] AI 回答包含选中内容和当前章节上下文
- [ ] 支持流式显示、停止、重试和追问
- [ ] 重启应用后批注和对话仍然存在
- [ ] 点击批注能够重新定位到对应文字

### 后续阶段目标

| 阶段 | 目标 |
|------|------|
| Phase 2 | 多厂商 LLM 支持、两档模型路由、蒸馏系统、Reading Memory、导出系统 |
| Phase 3 | Skill 市场、多人协作、知识图谱、Web 版本、移动端适配 |

---

## 三、技术栈

### 当前技术栈（Phase 1）

| 层面 | 方案 | 说明 |
|------|------|------|
| 桌面框架 | Electron 33+ | Node.js AI/ML 生态支持好 |
| 前端 | React 19 + TypeScript | 社区 AI 组件库完善 |
| UI 框架 | Material Design 3 | 自定义 token |
| 数据库 | SQLite + Drizzle ORM | 类型安全 + 迁移管理 |
| LLM 接口 | OpenAI-compatible `/v1/chat/completions` | 兼容 OpenAI/DeepSeek/Ollama 等 |
| 构建 | electron-vite + pnpm + Turborepo | Electron 专用构建 + monorepo 管理 |
| 测试 | Vitest + Playwright | 单元测试 + E2E 测试 |
| 日志 | electron-log | 主进程/渲染进程统一日志 |
| 流式输出 | Electron IPC 事件透传 | 简单可靠 |

### Phase 1 暂不引入

| 技术 | 原因 |
|------|------|
| LanceDB | 当前批注只使用当前章节上下文，无需向量检索 |
| @xenova/transformers | 无 Embedding 需求 |
| LangGraph | 普通状态机已足够 |
| LangChain | 直调 OpenAI-compatible API 更简单 |
| Effect Runtime | 异步复杂度不高 |
| Vercel AI SDK | IPC 流式已够用 |

---

## 四、项目结构

### Monorepo 目录布局

```
AI-Reader/
├── apps/
│   └── desktop/                   # Electron 桌面应用
│       ├── src/
│       │   ├── main/              # 主进程
│       │   │   ├── ipc/           # IPC 处理器（按命名空间）
│       │   │   ├── services/      # 核心服务
│       │   │   │   ├── document-parser/
│       │   │   │   ├── article-generator/
│       │   │   │   ├── annotation-engine/
│       │   │   │   └── llm-provider/
│       │   │   ├── db/            # 数据层（SQLite + Drizzle）
│       │   │   └── utils/
│       │   ├── preload/           # 预加载层（contextBridge）
│       │   └── renderer/          # 渲染进程
│       │       ├── components/    # React 组件
│       │       ├── hooks/         # 自定义 Hooks
│       │       ├── contexts/      # React Context
│       │       ├── pages/         # 页面
│       │       └── styles/        # 样式
│       └── resources/             # 应用资源
├── packages/
│   ├── shared/                    # 共享类型和工具（无依赖）
│   │   └── src/
│   │       ├── types/             # 类型定义
│   │       └── utils/             # 工具函数
│   └── core/                      # 核心逻辑（依赖 shared）
│       └── src/
│           ├── companion-compiler.ts
│           ├── text-anchor.ts
│           └── text-splitter.ts
├── docs/                          # 文档
│   └── superpowers/
│       ├── specs/                 # 设计规范
│       └── plans/                 # 开发计划
├── turbo.json                     # Turborepo 配置
├── pnpm-workspace.yaml            # pnpm workspace 配置
├── package.json                   # 根 workspace
├── tsconfig.json                  # TypeScript 配置
└── CLAUDE.md                      # 本文件
```

### 分层原则

- `packages/shared`（无依赖）：纯类型和工具函数
- `packages/core`（依赖 shared）：核心算法、抽象接口定义
- `apps/desktop`（依赖以上全部）：Electron 壳 + UI + 业务逻辑

---

## 五、开发规范

### 编码规范

- **语言**：TypeScript，严格模式
- **命名**：
  - 文件名：kebab-case（如 `text-anchor.ts`）
  - 组件名：PascalCase（如 `AnnotationPanel.tsx`）
  - 接口名：I 前缀（如 `ILLMProvider`）
  - 常量：UPPER_SNAKE_CASE
- **注释**：关键逻辑必须注释，复杂算法标注参考来源
- **导入顺序**：外部库 → 内部包 → 相对路径，每组之间空行

### Git 提交规范

- **Commit message**：`<type>(<scope>): <description>`
- **type 可选**：feat / fix / refactor / test / docs / chore
- **scope**：模块名（如 `core`, `desktop`, `shared`）
- **示例**：`feat(core): 实现 TextAnchor 三层匹配算法`

### 测试规范

- **测试框架**：Vitest
- **测试文件位置**：与被测文件同目录下的 `test/` 子目录
- **测试文件命名**：`test_<被测文件名>.ts`
- **覆盖率要求**：核心模块 100%
- **运行命令**：`pnpm test`（全量） / `pnpm --filter @ai-reader/core test`（单包）

### 分支策略

- `main`：稳定版本
- `develop`：开发分支
- `feat/*`：功能分支
- `fix/*`：修复分支

---

## 六、核心模块说明

### 文档解析器（Document Parser）

- 支持 Markdown、TXT、文本型 PDF
- 提取纯文本和章节结构
- 生成标准化 AST

### 文章生成器（Article Generator）

- **阶段一**：生成大纲（将原文标题/目录/摘要发送给 LLM）
- **阶段二**：逐节生成正文（按大纲 + 原文章节调用 LLM）
- 中间状态持久化，支持断点续跑
- 某节失败只重试当前章节，已完成章节不丢失

### 批注系统（Annotation Engine）

- **TextAnchor 锚点**：offset 校验 → exactText 匹配 → prefix+exactText+suffix 匹配 → 标记需重新定位
- **上下文构建**：选中文字 + 当前段落 + 前后段落 + 当前章节全文 + 讨论历史
- **AI 回复**：流式显示，支持停止、重试、追问

### LLM 提供者（LLM Provider）

- 接口：`ILLMProvider`（chat / stream / healthCheck）
- 实现：`OpenAICompatibleLLMProvider`（兼容 OpenAI/DeepSeek/Ollama 等）
- 流式输出：Electron IPC 事件透传

---

## 七、数据模型

### 核心实体

- `Workspace`：工作区
- `Document`：导入的文档
- `Chapter`：文档章节
- `GeneratedArticle`：AI 生成的文章
- `GeneratedSection`：AI 生成的章节
- `Annotation`：批注
- `DiscussionMessage`：讨论消息
- `LLMUsageRecord`：LLM 使用记录

### 数据库

- SQLite + Drizzle ORM
- 表结构定义：`apps/desktop/src/main/db/schema.ts`
- 迁移文件：`apps/desktop/src/main/db/migrations/`

---

## 八、参考文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 技术方案 | `AI学习Agent技术方案.md` | 完整技术选型、架构设计、模块划分 |
| MVP 规范 | `docs/superpowers/specs/2026-07-13-phase1-mvp.md` | Phase 1 设计规范、验收标准 |
| MVP 计划 | `docs/superpowers/plans/2026-07-13-phase1-mvp.md` | 开发任务拆解 |

---

## 九、常用命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build

# 测试
pnpm test
pnpm --filter @ai-reader/core test        # 单包测试
pnpm --filter @ai-reader/shared test

# 代码检查
pnpm lint

# 清理构建产物
pnpm clean
```

---

> 通用开发规范（Git 提交、调试规范、QA 门禁、安全检查等）遵循 `~/.claude/CLAUDE.md` 全局规范。
