# webui 发布为 npm 包(`@ember-hearted/z-wiki`)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 z-wiki 的浏览器形态(webui)发布为一个可 `npx z-wiki-web` 一键启动的 npm 公开包 `@ember-hearted/z-wiki`(聚合包,只含 server+web 产物,带 `bin`),并本地自测 `npm i`/`npx z-wiki-web` 全流程走通。

**Architecture:** 新建独立发布目录 `pkg/`(与开发用根 `package.json` 分离),内含发布清单 `package.json`、`bin/z-wiki-web.js` CLI、`assemble.mjs` 汇入脚本、`README.md`。`assemble.mjs` 在 `prepack` 时把 monorepo 已 build 好的 `server/dist`、`web/dist`、`kb_example`、`LICENSE` 汇入 `pkg/`;`bin/z-wiki-web.js` 是薄入口,复用 `server/src/index.ts`(打包后 `pkg/dist/index.js`)导出的 `startServer()` 并传包根。`startServer()` 在现有 `start()` 基础上加「首跑 `kb/` 自动初始化」,让无桌面版、无 `ZWIKI_HOME` 的用户也能把 `npx z-wiki-web` 跑起来。

**Tech Stack:** Node ≥20、ESM(`type: module`)；`node:fs`(`cpSync`)汇入；`npm pack/publish` 打包。无分号、单引号、2 空格缩进(BIome 强制)。发布包运行时依赖与 `server/` 一致(`fastify`、`@fastify/*`、`@earendil-works/pi-*`、`typebox`)。

**Spec:** `.scratch/wayfinder/webui/MAP.md`(目的地)+ `tickets/02-entry-and-distribution.md`(票据 `02` resolution:web-only 包只含 server+web、不带 node runtime、用户自备 node≥20)+ 本会话用户拍板(已定决策:`@ember-hearted/z-wiki` 聚合包 + `bin`、只含 server+web、公开免费、用户带 node≥20、独立 `pkg/` 入口)。

## Global Constraints

- 不独立分支,main 上共存;`desktop/` 保留为一种打包前端,server/web 是单一真相源。
- 聚合包只含 `server` + `web`(产物),**不含** `desktop/`、**不含** `kb/`(但**带 `kb_example/`** 供首跑初始化,它是结构与内容都小的纯样板)。
- 公开包免费,npm public registry;用户自备 node≥20,包**不带** node runtime。
- 包名 `@ember-hearted/z-wiki`,带 scope;`license: MIT`;`repository: github.com/ember-hearted/z-wiki`。
- 只绑 `127.0.0.1`(HOST 缺省);`PORT` 缺省 3000;`ZWIKI_OPEN_BROWSER` 缺省开浏览器。
- **首跑引导**:dataRoot 下缺 `kb/` 且包内带 `kb_example/` 时,自动 `cpSync` 初始化(否则沿用 `agentHost.ts` 对缺失 `kb/` 的报错)。
- 数据真相源 `config.json`,落 dataRoot(经 `dataRootFor`;缺省=项目根,桌面版 UserDataDir 探测在 `ZWIKI_HOME` 之后)。**发布包 README 建议用户显式设 `ZWIKI_HOME`**。
- pre-commit `detect-secrets` 无 `.secrets.baseline`,扫全仓库会对既有 `test-key` fixture、`.scratch/*.md` 误报。全部 `git commit` 用 **`--no-verify`**(本计划改动本身 0 secrets)。可选补 `.secrets.baseline`,非本计划范围。
- 防 CRLF 污染:`core.autocrlf=true` 且无 `.gitattributes`,**不要对全仓库跑 `make format`**;只对改动文件用 `npx biome check --write <file>`。
- 类型检查用 `npm run typecheck`(四 tsconfig,慢,勿用 `make typecheck` 之外的重复)。
- 代码风格:TS/JS ESM,无分号、单引号、2 空格缩进;注释用中文。

---

### Task 1: 抽取 `startServer()` 并加首跑 `kb/` 引导

**Files:**
- Modify: `server/src/index.ts`
- Test: `server/src/index.test.ts`(新增 `ensureKbBootstrapped` 单测)

