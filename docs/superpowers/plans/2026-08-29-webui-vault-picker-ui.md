# WebUI Vault 目录选择对话框 Implementation Plan（web）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 webui(浏览器)形态下给"新建知识库"提供目录选择:弹出应用内目录树对话框,浏览/新建本地目录,选中父目录喂给现有 `POST /api/vault {name, parentPath}` 流程,替代被隐藏的 `window.desktop.selectVaultPath`。

**Architecture:** 复用 server 已实现的 `GET /api/dir` 与 `POST /api/dir`(dir-api plan)。新建一个受控弹层组件 `DirPicker.tsx`(项目自有控件风格,参照 `Select.tsx`),可测逻辑抽成纯函数 `dirPicker.ts`(符合本仓库"逻辑单测、组件不挂载测"的模式,见 `ReceiveAction.test.ts`)。接入 `Settings.tsx`:浏览器形态(`!window.desktop`)显示"选择目录"并打开 Dialog,`onSelect` 设 `newVaultParent`;桌面形态保留原生 `window.desktop.selectVaultPath`。

**Tech Stack:** React 19、node:test(纯函数单测)、CSS 模态(项目 token,`var(--...)`)。

**Spec:** `.scratch/wayfinder/webui/tickets/01-vault-directory-picker.md`(票据 `01` DSH browse 方案:SPA 渲染 Miller-column 对话框——面包屑 + 点击编辑路径、New folder→`POST /api/dir`、Open→选中、Show hidden=客户端过滤)+ `MAP.md`(dir_scope:浏览全盘)。

## Global Constraints

- TypeScript ESM(web 用 `tsc -b`);无分号、单引号、2 空格;中文注释;改完 `make typecheck` + `biome check`。
- 组件按项目自有控件风格(`Select.tsx`/`Settings.tsx`):`settings-*` 类 + token 变量;受控、键盘导航、点击外部关闭、a11y。
- **测试模式**:只测纯函数(不挂载组件)——参照 `ReceiveAction.test.ts`/`chatCopy.test.ts`(`tsx --test`)。组件不做 jsdom 测试。
- 对话框数据来自 `GET /api/dir?path=<abs>`(返回 `{path,home,crumbs,entries,truncated}`)与 `POST /api/dir {path,name}`;绝不 `path.resolve`(server 端已拦)。前端只用返回值。
- 浏览器形态 = `!window.desktop`(preload 注入的桥缺失);桌面形态保留原生 `window.desktop.selectVaultPath`。
- 选中目录 = **父目录**(喂 `POST /api/vault {name, parentPath}`),不是 kb 根(跟桌面版一致)。
- 不新增 npm 依赖(不用 jsdom/testing-library;纯函数测试走 tsx)。

---

### Task 1: 目录选择纯函数 helper

**Files:**
- Create: `web/src/components/dirPicker.ts`
- Test: `web/src/components/dirPicker.test.ts`

**Interfaces:**
- Consumes: 只依赖内建;定义 `DirListing`/`DirEntry` 类型(POST 响应用)。
- Produces:
  - `export interface DirEntry { name: string; path: string; hidden: boolean }`
  - `export interface DirListing { path: string; home: string; crumbs: Array<{ name: string; path: string }>; entries: DirEntry[]; truncated: boolean }`
  - `export function buildDirUrl(path: string): string` — 构建 `GET /api/dir?path=<encodeURIComponent(path)>`;path 空 → `/api/dir`(缺省 home)。
  - `export function filterHidden(entries: DirEntry[], showHidden: boolean): DirEntry[]` — showHidden=false 时滤掉 `.hidden`。
  - `export function dirToInitial(entries: DirEntry[], showHidden: boolean): DirEntry` — 可选;不必要就不加。YAGNI:跳过。
  - `export async function fetchDir(path: string, showHidden: boolean): Promise<{ listing: DirListing } | { error: string }>` — fetch + 解析 + filterHidden,出错返回 `{error}`。用于组件;纯逻辑可测(注入 fetch?)。为可测,拆成 `export async function fetchDir(path: string, setEntries: ...)` 过度;改用一个接受 `res: {ok,json}` 的解码纯函数 `decodeDir(res): {listing}|{error}`。

  修正(保持纯函数可测):
  - `export function buildDirUrl(path: string): string` — `/api/dir` + query。
  - `export type DirResponse = { listing: DirListing } | { error: string }`（纯解码用）
  - `export function decodeDir(json: unknown): DirResponse` — 校验 `json` 形状:有 `entries` 数组 → `{listing}`;否则查 `json.error` → `{error}`;否则 `{error:'意外响应'}`。
  - `export function filterHidden(entries: DirEntry[], showHidden: boolean): DirEntry[]` — showHidden=false 滤 `.hidden`。
  - `export function parentOf(absPath: string): string` — 从 `crumbs` 的"选择此目录"取当前 path;或直接由组件 state 持有。为最小,`DirPicker` 直接用 listing.path 作为"当前目录"。`parentOf` 不需要。

