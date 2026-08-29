# WebUI 目录浏览 API Implementation Plan（server）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** layer3 Fastify 暴露 `GET /api/dir` 与 `POST /api/dir`,让 webui 在浏览器里浏览/新建本地目录(选 vault 父目录),并做足"处理 wire 值"的安全校验。

**Architecture:** 在 `server/src/interaction.ts` 里照搬现有 vault 端点的模式新增两个路由。浏览范围**跟桌面原生选择器一致(允许全盘,不做 root/gate 裁剪)**——危险点不在"浏览范围",而在**如何把浏览器传来的 path 当真**:绝不 `path.resolve()` wire 值(会悄悄解析到 server cwd),只接受绝对路径。`POST /api/dir` 建目录的最终"Open → 建 vault"复用现有 `POST /api/vault {path}`。

**Tech Stack:** Fastify、`node:fs/promises`(readdir/mkdir/stat)、`node:os`(homedir)、node:test `app.inject`。

**Spec:** `.scratch/wayfinder/webui/tickets/01-vault-directory-picker.md`(票据 `01` Resolution 的 DSH browse 方案)+ `MAP.md`(dir_scope 裁决:跟桌面一致,浏览全盘;安全=只绑 loopback + 硬性路径校验)。

## Global Constraints

- 类型 TS ESM,无分号、单引号、2 空格缩进;中文注释;改完 `make typecheck` + 对改动文件 `biome check`。
- **绝不 `path.resolve()` wire 值**;只接受绝对路径(`path.isAbsolute`),否则 400。绝不把相对 wire 路径解析到 server cwd。
- **拒绝相对/非 fullyQualified 路径**(票据 `01` 硬性要求)。
- 只回目录(不回流文件),`hidden`=点前缀;按名排序;`maxEntries` 分页(默认 200)。
- 浏览范围不限(跟桌面原生一致);危险点由此转移为"路径当真",安全校验聚焦于此,不裁剪浏览根。
- `POST /api/dir` 只建单个非递归目录;name 必须为单一非空段(不含路径分隔符、`.`、`..`);`EEXIST`→409,其他失败→500。
- 不新增 npm 依赖。
- 复用 `interaction.ts` 既有 import;新增 `os`。

---

### Task 1: 目录浏览工具函数(纯函数,单测)

**Files:**
- Create: `server/src/dirPicker.ts`
- Test: `server/src/dirPicker.test.ts`

**Interfaces:**
- Consumes: 只依赖 `node:fs`/`node:fs/promises`/`node:path`/`node:os`。
- Produces:
  - `export interface DirEntry { name: string; path: string; hidden: boolean }`
  - `export interface DirListing { path: string; home: string; crumbs: Array<{ name: string; path: string }>; entries: DirEntry[]; truncated: boolean }`
  - `export function validateDirPath(raw: unknown): { path: string } | { error: string }` — 校验 wire 传来的 path 值:非字符串/非绝对/含 `..` 段 → `{error}`;否则 `{path}`。
  - `export function validateDirName(raw: unknown): { name: string } | { error: string }` — 校验建目录名:非字符串/空/含 `/`、`\`、`.`、`..` → `{error}`。
  - `export function buildCrumbs(absPath: string): Array<{ name: string; path: string }>` — 从根到目标的面包屑。
  - `export async function listDirectory(absPath: string, opts?: { maxEntries?: number }): Promise<DirListing>` — 枚举只目录;readdir withFileTypes,只留 isDirectory 或 symlink-to-dir(stat 判定),按名排序,hidden=点前缀,截断 maxEntries。

- [ ] **Step 1: 写失败测试**

```ts
// server/src/dirPicker.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { validateDirPath, validateDirName, buildCrumbs, listDirectory } from './dirPicker.js'

