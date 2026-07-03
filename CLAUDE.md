# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 架构契约(必读)

z-wiki 是三层架构 + 已落地的架构决策。**改任何架构前,先读 `CONTEXT.md`(领域词汇)与 `docs/adr/`(决策记录),不要重新 litigate 已定决策。**

- `CONTEXT.md` —— 领域词汇表(layer1/2/3、sub-seam、桌面形态术语)。输出里用词不要漂移成 service/component/api。
- `docs/adr/0001-server-seams.md` —— server 内部 seam:AgentHost(pi SDK 封装)+ Interaction(编排+HTTP+WS),buildView 走 HTTP 不写盘。
- `docs/adr/0002-layer1-contract.md` —— layer1 契约:`kb/` 收拢、`raw/` 只读走代码(kbHooks 拦 write/edit)、sub-seam 命名集中在 `kbLayout.ts`。
- `docs/adr/0003-desktop-form.md` —— 桌面化决策(Electron + 不破坏三层)。

三层物理边界不动:`kb/`(layer1 数据)/ `web/`(layer2 SPA)/ `server/`(layer3 Fastify+pi agent)各自独立,不互写文件系统。桌面化是在三层之外加 `desktop/` shell,不穿透。

## 常用命令

```bash
make dev          # 同时启动 server(:3000)+ web(:5173),开发模式
make typecheck    # 全量类型检查(server + web + scripts 三个 tsconfig)
npm test          # 跑 server/src/**/*.test.ts(tsx --test)
make lint         # Biome lint(不修改)
make format       # Biome 格式化(写入)
make health       # 知识库健康检查(断链/孤儿/空文件)
make build        # 构建前端 + 后端产物
```

`make typecheck` 抓类型错误,`make lint` 抓风格/质量问题(a11y、非空断言等)。改完代码先跑 `make typecheck` 与 `make format`。lint 现有 22 errors + 26 warnings 主要是既有 a11y/`!` 断言问题,非阻塞,后续清理。

## 非显然约定

- **`kb/` gitignored,由 agent 维护**。起步用 `cp -r kb_example kb`。server 启动检查 `kb/` 存在,缺失即报错。不要把 `kb/` 内容提交。
- **agent 的 cwd = `kb/`**。prompt 与工具调用里的路径都相对 `kb/`(如 `read wiki/01-x.md`)。改 `agentHost.ts` 的 cwd 会破坏 prompt 路径语义。
- **buildView 是纯函数**:只读 fs 返回 `{pages, fragments}`,**不写盘**。可视数据由 Interaction 内存缓存经 `/api/pages` 暴露。不要再加写盘逻辑。
- **`config.json` 是单一真相源**(ADR-0003 D3.1):含 `apiKey`/`provider`/`model`/`vaults`/`currentVault`。dev 形态放项目根(从 `config.example.json` 复制起步),桌面形态放 UserDataDir。`buildAgentContext` 从 appRoot(= agentDir 上两级)读它,启动生成 `.pi/agent/models.json`(派生产物),apiKey 经 `setRuntimeApiKey` 运行时注入——**`auth.json` 不落盘**。不再读 `.env`。
- **`raw/` 只读是双层防御**:prompt 引导(第一道)+ `kbHooks` 的 tool_call 拦截 write/edit(兜底)。拦 write/edit 不拦 bash(bash 写 raw 靠 prompt,正则拦 bash 会误伤读命令)。
- **pi agent 工具集不含 bash**(ADR-0003 D6):`tools: ["read","edit","write","grep","find","ls"]`。agent 是知识库编译器,不需要 shell。

## 代码风格

- TypeScript ESM(`type: module`)。**无分号,单引号,2 空格缩进**——由 `biome.json` 强制,改完跑 `make format`。
- 注释用中文。commit message 用 conventional commits(`fix(server): ...`),直接提交 `main`。
- 改现有文件时若风格不符,先跑 `make format` 统一,再改逻辑,避免格式 diff 混入逻辑 diff。

## Worktree 注意

当前可能在 git worktree 下。所有命令在当前目录跑,**不要 `cd` 到主仓库**。git stash 与主仓库共享,不要用裸 `git stash`/`git stash pop`(可能 pop 其他 session 的改动)。

## Agent skills

### Issue tracker

Issues 与 PRD 以 markdown 文件形式存在 `.scratch/<feature-slug>/` 下。详见 `docs/agents/issue-tracker.md`。

### Triage labels

五个角色用默认字符串(needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix)。详见 `docs/agents/triage-labels.md`。

### Domain docs

Single-context:`CONTEXT.md` + `docs/adr/` 在仓库根。详见 `docs/agents/domain.md`。