- [ ] **Step 1: 写失败测试**

```ts
// web/src/components/dirPicker.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildDirUrl, decodeDir, filterHidden, type DirListing, type DirEntry } from './dirPicker.js'

test('buildDirUrl: 有 path 则拼 query', () => {
  assert.equal(buildDirUrl('/a/b'), '/api/dir?path=%2Fa%2Fb')
})
test('buildDirUrl: 空 path 则无 query(缺省 home)', () => {
  assert.equal(buildDirUrl(''), '/api/dir')
})

test('decodeDir: 合法 listings 返回 {listing}', () => {
  const json = { path: '/a', home: '/', crumbs: [], entries: [], truncated: false }
  const r = decodeDir(json)
  assert.ok('listing' in r)
  assert.equal((r as { listing: DirListing }).listing.path, '/a')
})
test('decodeDir: error 字段返回 {error}', () => {
  const r = decodeDir({ error: '目录不可读' })
  assert.ok('error' in r)
  assert.equal((r as { error: string }).error, '目录不可读')
})
test('decodeDir: 意外形状返回 {error}', () => {
  const r = decodeDir(null)
  assert.ok('error' in r)
})

test('filterHidden: showHidden=false 滤掉点前缀', () => {
  const entries: DirEntry[] = [
    { name: 'aa', path: '/a/aa', hidden: false },
    { name: '.hidden', path: '/a/.hidden', hidden: true },
  ]
  const out = filterHidden(entries, false)
  assert.equal(out.length, 1)
  assert.equal(out[0].name, 'aa')
})
test('filterHidden: showHidden=true 保留点前缀', () => {
  const entries: DirEntry[] = [
    { name: 'aa', path: '/a/aa', hidden: false },
    { name: '.hidden', path: '/a/.hidden', hidden: true },
  ]
  const out = filterHidden(entries, true)
  assert.equal(out.length, 2)
})
```

- [ ] **Step 2: 确认失败**

Run: `npx tsx --test web/src/components/dirPicker.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现最小模块**

```ts
// web/src/components/dirPicker.ts
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
export type DirResponse = { listing: DirListing } | { error: string }

/** 构建 GET /api/dir 请求 URL。path 为空则不拼 query(缺省 home)。 */
export function buildDirUrl(path: string): string {
  return path ? `/api/dir?path=${encodeURIComponent(path)}` : '/api/dir'
}

/** 解码 GET /api/dir 响应:有 entries 数组视为 listing;否则取 error;否则意外。 */
export function decodeDir(json: unknown): DirResponse {
  if (json && typeof json === 'object' && Array.isArray((json as DirListing).entries)) {
    return { listing: json as DirListing }
  }
  const err = (json as { error?: string } | null)?.error
  return err ? { error: err } : { error: '意外响应' }
}