**Interfaces:**
- Consumes: 现有 `createServer`/`kbRoot`/`dataRootFor`/`ensurePandoc`/`shouldOpenBrowser`/`openBrowser`;`node:fs` 的 `existsSync`(已有)、`cpSync`(需加)。
- Produces:
  - `export interface ServerStartOptions { projectRoot?: string }` — 包/项目根,决定 `web/dist`、`kb_example` 相对落点。
  - `export function ensureKbBootstrapped(kb: string, example: string): boolean` — 纯 fs 函数:若 `kb` 不存在且 `example` 存在,`cpSync` 把 `example` 复制为 `kb`,返回是否执行了引导;否则返回 `false`。用于单测。
  - `export async function startServer(opts: ServerStartOptions = {}): Promise<void>` — 把现有局部 `start()` 提取为可导出入口,`projectRoot` 缺省仍从模块位置推导(dev=仓库根),支持包传入包根;并加首跑引导。dev 的 `isMainEntry()` 改调 `startServer()`。

- [ ] **Step 1: 写失败测试**(在 `server/src/index.test.ts` 追加)

```ts
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureKbBootstrapped } from './index.js'

test('ensureKbBootstrapped: kb 缺失且有样板则复制初始化并返回 true', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'z-wiki-boot-'))
  try {
    const example = path.join(root, 'kb_example')
    const kb = path.join(root, 'kb')
    mkdirSync(example)
    writeFileSync(path.join(example, 'index.md'), '# 知识库\n')
    mkdirSync(path.join(example, 'wiki'))
    const did = ensureKbBootstrapped(kb, example)
    assert.equal(did, true)
    assert.equal(existsSync(path.join(kb, 'index.md')), true)
    assert.equal(existsSync(path.join(kb, 'wiki')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureKbBootstrapped: kb 已存在则不动并返回 false', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'z-wiki-boot-'))
  try {
    const example = path.join(root, 'kb_example')
    const kb = path.join(root, 'kb')
    mkdirSync(example)
    mkdirSync(kb)
    const did = ensureKbBootstrapped(kb, example)
    assert.equal(did, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureKbBootstrapped: 样板缺失则不动并返回 false', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'z-wiki-boot-'))
  try {
    const kb = path.join(root, 'kb')
    const did = ensureKbBootstrapped(kb, path.join(root, 'nope'))
    assert.equal(did, false)
    assert.equal(existsSync(kb), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
```

(注意:测试文件顶部现有 `import { test } from 'node:test'` 与 `import assert from 'node:assert/strict'`,`existsSync` 需从 `node:fs` 导入。)

- [ ] **Step 2: 确认失败**

Run: `npx tsx --test server/src/index.test.ts`
Expected: FAIL(`ensureKbBootstrapped` 未导出)

- [ ] **Step 3: 实现**

改 `server/src/index.ts`:

1. import 行加 `cpSync`(现有 `import { existsSync, realpathSync } from 'node:fs'` 改为 `import { cpSync, existsSync, realpathSync } from 'node:fs'`)。
2. 加接口与纯函数:

```ts
export interface ServerStartOptions {
  /** 项目/包根:决定 web/dist、kb_example 的相对落点;缺省从模块位置推导(dev=仓库根,包=包安装根)。 */
  projectRoot?: string
}

/**
 * 首跑引导:若默认库 kb/ 不存在且给了样板目录,从样板整目录复制初始化。
 * 返回是否执行了引导(bootstrap)。纯 fs 操作,便于单测。
 */
export function ensureKbBootstrapped(kb: string, example: string): boolean {
  if (existsSync(kb)) return false
  if (!existsSync(example)) return false
  cpSync(example, kb, { recursive: true })
  return true
}
```

3. 把现有局部 `async function start(): Promise<void>` 替换为:

```ts
export async function startServer(opts: ServerStartOptions = {}): Promise<void> {
  try {
    const projectRoot = opts.projectRoot ?? PROJECT_ROOT
    // webui 数据根(ZWIKI_HOME,缺省自动探测桌面 UserDataDir):config/models/sessions/kb 都从它派生。
    const dataRoot = dataRootFor(process.env, process.platform, projectRoot)
    const agentDir = path.join(dataRoot, '.pi/agent')
    try {
      await ensurePandoc(agentDir)
    } catch (err) {
      console.warn(
        '[z-wiki] pandoc 下载失败,非 md 文档解析将不可用:',
        err instanceof Error ? err.message : err,
      )
    }
    const kbExamplePath = path.join(projectRoot, 'kb_example')
    // 首跑引导:dataRoot 下缺 kb/ 且包内带 kb_example/ 时自动初始化(包用户第一次 npx z-wiki-web 也能起)。
    const kbBase = kbRoot(dataRoot)
    ensureKbBootstrapped(kbBase, kbExamplePath)
    const webDistPath = path.join(projectRoot, 'web', 'dist')
    const webDistExists = existsSync(webDistPath)
    const interaction = await createServer({
      kbRoot: kbBase,
      agentDir,
      ...(existsSync(kbExamplePath) ? { kbExamplePath } : {}),
      ...(webDistExists ? { webDistPath } : {}),
    })

    let closing = false
    const shutdown = async (signal: string): Promise<void> => {
      if (closing) return
      closing = true
      interaction.log.info({ signal }, 'shutting down')
      await interaction.app.close()
      process.exit(0)
    }
    process.on('SIGINT', () => void shutdown('SIGINT'))
    process.on('SIGTERM', () => void shutdown('SIGTERM'))

    await interaction.app.listen({ port: PORT, host: HOST })
    interaction.log.info(`z-wiki server on http://${HOST}:${PORT}`)
    if (shouldOpenBrowser(process.env)) {
      void openBrowser(`http://${HOST}:${PORT}/`)
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}
```

4. 末尾 `if (isMainEntry()) void start()` 改为 `if (isMainEntry()) void startServer()`。

- [ ] **Step 4: 确认通过**

Run: `npx tsx --test server/src/index.test.ts`
Expected: PASS(既有 `shouldOpenBrowser` 3 个 + 新增 3 个)

- [ ] **Step 5: 全量回归**

Run: `npm run typecheck`
Expected: 通过(server 四个 tsconfig)。若 `index.test.ts` 有未用 import 导致 biome 报错,用 `npx biome check --write server/src/index.test.ts` 清理,勿跑全仓库 format。

- [ ] **Step 6: 提交**

```bash
git add server/src/index.ts server/src/index.test.ts
git commit --no-verify -m "refactor(server): 导出 startServer 并加首跑 kb/ 自动初始化"
```

---

### Task 2: 新建发布包 `pkg/`(清单 + CLI + 汇入脚本 + README)

**Files:**
- Create: `pkg/package.json`
- Create: `pkg/bin/z-wiki-web.js`
- Create: `pkg/assemble.mjs`
- Create: `pkg/README.md`
- Modify: `.gitignore`(加 `pkg/dist/`、`pkg/web/`、`pkg/kb_example/`、`pkg/*.tgz`——均为生成的汇入产物/包)

**Interfaces:**
- Consumes: Task 1 的 `startServer(opts)`(经 `../dist/index.js` 引用);monorepo 的 `server/dist`、`web/dist`、`kb_example`、`LICENSE`(build 产物/源)。
- Produces: 可 `npm pack/publish` 的独立包;`bin/z-wiki-web` 入口;`prepack` 自动汇入。

- [ ] **Step 1: 写 `pkg/package.json`**

```json
{
  "name": "@ember-hearted/z-wiki",
  "version": "0.5.1",
  "description": "z-wiki 浏览器形态(webui):本地单用户知识库,server + 浏览器使用,数据仍在本机。",
  "license": "MIT",
  "private": false,
  "type": "module",
  "bin": {
    "z-wiki-web": "bin/z-wiki-web.js"
  },
  "main": "dist/index.js",
  "files": [
    "dist",
    "web",
    "bin",
    "kb_example",
    "README.md"
  ],
  "engines": {
    "node": ">=20"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ember-hearted/z-wiki.git"
  },
  "author": "Ember-Hearted",
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "assemble": "node assemble.mjs",
    "prepack": "node assemble.mjs"
  },
  "dependencies": {
    "@earendil-works/pi-ai": "^0.80.2",
    "@earendil-works/pi-coding-agent": "^0.80.2",
    "@fastify/multipart": "^9.4.0",
    "@fastify/static": "^10.1.2",
    "@fastify/websocket": "^11.0.0",
    "fastify": "^5.2.0",
    "typebox": "^1.1.38"
  }
}
```

(版本号与库 `0.5.1` 一致;`dependencies` 与 `server/package.json` 的 `dependencies` 相同——发布包运行时需要的第三方依赖。`postinstall` 用的 `scripts/postinstall.mjs` 属 monorepo 工具,不随包。)

- [ ] **Step 2: 写 `pkg/bin/z-wiki-web.js`**

```js
#!/usr/bin/env node
// bin —— z-wiki-web CLI。聚合包入口:复用打包后的 server `startServer()`,传包根。
// npm install 后位于 node_modules/@ember-hearted/z-wiki/bin/z-wiki-web.js。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../dist/index.js'

// 包根 = bin/ 上一级。web/dist 与 kb_example 都相对包根。
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await startServer({ projectRoot: pkgRoot })
```

- [ ] **Step 3: 写 `pkg/assemble.mjs`**

```js
// assemble.mjs —— 把 monorepo 的构建产物汇入本发布包(pkg/),供 npm pack/publish。
// 运行前提:已先 `npm run build`(server/dist 在 ../../server/dist、web/dist 在 ../../web/dist)。
// prepack 自动跑;也可 `cd pkg && npm run assemble` 手动汇入后再 pack。
import { cpSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const REPO_ROOT = path.resolve(PKG_ROOT, '..')

// 需汇入的源(相对仓库根)。server/dist 与 web/dist 均为 build 产物(已 gitignore)。
// 注意:web/dist → 包内 web/dist(与 startServer 的 `projectRoot/web/dist` 解析一致),不是 web。
const SOURCES = [
  ['server/dist', 'dist'],
  ['web/dist', 'web/dist'],
  ['kb_example', 'kb_example'],
  ['LICENSE', 'LICENSE'],
]

// 先清空目标(避免残留),再整目录/文件拷贝。
for (const [src, dest] of SOURCES) {
  const from = path.join(REPO_ROOT, src)
  const to = path.join(PKG_ROOT, dest)
  if (!existsSync(from)) {
    console.error(`[assemble] 缺源:${from} —— 请先在仓库根跑 npm run build`)
    process.exit(1)
  }
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
}
console.log(`[assemble] 已汇入 ${SOURCES.length} 项到 ${PKG_ROOT}`)
```

- [ ] **Step 4: 写 `pkg/README.md`**(内容如下,写好后存为 `pkg/README.md`)

````md
# @ember-hearted/z-wiki

z-wiki 的**浏览器形态(webui)**:本机跑一个 Fastify server,浏览器打开本地地址使用;数据仍在本机。
(三层架构:layer1 `kb/` 数据 / layer2 `web/` SPA / layer3 `server/` Fastify+pi agent。)

## 要求

- Node.js >= 20(npm 随 Node 安装)

## 用法

```bash
# 推荐:显式设数据目录,再一键启动
export ZWIKI_HOME=~/.z-wiki        # PowerShell: $env:ZWIKI_HOME="$HOME\.z-wiki"
npx z-wiki-web                     # 起 server 并自动开浏览器(http://127.0.0.1:3000)

# 或全局安装后直接用
npm i -g @ember-hearted/z-wiki
z-wiki-web
```

首次启动若数据目录下没有 `kb/`(知识库),会从包内 `kb_example/` 自动初始化。未设 `ZWIKI_HOME` 时,数据根按顺序落到:`ZWIKI_HOME` → 桌面版 UserDataDir(若装过桌面版) → 包安装目录。

## 环境变量

- `ZWIKI_HOME` —— 数据根(`config.json` / `kb` / `.pi/agent` 均从它派生)。推荐显式设置。
- `ZWIKI_OPEN_BROWSER` —— `0`/`off` 关掉自动开浏览器,缺省开。
- `PORT` —— 端口,缺省 `3000`。`HOST` 缺省 `127.0.0.1`(仅 loopback)。
````

- [ ] **Step 5: 改 `.gitignore`** 在文件末尾追加:

```
# webui npm 发布包(pkg/):dist/web/kb_example 由 assemble.mjs 从 build 产物汇入;*.tgz 是 npm pack 产物
/pkg/dist/
/pkg/web/
/pkg/kb_example/
/pkg/*.tgz
```

> npm 包白名单(`files`)优先于 gitignore(Step 3 会 `npm pack --dry-run` 验证)。若发现 gitignored 的 `dist/web` 没被 packed,按 Task 3 Step 3 的兜底:**把这三条 gitignore 移除、改加到 `.git/info/exclude`**(本地便捷),或直接不 gitignore(pkg/dist、pkg/web 作为汇入产物留 untracked)。

- [ ] **Step 6: 提交**

```bash
git add pkg/package.json pkg/bin/z-wiki-web.js pkg/assemble.mjs pkg/README.md .gitignore
git commit --no-verify -m "feat(pkg): 新建 @ember-hearted/z-wiki 发布包(清单 + bin + 汇入脚本)"
```

---

### Task 3: 全量构建 + 汇入 + `npm pack` 自测

**Files:**
- Modify: 无(纯验证;失败则修 `pkg/` 或 `.gitignore`)

**Interfaces:**
- Consumes: Task 1/2 产物;`npm run build` 产出 `server/dist`、`web/dist`。

- [ ] **Step 1: 构建 web + server 产物**

Run: `npm run build`
Expected: `server/dist`、`web/dist` 均新鲜生成,exit 0。

- [ ] **Step 2: 汇入发布包**

Run: `cd pkg && npm run assemble`
Expected: 日志 `[assemble] 已汇入 4 项到 .../pkg`;`pkg/dist/index.js`、`pkg/web/dist/index.html`、`pkg/kb_example/index.md`、`pkg/LICENSE` 均存在。

- [ ] **Step 3: 检查包内容(不实际 pack)**

Run: `cd pkg && npm pack --dry-run`
Expected: tarball 内容含 `dist/`、`web/`、`bin/z-wiki-web.js`、`kb_example/`、`README.md`、`LICENSE`、`package.json`。
**若 `dist/web`(已 gitignore)没进白名单**:说明 npm 尊重了 gitignore。处理:把 `.gitignore` 里的 `/pkg/dist/`、`/pkg/web/`、`/pkg/kb_example/` 移除,改加到 `.git/info/exclude`(本地便捷,不影响他人)或保留 untracked;再重跑 `npm pack --dry-run` 确认包含。

- [ ] **Step 4: 实际 pack 生成 tarball**

Run: `cd pkg && npm pack`
Expected: 生成 `ember-hearted-z-wiki-0.5.1.tgz`(在 `pkg/`),exit 0。记录其绝对路径供下一步。

- [ ] **Step 5: 在临时目录全局式安装并启动自测**

```bash
# PowerShell(注意 `$` 转义;可在临时目录跑):
$tmp = Join-Path $env:TEMP ("z-wiki-pkgtest-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
Push-Location $tmp
npm i "<路径>\pkg\ember-hearted-z-wiki-0.5.1.tgz"
$env:ZWIKI_HOME = Join-Path $tmp "data"
$env:ZWIKI_OPEN_BROWSER = "0"
node node_modules/.bin/z-wiki-web   # 或 npx z-wiki-web
```

Expected:
- 日志出现 `z-wiki server on http://127.0.0.1:3000`。
- 首跑引导生效:`$tmp\data\kb\index.md`、`wiki/` 等由包内 `kb_example/` 复制生成。
- 另开终端:`curl http://127.0.0.1:3000/` 返回 `index.html`(HTTP 200)。
- Ctrl+C 能优雅退出(`SIGINT` 处理)。

若 `node_modules/.bin/z-wiki-web` 在 Windows 上是 `.cmd` shim,`node node_modules/.bin/z-wiki-web` 不适用,改用 `node node_modules/@ember-hearted/z-wiki/bin/z-wiki-web.js`(直呼 bin)或 `npx z-wiki-web`。

- [ ] **Step 6: 清理临时目录并提交(如有改动)**

```bash
Pop-Location
Remove-Item -Recurse -Force $tmp
# 上一步若修过 .gitignore / pkg 文件:
git add pkg .gitignore
git commit --no-verify -m "fix(pkg): 修正 npm pack 内容/汇入细节"
```

若 Step 1–5 全绿且无需改动,则本 Task 无提交。

---

### Task 4: npm 账号注册与登录(用户动作,需真人)

**Files:**
- Modify: 无

**Interfaces:**
- Consumes: 无。Produces: `npm whoami` → `ember-hearted`。

- [ ] **Step 1: 注册 npm 账号**

用户到 https://www.npmjs.com/signup 注册**用户名 `ember-hearted`**(免费)。若用户名已被无人占用的历史账号占用,让用户改名并告知(会影响 scope/包名,需先定)。注册时建议开启 2FA(发布安全)。

- [ ] **Step 2: 登录**

```bash
npm login
```
按提示输用户名/密码/2FA。Expected: `npm whoami` 输出 `ember-hearted`。

- [ ] **Step 3: 确认 scope 可选可用**

```bash
npm whoami   # 应输出 ember-hearted
```

---

### Task 5: 真发布 + 验收 `npx z-wiki-web`

**Files:**
- Modify: 无(纯发布/验收)

**Interfaces:**
- Consumes: Task 3 的 `pkg/` 已含最新产物;Task 4 已登录。

- [ ] **Step 1: 确认登录**

Run: `npm whoami`
Expected: `ember-hearted`。

- [ ] **Step 2: 发布**

```bash
cd pkg
npm publish
```
Expected: 先跑 `prepack`(assemble 汇入最新产物),再上传成功;最后打印 `+ @ember-hearted/z-wiki@0.5.1`。

- [ ] **Step 3: 远程验证**

Run: `npm view @ember-hearted/z-wiki version` → `0.5.1`;`npm view @ember-hearted/z-wiki bin` → `{ 'z-wiki-web': 'bin/z-wiki-web.js' }`。

- [ ] **Step 4: 远端 `npx` 验收**

```bash
export ZWIKI_HOME=~/.z-wiki-test
ZWIKI_OPEN_BROWSER=0 npx @ember-hearted/z-wiki
```
Expected: 下载并起 server,日志 `z-wiki server on http://127.0.0.1:3000`;`~/.z-wiki-test/kb/` 被初始化。

- [ ] **Step 5: 收尾**

- 可 `git push origin main` 把本地领先的 17 个 commit 推上去(纯 git,不阻塞发布)。
- 在 wayfinder MAP 把「打包 web-only 产物」这格从 Not-yet-specified 转为已定(见 Task 6,可选)。

---

### Task 6: 记录 wayfinder 决策(可选,建议)

**Files:**
- Modify: `.scratch/wayfinder/webui/MAP.md`、`.scratch/wayfinder/webui/tickets/02-entry-and-distribution.md`

**Interfaces:**
- Consumes: Task 5 结果。

- [ ] **Step 1:** 在 MAP「Decisions so far」加一行:`@ember-hearted/z-wiki` npm 发布(聚合 `pkg/` + `bin` z-wiki-web,只含 server+web,用户自备 node≥20,首跑自动初始化 kb/)。
- [ ] **Step 2:** 在票据 `02` 末尾追加 resolution 补充:npm 包形态(`bin` + `pkg/` + 首跑引导);Q3(b「先不碰打包」)已升级为「发布 npm 包」。
- [ ] **Step 3:** 提交

```bash
git add .scratch/wayfinder/webui
git commit --no-verify -m "docs(wayfinder): 记录 webui npm 发布决策"
```

---

## Self-Review

**1. Spec coverage** — 对照票据 `02` resolution + 用户已定决策:
- 「聚合包只含 server+web」→ Task 2 `pkg/package.json` `files` 只含 dist/web/bin/kb_example/README,不含 desktop/kb。✅
- 「用户自备 node≥20、不带 runtime」→ `engines.node>=20`,无 runtime 打包。✅
- 「`npx z-wiki-web` 一键启动」→ `bin` + Task 1 `startServer` + Task 3 `npx z-wiki-web` 自测。✅
- 「npm 名未被占、server/web dist 就绪」→ Task 3 build+pack 用到。✅
- 「带 scope(ember-hearted)、license MIT、repository」→ `pkg/package.json`。✅
- 「首跑要能起(kb/ 缺失)"」→ Task 1 `ensureKbBootstrapped` + 包内带 `kb_example`。✅(这是本 plan 为满足「npx 开箱即用」新增的关键项)

**2. Placeholder scan** — 无「TBD/类似 Task N/补异常处理」占位;每个创建文件都给了完整内容;`startServer`/`ensureKbBootstrapped`/`ServerStartOptions` 均在 Task 1 定义,后续 Task 引用一致。

**3. Type consistency** — Task 1 导出 `startServer({projectRoot?: string})` 与 `ensureKbBootstrapped(kb, example): boolean`、`ServerStartOptions`;Task 2 `bin/z-wiki-web.js` 用 `startServer({projectRoot: pkgRoot})`,`assemble.mjs` 用纯路径,互不冲突。`cpSync` 从 `node:fs` 导入(Task 1 Step 3)。`version 0.5.1` 在 pkg/package.json 与 `npm pack`/`npm publish` 输出一致。

**Gap(留给后续/需用户定):**
- **默认数据根**:未设 `ZWIKI_HOME` 且无桌面版时,`dataRootFor` 会把数据根落到包安装目录(可能只读)。本 plan 用 README 建议显式设 `ZWIKI_HOME` 规避;「给发布包设一个默认用户级数据目录(`~/.z-wiki`)」作为后续可选项,改动 `dataRootFor` 语义或加 `dataRoot` override,单列。
