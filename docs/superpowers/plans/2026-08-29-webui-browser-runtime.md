# WebUI Browser Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 z-wiki 能脱离 Electron 在浏览器里用——`npm run web` 起 server、serve 前端产物、自动开浏览器标签。

**Architecture:** 复用现成的 `server/src/index.ts` 的 `start()` 入口,给它补上「serve `web/dist`」和「listen 成功后自动开浏览器」两个动作。`webDistPath` 的静态托管逻辑已存在(`createServer` + `@fastify/static`,且有 `createServer.test.ts` 覆盖),缺的只是 CLI 入口没把它传进去 + 没有自动开浏览器。不开新进程、不动 Electron,webui 与桌面共存同一内核。

**Tech Stack:** Fastify(`@fastify/static`)、`node:child_process`(开浏览器)、node:test + `app.inject`(测试)。TS ESM 无分号单引号 2 空格。

**Spec:** `.scratch/wayfinder/webui/MAP.md`(地图)+ `tickets/02-entry-and-distribution.md`(票据 `02` 的 resolution:dev 入口直接包装 `start()`,加 `ZWIKI_OPEN_BROWSER` env 默认自动开浏览器;只含 server+web 不带 node runtime)。

## Global Constraints

- 不独立分支,main 上共存;`desktop/` 保留为一种打包前端,server/web 是单一真相源。
- server 已能脱离 Electron 跑 = `server/src/index.ts` 的 `start()`;webui = 把它包装成用户可用形态。
- 只绑 `127.0.0.1`(与桌面 loopback 关切一致);`PORT` 缺省 3000(HOST 缺省 `127.0.0.1`,已有)。
- config 真相源 = 项目根 `config.json`(从 `config.example.json` 复制起步,已有默认)。
- 工具二进制(pandoc/rg/fd)复用非桌面形态按需下载/查找逻辑(`ensurePandoc` + `.pi/agent/bin`),**不新增**打包动作。
- webui **不做**自动更新;`desktop/updater.ts`/`applyPendingBoot.ts` 是 Electron 专属(范围外)。
- 不新增 npm 依赖(无 opener 库,用 `node:child_process` 跨平台开浏览器)。
- 代码风格:TS ESM,无分号、单引号、2 空格缩进;注释用中文;改完跑 `make typecheck` 与 `make format`。

---

### Task 1: 加一个跨平台开浏览器的小工具模块

**Files:**
- Create: `server/src/openBrowser.ts`
- Test: `server/src/openBrowser.test.ts`

**Interfaces:**
- Consumes: 只依赖 `node:url` 与 `node:child_process` 内建。
- Produces:
  - `export function openBrowser(url: string): Promise<void>` — 引擎无关,打开默认浏览器访问 `url`;失败 resolve 不 reject(webui 不该因打不开浏览器而崩)。内部把 `url` 经 `new URL()` 校验(relative 抛 `TypeError`,由 `try` 吞掉返回 reject`false`... 见下)。
  - `export function browserOpenCommand(platform: NodeJS.Platform, url: string): string[]` — 纯函数返回 `spawn` 的 argv(不含 shell);`win32`→`['cmd','/c','start','',url]`,`darwin`→`['open',url]`,其它→`['xdg-open',url]`。用于单测锁定跨平台命令。

- [ ] **Step 1: 写失败测试**

```ts
// server/src/openBrowser.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { browserOpenCommand } from './openBrowser.js'

test('browserOpenCommand: win32 用 cmd /c start', () => {
  assert.deepEqual(browserOpenCommand('win32', 'http://127.0.0.1:3000/'), [
    'cmd', '/c', 'start', '', 'http://127.0.0.1:3000/',
  ])
})

test('browserOpenCommand: darwin 用 open', () => {
  assert.deepEqual(browserOpenCommand('darwin', 'http://127.0.0.1:3000/'), [
    'open', 'http://127.0.0.1:3000/',
  ])
})

test('browserOpenCommand: linux 用 xdg-open', () => {
  assert.deepEqual(browserOpenCommand('linux', 'http://127.0.0.1:3000/'), [
    'xdg-open', 'http://127.0.0.1:3000/',
  ])
})
```