/** 隐藏文件过滤:showHidden=false 时滤掉点前缀目录。 */
export function filterHidden(entries: DirEntry[], showHidden: boolean): DirEntry[] {
  return showHidden ? entries : entries.filter((e) => !e.hidden)
}
```

- [ ] **Step 4: 确认通过**

Run: `npx tsx --test web/src/components/dirPicker.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/components/dirPicker.ts web/src/components/dirPicker.test.ts
git commit -m "feat(web): 目录选择纯函数 helper(dirPicker)"
```

---

### Task 2: DirPicker 组件(应用内目录树对话框)

**Files:**
- Create: `web/src/components/DirPicker.tsx`
- Modify: `web/src/styles/settings.css`(对话框样式)
- Test: 无组件挂载测(项目模式);helper 已在 Task 1 测。

**Interfaces:**
- Consumes: Task 1 的 `buildDirUrl`/`decodeDir`/`filterHidden`/`DirListing`/`DirEntry`。
- Produces:
  - `export interface DirPickerProps { open: boolean; onClose: () => void; onSelect: (parentPath: string) => void; }`
  - `export default function DirPicker({ open, onClose, onSelect }: DirPickerProps): React.JSX.Element | null`
  - 行为:open=false 返回 null;打开时 fetch home(`buildDirUrl('')`)→ decode → listing;渲染面包屑(`listing.crumbs`)点击导航;目录列表(点击进入);"新建文件夹"输入框 → `POST /api/dir {path: listing.path, name}` → 刷新;"选择此目录"→ `onSelect(listing.path)` + onClose;"显示隐藏"toggle → filterHidden;错误显示。

- [ ] **Step 1: 实现组件**

```tsx
// web/src/components/DirPicker.tsx
import { useCallback, useEffect, useState } from 'react'
import { buildDirUrl, decodeDir, filterHidden, type DirListing } from './dirPicker.js'

export interface DirPickerProps {
  open: boolean
  onClose: () => void
  onSelect: (parentPath: string) => void
}

/** 应用内目录树对话框(webui 浏览/新建本地目录,替代 window.desktop.selectVaultPath)。
 *  数据源于 GET /api/dir;新建走 POST /api/dir;选目录 = 父目录(喂 POST /api/vault {name,parentPath})。 */