test('validateDirPath: 绝对路径接受', () => {
  const r = validateDirPath('/a/b')
  assert.deepEqual(r, { path: '/a/b' })
})
test('validateDirPath: 相对路径拒绝(绝不 resolve)', () => {
  const r = validateDirPath('a/b')
  assert.ok('error' in r)
  assert.match((r as { error: string }).error, /绝对路径/)
})
test('validateDirPath: 含 .. 段拒绝', () => {
  const r = validateDirPath('/a/../b')
  assert.ok('error' in r)
})
test('validateDirPath: 非字符串(数字)拒绝', () => {
  assert.ok('error' in validateDirPath(123))
})
test('validateDirPath: 缺失/空接受(缺省走 home)', () => {
  assert.deepEqual(validateDirPath(undefined), { path: '' })
  assert.deepEqual(validateDirPath(''), { path: '' })
})

test('validateDirName: 合法单段名接受', () => {
  assert.deepEqual(validateDirName('work'), { name: 'work' })
  assert.deepEqual(validateDirName('我的 库'), { name: '我的 库' })
})
test('validateDirName: 含分隔符拒绝', () => {
  assert.ok('error' in validateDirName('a/b'))
  assert.ok('error' in validateDirName('a\\b'))
})
test('validateDirName: . 或 .. 拒绝', () => {
  assert.ok('error' in validateDirName('.'))
  assert.ok('error' in validateDirName('..'))
})
test('validateDirName: 空/非字符串拒绝', () => {
  assert.ok('error' in validateDirName(''))
  assert.ok('error' in validateDirName(undefined))
})

test('buildCrumbs: 生成根到目标的面包屑', () => {
  const c = buildCrumbs('/Users/u/Docs')
  assert.equal(c.length, 4)
  assert.equal(c[0].name, '/')
  assert.equal(c[c.length - 1].path, '/Users/u/Docs')
})

