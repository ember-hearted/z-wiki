# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 架构契约(必读)

z-wiki 是三层架构 + 已落地的架构决策。**改任何架构前,先读 `CONTEXT.md`(领域词汇)与 `docs/adr/`(决策记录),不要重新 litigate 已定决策。**

- `CONTEXT.md` —— 领域词汇表(layer1/2/3、sub-seam、桌面形态术语)。输出里用词不要漂移成 service/component/api。
- `docs/adr/` —— 全部架构决策(编号序,文件名带主题 slug)。每篇头部有状态与 supersede 链;改架构前先扫目录定位相关篇目再读。新决策新建一篇(取最大编号+1),在自己的头部声明 supersede 关系,不在本节加索引行。

三层物理边界不动:`kb/`(layer1 数据)/ `web/`(layer2 SPA)/ `server/`(layer3 Fastify+pi agent)各自独立,不互写文件系统。桌面化是在三层之外加 `desktop/` shell,不穿透。

## 常用命令

```bash
make run          # 构建并启动主工作区的 desktop(Electron)
make run-w        # 复用主工作区依赖,启动 worktree 的 desktop
make typecheck    # 全量类型检查(server + web + scripts + desktop 四个 tsconfig)
npm test          # 跑 server + desktop + web 的 *.test.ts(tsx --test)
make lint         # Biome lint(不修改)
make format       # Biome 格式化(写入)
make package      # 打包 desktop(electron-builder,默认当前平台;TARGETS="--mac --win --linux" 三平台交叉打包;手动兜底用)
make release      # 单命令发版:触发远程 release 工作流(自动分层打包 + tag + GitHub release + 上传),用法 make release SUMMARY="..."
make clean-release # 清理 release/成品包,只留打包缓存(加速下次打包)
make build        # 构建前端 + 后端产物
```

`make typecheck` 抓类型错误(server + web + scripts + desktop 四个 tsconfig),`make lint` 抓风格/质量问题(a11y、非空断言等)。改完代码先跑 `make typecheck` 与 `make format`。

## 非显然约定

- **`kb/` gitignored,由 agent 维护**。起步用 `cp -r kb_example kb`。server 启动检查 `kb/` 存在,缺失即报错。不要把 `kb/` 内容提交。
- **agent 的 cwd = `kb/`**。prompt 与工具调用里的路径都相对 `kb/`(如 `read wiki/01-x.md`)。改 `agentHost.ts` 的 cwd 会破坏 prompt 路径语义。
- **buildView 是纯函数**:只读 fs 返回 `{pages, fragments}`,**不写盘**。可视数据由 Interaction 内存缓存经 `/api/pages` 暴露。不要再加写盘逻辑。
- **`config.json` 是单一真相源**(ADR-0003 D3.1 + ADR-0004):含 `apiKey`/`baseUrl`/`api`/`model`/`contextWindow`/`vaults`/`currentVault`/`shellPath`/`thinkingLevel`(无 `provider`,已删)。dev 形态放项目根(从 `config.example.json` 复制起步),桌面形态放 UserDataDir。`buildAgentContext` 从 appRoot(= agentDir 上两级)读它,启动生成 `.pi/agent/models.json`(派生产物),apiKey 经 `setRuntimeApiKey` 运行时注入——**`auth.json` 不落盘**。不再读 `.env`。
- **`raw/` 只读是双层防御**:prompt 引导(第一道)+ `kbHooks` 的 tool_call 拦截(兜底):write/edit 拦 raw 写,read 拦非 md(提示用 pandoc 工具,ADR-0011)。
- **pi agent 工具集不含 bash**(ADR-0003 D6 基线,ADR-0011 移除 bash):`tools: ["read","edit","write","grep","find","ls","pandoc"]`。非 md 源经 `pandoc` customTool(`makePandocTool`,spawn argv 不经 shell,无注入面)按需转文本;agent 不是通用 shell。
- **文件工具路径锁 kb/ 内**(ADR-0016):pi 的 `resolveToCwd`->`resolvePath` 不 sandbox(接受绝对路径与 `../` 逃逸),agent 传 kb/ 外路径能跨目录读写。由 kbHooks `tool_call` 拦截(read/grep/find/ls 用 `isWithinKb` 读边界含 raw/;write/edit 用 `isWritablePath` 写边界非 raw/),pandoc 是 customTool 不经钩子,在 `makePandocTool.execute` 内拦。symlink 不处理(agent 无 bash 不能 `ln -s`)。
- **pi skill 加载隔离**(ADR-0017):DefaultResourceLoader 传 `noSkills: true` + `additionalSkillPaths: [.pi/skills/health-check]`,不扫默认目录(避免 `~/.claude/skills/` 的 70+ Claude Code 开发技能灌进 agent system prompt 被误列成"可用工具")。后续新增 pi skill 须手动加 `additionalSkillPaths`。

## 代码风格

- TypeScript ESM(`type: module`)。**无分号,单引号,2 空格缩进**——由 `biome.json` 强制,改完跑 `make format`。
- 注释用中文。commit message 用 conventional commits(`fix(server): ...`),直接提交 `main`。
- 改现有文件时若风格不符,先跑 `make format` 统一,再改逻辑,避免格式 diff 混入逻辑 diff。

## Worktree 注意

当前可能在 git worktree 下。所有命令在当前目录跑,**不要 `cd` 到主仓库**。git stash 与主仓库共享,不要用裸 `git stash`/`git stash pop`(可能 pop 其他 session 的改动)。

`biome.json` 的 `files.includes` 已排除 `!**/.claude/worktrees`,避免 worktree 嵌套 `biome.json` 阻塞 `make lint`/`make format`。

## 开发工作流

PR 合并 + worktree 隔离,支持并行开发:

```bash
# 1. 启动 worktree(自动切分支)
EnterWorktree(name="fix/<slug>")

# 2. 开发、提交、推送
git push -u origin HEAD

# 3. GitHub 创建 PR, 打 label(feat/fix/chore/refactor/style/docs/test)
# 4. 合并到 main(Squash and merge)
# 5. 退出 worktree
ExitWorktree(action="remove")

# 6. 发版
make release SUMMARY="简短描述(如 A2A 收件 + 轨道球修复)"
```

## Agent skills

### Issue tracker

Issues 与 PRD 以 markdown 文件形式存在 `.scratch/<feature-slug>/` 下。详见 `docs/agents/issue-tracker.md`。

### Triage labels

五个角色用默认字符串(needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix)。详见 `docs/agents/triage-labels.md`。

### Domain docs

Single-context:`CONTEXT.md` + `docs/adr/` 在仓库根。详见 `docs/agents/domain.md`。