export default function DirPicker({ open, onClose, onSelect }: DirPickerProps) {
  const [listing, setListing] = useState<DirListing | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(buildDirUrl(path))
      const json = (await res.json()) as unknown
      const d = decodeDir(json)
      if ('error' in d) setError(d.error)
      else setListing(d.listing)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setListing(null)
      void load('')
    }
  }, [open, load])

  if (!open) return null

  const entries = listing ? filterHidden(listing.entries, showHidden) : []

  const goTo = (p: string) => void load(p)

  const create = async () => {
    if (!listing || !newName.trim()) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/dir', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: listing.path, name: newName.trim() }),
      })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string }
        setError(j.error ?? `HTTP ${res.status}`)
      } else {
        setNewName('')
        await load(listing.path)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="dirpicker-backdrop" onClick={onClose}>
      <div className="dirpicker" role="dialog" aria-modal="true" aria-label="选择知识库存放目录" onClick={(e) => e.stopPropagation()}>
        <div className="dirpicker-header">
          <h2 className="dirpicker-title">选择知识库存放目录</h2>
          <button type="button" className="settings-btn" onClick={onClose} aria-label="关闭">×</button>
        </div>
        {error && <div className="settings-error">{error}</div>}
        <div className="dirpicker-crumbs" role="navigation" aria-label="路径面包屑">
          {listing?.crumbs.map((c) => (
            <button key={c.path} type="button" className="dirpicker-crumb" onClick={() => goTo(c.path)}>
              {c.name}
            </button>
          ))}
          {listing && <span className="dirpicker-current">{listing.path}</span>}
        </div>
        <div className="dirpicker-toolbar">
          <label className="settings-switch-label">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            显示隐藏
          </label>
          <span className="dirpicker-hint">选中的目录作为新建知识库的存放位置</span>
        </div>
        <ul className="dirpicker-list" role="listbox" aria-label="目录列表">
          {loading && <li className="dirpicker-empty">加载中…</li>}
          {!loading && entries.length === 0 && <li className="dirpicker-empty">此目录下无子目录</li>}
          {entries.map((e) => (
            <li key={e.path}>
              <button type="button" className="dirpicker-item" onClick={() => goTo(e.path)}>
                <span className="dirpicker-item-name">{e.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="dirpicker-new">
          <input
            className="settings-input"
            type="text"
            placeholder="新建文件夹名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            aria-label="新建文件夹名称"
          />
          <button type="button" className="settings-btn" onClick={() => void create()} disabled={creating || !newName.trim()}>
            {creating ? '创建中…' : '新建文件夹'}
          </button>
        </div>
        <div className="dirpicker-actions">
          <button type="button" className="settings-btn" onClick={onClose}>取消</button>
          <button type="button" className="settings-btn primary" onClick={() => { if (listing) { onSelect(listing.path); onClose() } }} disabled={!listing}>
            选择此目录
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 加对话框样式**

在 `web/src/styles/settings.css` 末尾追加:

```css
/* ── DirPicker 目录选择对话框(webui 选 Vault 父目录)── */
.dirpicker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.dirpicker {
  width: min(560px, calc(100vw - 2rem));
  max-height: min(70vh, 32rem);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-5);
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: var(--r-3xl);
  box-shadow: var(--shadow-lg);
}
.dirpicker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}
.dirpicker-title {
  font-family: var(--mono);
  font-size: var(--fs-base);
  font-weight: 700;
  color: var(--text-bright);
  margin: 0;
}
.dirpicker-crumbs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1);
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.dirpicker-crumb {
  border: none;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  padding: 0.1rem 0.2rem;
  border-radius: var(--r-sm);
}
.dirpicker-crumb:hover { background: var(--accent-bg); }
.dirpicker-current { color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dirpicker-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}
.dirpicker-hint { font-size: var(--fs-xs); color: var(--text-faint); }
.dirpicker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  border: 1px solid var(--border-light);
  border-radius: var(--r-md);
  flex: 1;
  min-height: 8rem;
  max-height: 16rem;
}
.dirpicker-item {
  display: block;
  width: 100%;
  padding: 0.4rem 0.6rem;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--mono);
  font-size: var(--fs-sm);
  text-align: left;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.dirpicker-item:hover { background: var(--accent-bg); color: var(--text-bright); }
.dirpicker-empty { padding: var(--sp-3); font-size: var(--fs-xs); color: var(--text-faint); text-align: center; }
.dirpicker-new { display: flex; gap: var(--sp-2); }
.dirpicker-actions { display: flex; justify-content: flex-end; gap: var(--sp-2); }
```

- [ ] **Step 3: 全量类型检查**

Run: `make typecheck`
Expected: 通过(web 无类型错误)

- [ ] **Step 4: 提交**

```bash
git add web/src/components/DirPicker.tsx web/src/styles/settings.css
git commit -m "feat(web): 目录选择对话框组件(DirPicker)"
```

---

### Task 3: 接入 Settings(浏览器形态用 DirPicker,桌面保留原生)

**Files:**
- Modify: `web/src/components/Settings.tsx`
- Test: 纯逻辑抽出 `dirPicker`(Task 1)已测;Settings 接入不加新纯函数(组件不改挂载测)。

**Interfaces:**
- Consumes: Task 2 的 `DirPicker` 组件。
- Produces: Settings 的"选择目录"按钮在 `!window.desktop` 下打开 `DirPicker`,`onSelect` 设 `newVaultParent`(与桌面 `selectVaultParent` 同效)。

- [ ] **Step 1: 修改 Settings**

在 `web/src/components/Settings.tsx`:
1. 顶部 add `import DirPicker from './DirPicker'`。
2. 加 state:`const [dirPickerOpen, setDirPickerOpen] = useState(false)`。
3. 加一个 `selectVaultParentBrowser` 逻辑(或直接把 `DirPicker` 的 onSelect 设为 `(p) => { setNewVaultParent(p); setDirPickerOpen(false) }`)。

把现有的"选择目录"按钮改为:**浏览器形态显示 DirPicker 触发器**(`!window.desktop`),桌面形态保留原生按钮。具体改 line 548-571 的 `window.desktop && (...)` 分支:

```tsx
{window.desktop ? (
  <div className="new-vault-location">
    <span>存放位置:</span>
    <code className="vault-path">{newVaultParent || currentVaultParent || '默认'}</code>
    <button type="button" className="settings-btn" onClick={() => void selectVaultParent()} disabled={busy}>
      {newVaultParent ? '更改' : '选择目录'}
    </button>
    {newVaultParent && (
      <button type="button" className="settings-btn" onClick={() => setNewVaultParent('')} disabled={busy}>
        清除
      </button>
    )}
  </div>
) : (
  <div className="new-vault-location">
    <span>存放位置:</span>
    <code className="vault-path">{newVaultParent || currentVaultParent || '默认'}</code>
    <button type="button" className="settings-btn" onClick={() => setDirPickerOpen(true)} disabled={busy}>
      {newVaultParent ? '更改' : '选择目录'}
    </button>
    {newVaultParent && (
      <button type="button" className="settings-btn" onClick={() => setNewVaultParent('')} disabled={busy}>
        清除
      </button>
    )}
  </div>
)}
```

然后在 JSX 末尾(返回前)加:

```tsx
<DirPicker
  open={dirPickerOpen}
  onClose={() => setDirPickerOpen(false)}
  onSelect={(p) => { setNewVaultParent(p); setDirPickerOpen(false) }}
/>
```

- [ ] **Step 2: 全量类型检查 + test**

Run: `make typecheck`
Expected: 通过

Run: `npx tsx --test web/src/components/dirPicker.test.ts`
Expected: 通过

- [ ] **Step 3: 手工冒烟(浏览器形态)**

Run: `make run-web`(或 `npm run web`)
Expected: webui 打开,进"/settings",在"新建知识库"处看到"选择目录"按钮(浏览器形态,`!window.desktop`);点击弹出对话框,可在 home 下浏览子目录、新建文件夹、选"选择此目录"后 `newVaultParent` 显示所选路径。

- [ ] **Step 4: 提交**

```bash
git add web/src/components/Settings.tsx
git commit -m "feat(web): Settings 浏览器形态接入 DirPicker 选 Vault 父目录"
```

---

## Self-Review

**1. Spec coverage** — 对照票据 `01`(SPA 渲染目录对话框:面包屑+点击编辑路径、New folder→POST /api/dir、Open→选中、Show hidden=客户端过滤)与 dir_scope:
- 面包屑导航(crumbs 点击)→ Task 2 覆盖。
- 新建文件夹→POST /api/dir→ Task 2 `create` 覆盖。
- Open/选中→`onSelect(listing.path)`→ Task 2+3 覆盖。
- Show hidden=客户端过滤→ Task 1 `filterHidden`+Task 2 `showHidden` toggle 覆盖。
- 浏览器形态替代 `window.desktop.selectVaultPath`→ Task 3 覆盖(桌面保留原生)。

**2. Placeholder scan** — 无 TBD/占位;每个代码步有真实代码;`decodeDir`/`buildDirUrl`/`filterHidden` 均在 Task 1 定义;组件代码 Task 2 完整。无"类似 Task N"。

**3. Type consistency** — `DirEntry`/`DirListing`/`DirResponse` 跨 Task 1→2 一致;`DirPickerProps` Task 2 定义;`DirPicker` 默认导出 Task 3 用。`filterHidden(entries, showHidden)` 签名 Task 1 定义、Task 2 调用一致。`buildDirUrl`/`decodeDir` 签名一致。

**Gap(范围外):** `/api/dir` server 端已在前一个 plan 实现;本 plan 只用它。`POST /api/vault {name,parentPath}` 复用既有端点。dev 形态(vite proxy)+ 桌面形态走 `/api/dir` 需 server 也在跑——冒烟验证需 `make run-web`(server serve web/dist)。若用户只在 vite dev 下看 Settings,需同时起 server(proxy 到 3000)。已在 Task 3 Step 3 说明用 `make run-web`。
