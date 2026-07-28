# AI-Reader

> 将长文本转化为交互式课程的桌面学习工具

AI-Reader 是一款 AI 驱动的文档学习助手，支持导入书籍、论文、报告等长文本，自动生成结构化导读，提供逐章批注和 AI 讨论功能，帮助你更高效地深度学习。

---

## 功能特性

### 已规划

- **文档导入**：支持 Markdown、TXT、文本型 PDF
- **AI 生成导读**：根据原文自动学习大纲和逐节学习文档
- **智能批注**：选中文字创建批注，AI 结合上下文回答问题
- **流式对话**：支持流式显示、停止、重试和追问
- **数据持久化**：文档、批注、对话重启后仍然存在

### 后续迭代

- 多厂商 LLM 支持（OpenAI / DeepSeek / Claude / 本地模型）
- 两档模型路由（分析模型 / 简单模型）
- 知识蒸馏系统
- 导出功能（Markdown / HTML / PDF / Obsidian）
- 多人协作工作区

---

## 技术栈

| 层面 | 方案 |
|------|------|
| 桌面框架 | Electron 33+ |
| 前端 | React 19 + TypeScript |
| UI | Material Design 3 |
| 数据库 | SQLite + Drizzle ORM |
| LLM | OpenAI-compatible API |
| 构建 | electron-vite + pnpm + Turborepo |
| 测试 | Vitest + Playwright |

---

## 快速开始

### 环境要求

- **Node.js** >= 18
- **pnpm** >= 9.0.0
- **Git**

### 安装

```bash
# 克隆项目
git clone <repo-url>
cd AI-Reader

# 安装依赖
pnpm install
```

### 开发

```bash
# 启动开发模式（所有包）
pnpm dev

# 仅开发桌面应用
pnpm --filter @ai-reader/desktop dev
```

### 构建

```bash
# 构建所有包
pnpm build

# 打包桌面应用
pnpm --filter @ai-reader/desktop build
```

### 测试

```bash
# 运行所有测试
pnpm test

# 运行指定包的测试
pnpm --filter @ai-reader/core test
pnpm --filter @ai-reader/shared test

# 带覆盖率报告
pnpm --filter @ai-reader/core test:coverage
```

### 代码检查

```bash
# 检查所有包
pnpm lint

# 清理构建产物
pnpm clean
```

---

## 项目结构

```
AI-Reader/
├── apps/
│   └── desktop/                   # Electron 桌面应用
│       ├── src/
│       │   ├── main/              # 主进程（IPC、服务、数据库）
│       │   ├── preload/           # 预加载层（contextBridge）
│       │   └── renderer/          # 渲染进程（React UI）
│       └── resources/             # 应用资源
├── packages/
│   ├── shared/                    # 共享类型和工具
│   └── core/                      # 核心逻辑（文档解析、文本锚点）
├── docs/                          # 文档
│   └── superpowers/
│       ├── specs/                 # 设计规范
│       └── plans/                 # 开发计划
├── AI学习Agent技术方案.md          # 完整技术方案
├── CLAUDE.md                      # AI 协作规范
├── turbo.json                     # Turborepo 配置
├── pnpm-workspace.yaml            # pnpm workspace 配置
├── package.json                   # 根 workspace
└── tsconfig.json                  # TypeScript 配置
```

### 包说明

| 包名 | 说明 | 依赖 |
|------|------|------|
| `@ai-reader/shared` | 共享类型定义、工具函数、日志 | 无 |
| `@ai-reader/core` | 核心算法（文本锚点、文档解析） | shared |
| `@ai-reader/desktop` | Electron 桌面应用 | shared, core |

---

## 使用说明

### 1. 配置 LLM

在应用设置中配置 OpenAI-compatible API：

- **API地址**：如 `https://api.openai.com/v1` 或 `http://localhost:11434/v1`（Ollama）
- **API Key**：你的 API 密钥
- **模型名称**：如 `gpt-4o-mini`、`deepseek-chat`、`qwen2.5:7b`