- [ ] **Step 2: 确认失败**

Run: `npx tsx --test server/src/openBrowser.test.ts`
Expected: FAIL(模块不存在/`browserOpenCommand` 未定义)

- [ ] **Step 3: 实现最小模块**

```ts
// server/src/openBrowser.ts
import { spawn } from 'node:child_process'

/** 跨平台打开默认浏览器访问 url。返回 argv(不含 shell),纯函数便于单测。 */
export function browserOpenCommand(platform: NodeJS.Platform, url: string): string[] {
  switch (platform) {
    case 'win32':
      return ['cmd', '/c', 'start', '', url]
    case 'darwin':
      return ['open', url]
    default:
      return ['xdg-open', url]
  }
}

/** 打开默认浏览器。失败不抛(webui 不应因打不开浏览器而崩),resolve(false);成功 resolve(true)。 */
export function openBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      new URL(url)
    } catch {
      resolve(false)
      return
    }
    const [cmd, ...args] = browserOpenCommand(process.platform, url)
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => resolve(false))
    child.unref()
    resolve(true)
  })
}
```

- [ ] **Step 4: 确认通过**

Run: `npx tsx --test server/src/openBrowser.test.ts`
Expected: PASS(3 个 deepEqual)

- [ ] **Step 5: 提交**

```bash
git add server/src/openBrowser.ts server/src/openBrowser.test.ts
git commit -m "feat(server): 跨平台自动开浏览器工具"
```

---

### Task 2: 让 `start()` 以 webui 形态 serve 前端产物 + 开浏览器

**Files:**
- Modify: `server/src/index.ts`(`start()` 函数)
- Test: `server/src/index.test.ts`(新增)

**Interfaces:**
- Consumes:
  - Task 1 的 `openBrowser(url)`。
  - 现有 `createServer`/`kbRoot`/`kbExamplePath`/`ensurePandoc`。
  - 环境变量 `ZWIKI_OPEN_BROWSER`(缺省 `'1'` = 开);`NODE_ENV`(/`process.env`,已有 `isDev` 逻辑)。
  - 现有 `PROJECT_ROOT`(从 `__dirname` 推导)。
- Produces:
  - `start()` 行为:detect `webDistPath = path.join(PROJECT_ROOT,'web/dist')`(存在才传 `webDistPath`),listen 成功后若 `ZWIKI_OPEN_BROWSER==='1'` 调 `openBrowser('http://127.0.0.1:'+port+'/')`。
  - `export function shouldOpenBrowser(env: Record<string,string|undefined>): boolean` — 纯函数返回是否开浏览器(env.ZWIKI_OPEN_BROWSER === undefined || === '1'),用于单测。

- [ ] **Step 1: 写失败测试**

```ts
// server/src/index.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldOpenBrowser } from './index.js'

test('shouldOpenBrowser: 缺省(env 无 ZWIKI_OPEN_BROWSER)为真', () => {
  assert.equal(shouldOpenBrowser({}), true)
})

test('shouldOpenBrowser: 显式 1 为真', () => {
  assert.equal(shouldOpenBrowser({ ZWIKI_OPEN_BROWSER: '1' }), true)
})

test('shouldOpenBrowser: 显式 0/off 为假', () => {
  assert.equal(shouldOpenBrowser({ ZWIKI_OPEN_BROWSER: '0' }), false)
  assert.equal(shouldOpenBrowser({ ZWIKI_OPEN_BROWSER: 'off' }), false)
})
```

- [ ] **Step 2: 确认失败**

Run: `npx tsx --test server/src/index.test.ts`
Expected: FAIL(`shouldOpenBrowser` 未定义)

