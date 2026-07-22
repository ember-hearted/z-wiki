# 贡献指南

感谢你对 z-wiki 感兴趣！以下是参与贡献的指引。

## 行为准则

本项目采用 [Contributor Covenant](CODE_OF_CONDUCT.md) 行为准则。参与即表示遵守。

## 如何贡献

### 报告 Bug

1. 先搜索 [已有 Issues](https://github.com/ember-hearted/z-wiki/issues) 确认是否已有人报告。
2. 如果没有，创建新 Issue，使用 **Bug Report** 模板。
3. 提供复现步骤、预期行为、实际行为和运行环境（OS / 版本）。

### 提交功能请求

使用 **Feature Request** 模板描述你的想法：要解决什么问题、预期的使用场景。

### 提交 PR

1. 在本仓库创建工作树（worktree）开发：

   ```bash
   EnterWorktree(name="fix/<slug>")
   ```

2. 遵循 conventional commits 提交：

   ```
   feat(server): 新增 XX 功能
   fix(web): 修复 XX 问题
   docs: 更新 README
   ```

3. 提交前确保本地检查通过：

   ```bash
   make typecheck
   make lint
   make format
   npm test
   ```

4. 推送并创建 PR：

   ```bash
   git push -u origin HEAD
   ```

5. PR 标题使用 conventional commits 格式，PR 描述勾选 checklist 并打上对应 label。
6. PR 通过后 squash merge 到 `main`。
7. 退出 worktree：

   ```bash
   ExitWorktree(action="remove")
   ```

## 开发环境

### 前置要求

- Node.js >= 20
- npm >= 10

### 起步

```bash
git clone https://github.com/ember-hearted/z-wiki.git
cd z-wiki
npm install --ignore-scripts
cp config.example.json config.json
# 编辑 config.json 填入 LLM 配置
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `make run` | 构建并启动 desktop (Electron) |
| `make typecheck` | 全量类型检查 |
| `npm test` | 运行所有测试 |
| `make lint` | 代码风格检查 |
| `make format` | 代码格式化 |
| `make package` | 打包当前平台 |

### 架构速览

z-wiki 是三层架构，详见 [`CONTEXT.md`](CONTEXT.md)（领域词汇）和 [`docs/adr/`](docs/adr/)（架构决策记录）：

- **Layer 1 — `kb/`**：知识库数据层，管理所有 markdown 文件
- **Layer 2 — `web/`**：前端 SPA（3D 书架、文章阅读、agent 对话）
- **Layer 3 — `server/`**：Fastify + pi agent，提供 HTTP API 和 agent 交互
- **`desktop/`**：Electron shell，不破坏三层结构