支持的 LLM 提供商：
- OpenAI
- DeepSeek
- 硅基流动
- 本地 Ollama（通过 OpenAI-compatible API）
- 其他兼容 `/v1/chat/completions` 的服务

### 2. 导入文档

- 点击「导入文档」按钮
- 选择 Markdown、TXT 或 PDF 文件
- 等待文档解析完成

### 3. 生成导读

- 导入完成后，点击「生成导读」
- AI 会先生成学习大纲
- 然后逐节生成详细学习文档
- 生成过程中可以查看进度，某节失败可单独重试

### 4. 阅读与批注

- 在 AI 生成的导读中阅读
- 选中任意文字，点击「创建批注」
- 输入你的问题或笔记
- AI 会结合选中内容和章节上下文回答
- 支持追问和多轮讨论

---

## 开发指南

### 添加新包

```bash
# 在 packages/ 下创建新包
mkdir packages/new-package
cd packages/new-package

# 初始化 package.json
pnpm init

# 在根目录添加依赖
pnpm --filter @ai-reader/desktop add @ai-reader/new-package --workspace
```

### IPC 命名空间

主进程和渲染进程通过 contextBridge 通信，按命名空间组织：

- `documents` — 文档导入和解析
- `articles` — AI 文章生成
- `annotations` — 批注和讨论
- `llm` — LLM 配置和健康检查
- `system` — 系统信息

### 数据库迁移

```bash
# 生成迁移文件
pnpm --filter @ai-reader/desktop drizzle-kit generate

# 运行迁移
pnpm --filter @ai-reader/desktop drizzle-kit migrate
```

---

## 文档

| 文档 | 说明 |
|------|------|
| [AI学习Agent技术方案.md](./AI学习Agent技术方案.md) | 完整技术选型、架构设计、模块划分 |
| [Phase 1 MVP 规范](./docs/superpowers/specs/2026-07-13-phase1-mvp.md) | MVP 设计规范、验收标准 |
| [Phase 1 MVP 计划](./docs/superpowers/plans/2026-07-13-phase1-mvp.md) | 开发任务拆解 |
| [CLAUDE.md](./CLAUDE.md) | AI 协作规范、项目开发规范 |

---

## 常见问题

### Q: 支持哪些文件格式？

A: 目前支持 Markdown、TXT 和文本型 PDF。扫描件 PDF、复杂公式、双栏论文暂不支持。

### Q: 如何使用本地模型？

A: 启动 Ollama 后，在设置中配置：
- API 地址：`http://localhost:11434/v1`
- API Key：任意值（Ollama 不校验）
- 模型名称：如 `qwen2.5:7b`

### Q: 数据存储在哪里？

A: 应用数据存储在用户目录下：
- Windows: `%APPDATA%/AI-Reader/`
- macOS: `~/Library/Application Support/AI-Reader/`
- Linux: `~/.config/AI-Reader/`

### Q: 如何参与开发？

A: 参考 [CLAUDE.md](./CLAUDE.md) 中的开发规范，提交 PR 前请确保：
1. 代码通过 TypeScript 类型检查
2. 单元测试覆盖率 100%
3. Commit message 符合规范

---

## 许可证

[待定]

---

## 致谢

本项目设计参考了以下开源项目：
- [reor](https://github.com/reorproject/reor) — AI 笔记应用
- [yomitomo](https://github.com/patricksommer/yomitomo) — 日语阅读助手
- [STORM](https://github.com/stanford-oval/storm) — AI 文章生成
- [anything-llm](https://github.com/Mintplex-Labs/anything-llm) — LLM 应用平台
- [khoj](https://github.com/khoj-ai/khoj) — AI 助手
- [readpilot](https://github.com/readpilot/readpilot) — AI 阅读助手