- [ ] **Step 3: 实现**

在 `server/src/index.ts` 顶部 import `openBrowser`,并加:

```ts
/** 是否自动开浏览器:ZWIKI_OPEN_BROWSER 未设或 '1' 即开;'0'/'off' 关闭。 */
export function shouldOpenBrowser(env: Record<string, string | undefined>): boolean {
  const v = env.ZWIKI_OPEN_BROWSER
  return v === undefined || v === '1'
}
```

然后改 `start()` 的 `createServer` 调用传入 `webDistPath`,并在 `listen` 后打开浏览器:

```ts
// 在 start() 内,db configPath 是 PROJECT_ROOT(已有)。webui 形态:存在 web/dist 则同端口 serve。
const webDistPath = path.join(PROJECT_ROOT, 'web', 'dist')
const webDistExists = existsSync(webDistPath)
const interaction = await createServer({
  kbRoot: kbRoot(PROJECT_ROOT),
  agentDir,
  kbExamplePath: path.join(PROJECT_ROOT, 'kb_example'),
  ...(webDistExists ? { webDistPath } : {}),
})
```

在 `await interaction.app.listen({ port: PORT, host: HOST })` 之后加:

```ts
interaction.log.info(`z-wiki server on http://${HOST}:${PORT}`)
if (shouldOpenBrowser(process.env)) {
  void openBrowser(`http://${HOST}:${PORT}/`)
}
```

需要 `import { existsSync } from 'node:fs'`(现有 `realpathSync` 已从 `node:fs` 导入,加 existsSync)。

- [ ] **Step 4: 确认通过**

Run: `npx tsx --test server/src/index.test.ts`
Expected: PASS(3 个断言)

- [ ] **Step 5: 全量回归**

Run: `make typecheck`
Expected: 通过(server/web/scripts/desktop 四个 tsconfig)

- [ ] **Step 6: 提交**

```bash
git add server/src/index.ts server/src/index.test.ts
git commit -m "feat(server): start() 以 webui 形态 serve web/dist 并自动开浏览器"
```

---

### Task 3: 加 `npm run web` / `make run-web` 入口

**Files:**
- Modify: `package.json`(root,`scripts`)
- Modify: `Makefile`(`.PHONY` + 新 target)

**Interfaces:**
- Consumes: Task 1/2 的 `start()`(已能 serve web/dist + 开浏览器);root `build` script(现为 `npm run build -w web && npm run build -w server`)。
- Produces:
  - `package.json` 新增 `"web": "npm run build && node server/dist/index.js"`(先 build web+server 产物,再跑 `start()` 入口;dev 便利,不建新进程)。
  - `Makefile` 新增 `.PHONY` 成员 `run-web` 与 target `run-web: ## 构建并启动 webui(浏览器形态,无 Electron)` → `npm run web`。

- [ ] **Step 1: 更新 package.json 脚本**

修改根 `package.json` 的 `scripts`,在 `build` 后加一行:
```json
"web": "npm run build && node server/dist/index.js",
```
注意根 `build` = `npm run build -w web && npm run build -w server`,`node server/dist/index.js` 是 `start()` 入口(server/package.json 的 `start` 同路径)。此时 `start()` 会 detect web/dist(刚 build 出来)并 serve,然后自动开浏览器。

- [ ] **Step 2: 更新 Makefile**

在 `.PHONY` 行加 `run-web`,并新增 target(放在 `run-w` 之后):

```make
run-web: ## 构建并启动 webui(浏览器形态,无 Electron)
	npm run web
```

- [ ] **Step 3: 手工冒烟验证**

Run: `make run-web`
Expected: 先 build web+server,然后启动 server(`z-wiki server on http://127.0.0.1:3000`),并自动打开浏览器到 `http://127.0.0.1:3000/`。回到命令行 `Ctrl+C` 能优雅退出(`start()` 已有 SIGINT/SIGTERM 处理)。若 `config.json` 不存在,服务以空壳起(见 readConfig),浏览器打开后到 `/settings` 填 LLM 配置仍可。