test('listDirectory: 只回目录,按名排序,hidden=点前缀,截断', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dp-'))
  await fs.mkdir(path.join(root, 'a-dir'))
  await fs.mkdir(path.join(root, 'b-dir'))
  await fs.mkdir(path.join(root, '.hidden-dir'))
  await fs.writeFile(path.join(root, 'a-file.txt'), 'x', 'utf-8')
  try {
    const listing = await listDirectory(root, { maxEntries: 10 })
    const names = listing.entries.map((e) => e.name)
    assert.ok(names.includes('a-dir') && names.includes('b-dir'))
    assert.ok(!names.includes('a-file.txt'), '文件不算目录')
    const hidden = listing.entries.find((e) => e.name === '.hidden-dir')
    assert.ok(hidden?.hidden, '点前缀标记 hidden')
    assert.equal(listing.truncated, false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 确认失败**

Run: `npx tsx --test server/src/dirPicker.test.ts`
Expected: FAIL(模块不存在/未定义)

- [ ] **Step 3: 实现最小模块**

```ts
// server/src/dirPicker.ts
import { readdir, realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface DirEntry {
  name: string
  path: string
  hidden: boolean
}
export interface DirListing {
  path: string
  home: string
  crumbs: Array<{ name: string; path: string }>
  entries: DirEntry[]
  truncated: boolean
}

/** 校验 wire 传来的 path 值:只接受绝对路径;含 .. 段拒绝;空缺省(home)。绝不 resolve 到 cwd。 */
export function validateDirPath(raw: unknown): { path: string } | { error: string } {
  if (raw === undefined || raw === null || raw === '') return { path: '' }
  if (typeof raw !== 'string') return { error: 'path 必须是字符串' }
  if (!path.isAbsolute(raw)) return { error: `path 必须是绝对路径(拒绝相对路径,绝不 resolve):${raw}` }
  const segs = path.normalize(raw).split(path.sep).filter(Boolean)
  if (segs.includes('..')) return { error: `path 含 .. 段,拒绝:${raw}` }
  return { path: raw }
}

/** 校验建目录名:单一非空段,不含路径分隔符、. 或 ..。 */
export function validateDirName(raw: unknown): { name: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'name 必须是字符串' }
  const name = raw.trim()
  if (!name) return { error: 'name 不能为空' }
  if (name === '.' || name === '..') return { error: 'name 不能是 . 或 ..' }
  if (name.includes('/') || name.includes('\\')) return { error: `name 不能含路径分隔符:${name}` }
  return { name }
}

/** 从文件系统根到目标的 breadcrumbs(每段一个绝对路径)。 */
export function buildCrumbs(absPath: string): Array<{ name: string; path: string }> {
  const parsed = path.parse(absPath)
  const root = parsed.root || path.sep
  const segs = absPath.slice(parsed.root.length).split(path.sep).filter(Boolean)
  if (segs.length === 0) return [{ name: root === path.sep ? '/' : root, path: root }]
  let cur = root
  const crumbs = segs.map((seg, i) => {
    if (i === 0) {
      cur = root
    } else {
      cur = path.join(cur, seg)
    }
    const name = i === 0 && root !== path.sep ? root : seg
    return { name, path: cur }
  })
  return crumbs
}

/** 枚举目录,只回目录(isDirectory 或 symlink-to-dir),按名排序,hidden=点前缀,maxEntries 截断。 */
export async function listDirectory(
  absPath: string,
  opts: { maxEntries?: number } = {},
): Promise<DirListing> {
  const maxEntries = opts.maxEntries ?? 200
  const den = await readdir(absPath, { withFileTypes: true })
  const dirs: DirEntry[] = []
  for (const de of den) {
    let isDir = de.isDirectory()
    if (de.isSymbolicLink()) {
      try {
        isDir = (await stat(path.join(absPath, de.name))).isDirectory()
      } catch {
        isDir = false // broken/cyclic symlink 跳过
      }
    }
    if (!isDir) continue
    dirs.push({ name: de.name, path: path.join(absPath, de.name), hidden: de.name.startsWith('.') })
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name))
  const truncated = dirs.length > maxEntries
  const entries = truncated ? dirs.slice(0, maxEntries) : dirs
  return {
    path: absPath,
    home: os.homedir(),
    crumbs: buildCrumbs(absPath),
    entries,
    truncated,
  }
}
```

- [ ] **Step 4: 确认通过**

Run: `npx tsx --test server/src/dirPicker.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/dirPicker.ts server/src/dirPicker.test.ts
git commit -m "feat(server): 目录浏览工具函数(dirPicker)"
```

---

### Task 2: 注册 GET /api/dir 与 POST /api/dir 端点

**Files:**
- Modify: `server/src/interaction.ts`(import + 两个路由)
- Test: `server/src/interaction.test.ts`(新增,或追加到 vault.test.ts 旁的新文件)

**Interfaces:**
- Consumes: Task 1 的 `listDirectory`/`validateDirPath`/`validateDirName`;`interaction.ts` 既有的 `existsSync`/`fs`/`path`。
- Produces: 两个 HTTP 端点。
  - `GET /api/dir?path=<abs>`:200 `{ path, home, crumbs, entries, truncated }`;400 非绝对/含 `..`/目录不可读。
  - `POST /api/dir` `{ path, name }`:200 `{ path }`;400 校验失败;409 EEXIST;500 其他建目录失败。

- [ ] **Step 1: 写失败测试**

```ts
// server/src/interaction.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createServer } from './index.js'
import { makeVault } from './testFixtures.js'

process.env.NODE_ENV = 'production'
process.env.LOG_LEVEL = 'error'

test('GET /api/dir: 返回目录列表(只目录、排序、点前缀 hidden)', async () => {
  const vault = await makeVault({})
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dir-api-'))
  await fs.mkdir(path.join(root, 'aa'))
  await fs.mkdir(path.join(root, 'bb'))
  await fs.mkdir(path.join(root, '.hidden'))
  await fs.writeFile(path.join(root, 'file.txt'), 'x', 'utf-8')
  const interaction = await createServer({ kbRoot: vault.kbRoot, agentDir: vault.agentDir })
  try {
    const res = await interaction.app.inject({ method: 'GET', url: `/api/dir?path=${encodeURIComponent(root)}` })
    assert.equal(res.statusCode, 200)
    const body = res.json() as { entries: Array<{ name: string; hidden: boolean }> }
    const names = body.entries.map((e) => e.name)
    assert.ok(names.includes('aa') && names.includes('bb'))
    assert.ok(!names.includes('file.txt'), '文件不算目录')
  } finally {
    await interaction.app.close()
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

test('GET /api/dir: 相对路径 -> 400(绝不 resolve)', async () => {
  const vault = await makeVault({})
  const interaction = await createServer({ kbRoot: vault.kbRoot, agentDir: vault.agentDir })
  try {
    const res = await interaction.app.inject({ method: 'GET', url: '/api/dir?path=foo/bar' })
    assert.equal(res.statusCode, 400)
  } finally {
    await interaction.app.close()
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

test('GET /api/dir: 目录不存在 -> 400', async () => {
  const vault = await makeVault({})
  const interaction = await createServer({ kbRoot: vault.kbRoot, agentDir: vault.agentDir })
  try {
    const res = await interaction.app.inject({ method: 'GET', url: `/api/dir?path=${encodeURIComponent(path.join(os.tmpdir(), 'no-such-zz'))}` })
    assert.equal(res.statusCode, 400)
  } finally {
    await interaction.app.close()
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

test('POST /api/dir: 建目录 -> 200 + 目录存在', async () => {
  const vault = await makeVault({})
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mkdir-api-'))
  const interaction = await createServer({ kbRoot: vault.kbRoot, agentDir: vault.agentDir })
  try {
    const res = await interaction.app.inject({
      method: 'POST', url: '/api/dir',
      payload: { path: root, name: 'newdir' },
    })
    assert.equal(res.statusCode, 200)
    assert.ok((await fs.stat(path.join(root, 'newdir'))).isDirectory())
  } finally {
    await interaction.app.close()
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

test('POST /api/dir: name 含分隔符 -> 400', async () => {
  const vault = await makeVault({})
  const interaction = await createServer({ kbRoot: vault.kbRoot, agentDir: vault.agentDir })
  try {
    const res = await interaction.app.inject({
      method: 'POST', url: '/api/dir',
      payload: { path: os.tmpdir(), name: 'a/b' },
    })
    assert.equal(res.statusCode, 400)
  } finally {
    await interaction.app.close()
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

test('POST /api/dir: 目录已存在 -> 409', async () => {
  const vault = await makeVault({})
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mkdir-exist-'))
  const interaction = await createServer({ kbRoot: vault.kbRoot, agentDir: vault.agentDir })
  try {
    const res = await interaction.app.inject({
      method: 'POST', url: '/api/dir',
      payload: { path: root, name: 'somedir' },
    })
    // 第一次建成功
    assert.equal(res.statusCode, 200)
    // 再建已存在 -> 409
    const res2 = await interaction.app.inject({
      method: 'POST', url: '/api/dir',
      payload: { path: root, name: 'somedir' },
    })
    assert.equal(res2.statusCode, 409)
  } finally {
    await interaction.app.close()
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 确认失败**

Run: `npx tsx --test server/src/interaction.test.ts`
Expected: FAIL(端点不存在)

- [ ] **Step 3: 实现**

在 `server/src/interaction.ts` 顶部加 `import os from 'node:os'`,并从 `./dirPicker.js` 引入:
```ts
import { listDirectory, validateDirPath, validateDirName } from './dirPicker.js'
```

在 `app.get('/api/specs', ...)` 之后加两个路由:

```ts
// ── 目录浏览端点(webui 选 vault 父目录,票据 01/04)─────────────────
// 与桌面原生选择器一致:允许浏览整个文件系统(不裁剪 root)。危险点在"怎么当真 wire 值":
// 绝不 path.resolve(会解析到 server cwd),只接受绝对路径;含 .. 段拒绝。
// 只绑 loopback 是安全边界;此端点本身只做"只读枚举 + 单段建目录"的窄操作。

// 列出目录(只目录、按名排序、点前缀 hidden、maxEntries 截断)。path 缺省 -> 用户 home。
app.get('/api/dir', async (req, reply) => {
  const q = (req.query as { path?: unknown }).path
  const vp = validateDirPath(q)
  if ('error' in vp) return reply.code(400).send({ error: vp.error })
  const abs = vp.path || os.homedir()
  try {
    const listing = await listDirectory(abs)
    return reply.send(listing)
  } catch (err) {
    return reply.code(400).send({
      error: `目录不可读:${abs}(${err instanceof Error ? err.message : String(err)})`,
    })
  }
})

// 新建单个目录(非递归)。name 必须单一非空段。EEXIST->409,其他->500。
app.post('/api/dir', async (req, reply) => {
  const body = (req.body ?? {}) as { path?: unknown; name?: unknown }
  const vp = validateDirPath(body.path)
  if ('error' in vp) return reply.code(400).send({ error: vp.error })
  const vn = validateDirName(body.name)
  if ('error' in vn) return reply.code(400).send({ error: vn.error })
  if (!vp.path) return reply.code(400).send({ error: '需提供 path(绝对路径)' })
  const target = path.join(vp.path, vn.name)
  try {
    await fs.mkdir(target) // 非递归:父目录必须已存在
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return reply.code(409).send({ error: `目录已存在:${target}` })
    return reply.code(500).send({
      error: `建目录失败:${target}(${err instanceof Error ? err.message : String(err)})`,
    })
  }
  req.log.info({ target }, 'dir created')
  return reply.send({ path: target })
})
```

- [ ] **Step 4: 确认通过**

Run: `npx tsx --test server/src/interaction.test.ts`
Expected: PASS

- [ ] **Step 5: 全量回归**

Run: `make typecheck`
Expected: 通过(server 全绿;确认无新增类型错误)

- [ ] **Step 6: 提交**

```bash
git add server/src/dirPicker.ts server/src/dirPicker.test.ts server/src/interaction.ts server/src/interaction.test.ts
git commit -m "feat(server): 暴露 GET/POST /api/dir 目录浏览(webui vault 选择)"
```

---

## Self-Review

**1. Spec coverage** — 对照票据 `01` 与 dir_scope 裁决:
- `GET /api/dir`:返回 `{path, home, crumbs, entries, truncated}`,只目录、按名排序、点前缀 hidden、分页 → Task 1/2 覆盖。
- `POST /api/dir`:单段建目录,EEXIST→409 → 覆盖。
- 安全:拒绝相对/非 fullyQualified、绝不 resolve wire 值、含 .. 段拒绝 → Task 1 的 `validateDirPath` + 端点 400 覆盖。
- 浏览范围不限(跟桌面一致)→ 明确不做 root/gate 裁剪,安全=只绑 loopback + 窄操作。✅ 符合 dir_scope 裁决。
- `Open -> POST /api/vault {path}` 复用现有端点 → web plan 负责,不在本 plan。

**2. Placeholder scan** — 无 TBD/占位;每个代码步有真实代码;`listDirectory` 的 symlink-to-dir 判断(statIsDir)会内联,Test 只断言基础目录行为,不断言 symlink 深路径(集成里不易稳定构造)。`buildCrumbs` 的 C 盘/根显示在测试里覆盖了 POSIX 根。无"类似 Task N"。

**3. Type consistency** — `DirEntry`/`DirListing`/`validateDirPath`/`validateDirName`/`buildCrumbs`/`listDirectory` 签名跨 Task 1→2 一致;端点用 `{error}`/`{path}` union,符合既有 apiSpecs 风格。`statIsDir` 用动态 import 避免顶层依赖(或可在 Task 1 直接 import stat)——已内联,避免循环。

**Gap(留给 web plan):** SPA Miller-column 对话框 + 接入 Settings(web 端)。本 plan 只做 server。对话框渲染、New folder/Open/Show hidden 交互、接 `POST /api/vault`,在 `2026-08-29-webui-vault-picker-ui.md`。