- [ ] **Step 4: 提交**

```bash
git add package.json Makefile
git commit -m "feat: 加 npm run web / make run-web 浏览器形态入口"
```

---

### Task 4: 验收 webui 与桌面共存不回归

**Files:**
- Modify: 无(纯验证)

**Interfaces:**
- Consumes: 全部前置任务的产物。

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全部通过(server + desktop + web 的 *.test.ts)。

- [ ] **Step 2: 桌面形态仍可用**

Run: `make run`
Expected: 桌面(Electron)照常启动,`desktop/main.ts` 仍走 `createServer({webDistPath: ...})`,不调用新加的 `start()` 逻辑,零回归。

- [ ] **Step 3: 确认 webui 默认只绑 loopback**

Run: `make run-web`(或 `node server/dist/index.js`)
Expected: 日志 `z-wiki server on http://127.0.0.1:3000`,未绑定外网;`HOST` 缺省 `127.0.0.1`(`start()` 现有 `process.env.HOST ?? '127.0.0.1'`)。

- [ ] **Step 4: 文档记录(可选但建议)**

在 `README.md` 的「开发」段与 `Makefile` 注释中补一行:`make run-web` = 浏览器形态(无 Electron)启动。commit:
```bash
git add README.md
git commit -m "docs: 记录 make run-web 浏览器形态用法"
```

---

## Self-Review

**1. Spec coverage** — 对照地图 Destination 与票据 `02` resolution:
- 目的地「浏览器取代窗口,server 独立 run,数据在本机」→ Task 2/3 交付 `make run-web` 起 web/dist + 开浏览器,达成。
- 票据 `02` Q1「dev 入口直接包装 `start()`,加 `ZWIKI_OPEN_BROWSER` 默认自动开」→ Task 2/3 实现,`ZWIKI_OPEN_BROWSER` 默认开。✅ 覆盖。
- Q2「web-only 包只含 server+web、不带 node runtime」→ 本 plan 只做了 dev 入口;「可交付包」按 Q3=b 留迷雾,不在本 slice。**Scope note:** 打包/`make package-web` 未纳入(用户 Q3 明确先不碰打包)。✅ 符合。
- Q4「默认自动开浏览器,不用单窗口约束,favicon/标题沿用现有 web」→ Task 2 默认开;无单窗口/标题改动。✅ 覆盖。
- 范围外(自动更新/多用户托管)未被误拉入。

**2. Placeholder scan** — 无「TBD/类似 Task N/补异常处理」等占位;每个代码步骤都有真实代码块;`browserOpenCommand`/`shouldOpenBrowser` 均在先前 Task 定义。

**3. Type consistency** — Task 1 导出 `browserOpenCommand(platform, url): string[]`,`openBrowser(url): Promise<boolean>`;Task 2 用 `openBrowser(url)`、`shouldOpenBrowser(process.env)`。签名跨 Task 一致。`existsSync` 从 `node:fs` 导入(现有 import 已含 `realpathSync`,同包)。`interaction.log.info` 为 `FastifyBaseLogger`,与现有日志用法一致。

**Gap(留给后续 plan):** 浏览器内选/新建 vault 目录(`GET /api/dir`+`POST /api/dir`+SPA Miller-column 对话框)——这是一独立子系统,按 scope-check 拆成单独 plan。本 plan 的 `make run-web` 起来后,用户可在 `/settings` 用**现有**桌面专属的 `window.desktop.selectVaultPath`(浏览器里无 `window.desktop`,该按钮已条件渲染隐藏),或用 `POST /api/vault` 用 `name`(无 parentPath 时在当前仓库父目录派生)建库——够 `make run-web` 冒烟用;完整浏览器目录选择留后续 plan。
