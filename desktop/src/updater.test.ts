// updater.test.ts - selectUpdatePackage 决策纯函数 + .update-state.json 读写 +
// applyPendingUpdate(win staging 启动早期替换)(ADR-0018 D2/D6,Seam 1 + Ticket 06)。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  applyPendingUpdate,
  CODE_PATCH_PATHS,
  fullPackageKey,
  readUpdateState,
  restoreOldPatches,
  selectUpdatePackage,
  writeUpdateState,
} from './updater.js'
import type { LocalState, PendingUpdate, RemoteManifest } from './updater.js'

const LOCAL: LocalState = {
  appVersion: '0.1.0',
  depsVersion: 'aaa',
  baselineVersion: 'bbb',
  platform: 'darwin',
}

const REMOTE: RemoteManifest = {
  appVersion: '0.1.0',
  depsVersion: 'aaa',
  baselineVersion: 'bbb',
  packages: {
    code: { url: 'code-url', sha512: 'code-sha', size: 5 },
    app: { url: 'app-url', sha512: 'app-sha', size: 45 },
    full: {
      'mac-arm64': { url: 'full-mac-arm64-url', sha512: 'full-mac-sha', size: 210 },
      'linux-x64': { url: 'full-linux-x64-url', sha512: 'full-linux-sha', size: 178 },
    },
  },
}

const FULL_MAC = REMOTE.packages.full?.['mac-arm64'] ?? null
const FULL_LINUX = REMOTE.packages.full?.['linux-x64'] ?? null

test('fullPackageKey: darwin->mac, win32->win, linux 原样,arch 透传', () => {
  assert.equal(fullPackageKey('darwin', 'arm64'), 'mac-arm64')
  assert.equal(fullPackageKey('darwin', 'x64'), 'mac-x64')
  assert.equal(fullPackageKey('win32', 'x64'), 'win-x64')
  assert.equal(fullPackageKey('linux', 'x64'), 'linux-x64')
})

test('selectUpdatePackage: 无变化 -> none', () => {
  assert.deepEqual(selectUpdatePackage(LOCAL, REMOTE, 'arm64'), { action: 'none', package: null })
})

test('selectUpdatePackage: appVersion 变 -> code', () => {
  const r = { ...REMOTE, appVersion: '0.2.0' }
  assert.deepEqual(selectUpdatePackage(LOCAL, r, 'arm64'), {
    action: 'code',
    package: REMOTE.packages.code,
  })
})

test('selectUpdatePackage: depsVersion 变 -> app', () => {
  const r = { ...REMOTE, depsVersion: 'ccc' }
  assert.deepEqual(selectUpdatePackage(LOCAL, r, 'arm64'), {
    action: 'app',
    package: REMOTE.packages.app,
  })
})

test('selectUpdatePackage: baselineVersion 变 -> full,按 platformArch 取 full map 条目', () => {
  const r = { ...REMOTE, baselineVersion: 'ddd' }
  assert.deepEqual(selectUpdatePackage(LOCAL, r, 'arm64'), { action: 'full', package: FULL_MAC })
})

test('selectUpdatePackage: baselineVersion 变但 full map 缺本平台条目 -> full 且 package null(降级提示)', () => {
  const winLocal = { ...LOCAL, platform: 'win32' } // REMOTE.full 无 win-x64
  const r = { ...REMOTE, baselineVersion: 'ddd' }
  assert.deepEqual(selectUpdatePackage(winLocal, r, 'x64'), { action: 'full', package: null })
})

test('selectUpdatePackage: deps + appVersion 都变 -> 选重的 app', () => {
  const r = { ...REMOTE, depsVersion: 'ccc', appVersion: '0.2.0' }
  assert.deepEqual(selectUpdatePackage(LOCAL, r, 'arm64'), {
    action: 'app',
    package: REMOTE.packages.app,
  })
})

test('selectUpdatePackage: baseline + appVersion 都变 -> 选最重的 full', () => {
  const r = { ...REMOTE, baselineVersion: 'ddd', appVersion: '0.2.0' }
  assert.deepEqual(selectUpdatePackage(LOCAL, r, 'arm64'), { action: 'full', package: FULL_MAC })
})

test('selectUpdatePackage: linux 无变化 -> none', () => {
  const linuxLocal = { ...LOCAL, platform: 'linux' }
  assert.deepEqual(selectUpdatePackage(linuxLocal, REMOTE, 'x64'), {
    action: 'none',
    package: null,
  })
})

test('selectUpdatePackage: linux 有变化 -> 总 full(不走增量,AppImage 只读),取 linux 条目', () => {
  const linuxLocal = { ...LOCAL, platform: 'linux' }
  assert.deepEqual(selectUpdatePackage(linuxLocal, { ...REMOTE, appVersion: '0.2.0' }, 'x64'), {
    action: 'full',
    package: FULL_LINUX,
  })
  assert.deepEqual(selectUpdatePackage(linuxLocal, { ...REMOTE, depsVersion: 'ccc' }, 'x64'), {
    action: 'full',
    package: FULL_LINUX,
  })
})

test('selectUpdatePackage: code 包缺失时 appVersion 变 -> code 但 package null', () => {
  const r = { ...REMOTE, appVersion: '0.2.0', packages: {} }
  assert.deepEqual(selectUpdatePackage(LOCAL, r, 'arm64'), { action: 'code', package: null })
})

test('writeUpdateState + readUpdateState: 读写一致', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-update-state-'))
  try {
    const file = path.join(dir, '.update-state.json')
    await writeUpdateState(file, LOCAL)
    const read = await readUpdateState(file)
    assert.deepEqual(read, LOCAL)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('readUpdateState: 文件不存在 -> null', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-update-state-'))
  try {
    const read = await readUpdateState(path.join(dir, 'nope.json'))
    assert.equal(read, null)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

// ===== applyPendingUpdate(win staging 启动早期替换) =====

const PENDING_CODE: PendingUpdate = {
  tier: 'code',
  appVersion: '0.2.0',
  depsVersion: 'ccc',
  baselineVersion: 'ddd',
  platform: 'win32',
}

/** 造假 resources 树(code 档 4 处,内容为 old) + staging 树(内容为 new + pending.json)。 */
async function makeFixture(
  dir: string,
  pending: PendingUpdate,
): Promise<{ resourcesDir: string; stagingDir: string; statePath: string }> {
  const resourcesDir = path.join(dir, 'resources')
  const stagingDir = path.join(dir, 'update-staging')
  const statePath = path.join(dir, '.update-state.json')
  const codeRels = [
    'app/dist/main.js',
    'app/node_modules/@z-wiki/server/index.js',
    'web/dist/index.html',
    'app/package.json',
  ]
  for (const rel of codeRels) {
    for (const [root, content] of [
      [resourcesDir, 'old'],
      [stagingDir, 'new'],
    ] as const) {
      const p = path.join(root, rel)
      await fs.mkdir(path.dirname(p), { recursive: true })
      await fs.writeFile(p, content)
    }
  }
  await fs.writeFile(path.join(stagingDir, 'pending.json'), JSON.stringify(pending))
  return { resourcesDir, stagingDir, statePath }
}

test('applyPendingUpdate: staging 不存在 -> false,不动 resources', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-pending-'))
  try {
    const applied = await applyPendingUpdate(
      path.join(dir, 'nope'),
      path.join(dir, 'resources'),
      path.join(dir, '.update-state.json'),
    )
    assert.equal(applied, false)
    assert.equal(existsSync(path.join(dir, '.update-state.json')), false)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('applyPendingUpdate: staging 存在但 pending.json 缺失 -> 清损坏 staging,返回 false(防短路卡死)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-pending-'))
  try {
    const stagingDir = path.join(dir, 'update-staging')
    await fs.mkdir(path.join(stagingDir, 'app'), { recursive: true }) // 半写残留,无 pending.json
    const applied = await applyPendingUpdate(
      stagingDir,
      path.join(dir, 'resources'),
      path.join(dir, '.update-state.json'),
    )
    assert.equal(applied, false)
    assert.equal(existsSync(stagingDir), false)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('restoreOldPatches: 把已搬走的 .old 还原回目标(覆盖失败回滚)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-restore-'))
  try {
    // 模拟半替换:app/dist 已替换(旧 -> .old,新在 target),web/dist 未动
    const distNew = path.join(dir, 'app/dist')
    const distOld = path.join(dir, 'app/dist.old')
    await fs.mkdir(distNew, { recursive: true })
    await fs.writeFile(path.join(distNew, 'main.js'), 'new')
    await fs.mkdir(distOld, { recursive: true })
    await fs.writeFile(path.join(distOld, 'main.js'), 'old')

    await restoreOldPatches(dir, CODE_PATCH_PATHS)

    // target 还原为旧内容,.old 消失
    assert.equal(await fs.readFile(path.join(dir, 'app/dist/main.js'), 'utf-8'), 'old')
    assert.equal(existsSync(distOld), false)
    // 无 .old 的条目不受影响,也不 throw
    await restoreOldPatches(dir, CODE_PATCH_PATHS)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('applyPendingUpdate: code 档替换 4 处 + 旧目录成 .old + 写回 state + 删 staging', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-pending-'))
  try {
    const { resourcesDir, stagingDir, statePath } = await makeFixture(dir, PENDING_CODE)
    const applied = await applyPendingUpdate(stagingDir, resourcesDir, statePath)
    assert.equal(applied, true)
    // 新内容就位
    assert.equal(await fs.readFile(path.join(resourcesDir, 'app/dist/main.js'), 'utf-8'), 'new')
    // 旧目录成 .old
    assert.equal(await fs.readFile(path.join(resourcesDir, 'app/dist.old/main.js'), 'utf-8'), 'old')
    // state 写回 pending 的版本号
    assert.deepEqual(await readUpdateState(statePath), {
      appVersion: '0.2.0',
      depsVersion: 'ccc',
      baselineVersion: 'ddd',
      platform: 'win32',
    })
    // staging 已删
    assert.equal(existsSync(stagingDir), false)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('applyPendingUpdate: staging 缺条目 -> skip 不 throw(重试续传语义)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-pending-'))
  try {
    const { resourcesDir, stagingDir, statePath } = await makeFixture(dir, PENDING_CODE)
    // 模拟上次半替换:web/dist 已从 staging 搬走
    await fs.rm(path.join(stagingDir, 'web/dist'), { recursive: true })
    const applied = await applyPendingUpdate(stagingDir, resourcesDir, statePath)
    assert.equal(applied, true)
    // 其余条目已替换
    assert.equal(await fs.readFile(path.join(resourcesDir, 'app/dist/main.js'), 'utf-8'), 'new')
    // 缺失条目对应的旧内容原样保留
    assert.equal(await fs.readFile(path.join(resourcesDir, 'web/dist/index.html'), 'utf-8'), 'old')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('applyPendingUpdate: app 档整体替换 app/ + web/dist/', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-pending-'))
  try {
    const { resourcesDir, stagingDir, statePath } = await makeFixture(dir, {
      ...PENDING_CODE,
      tier: 'app',
    })
    // 应用包还带 node_modules 第三方依赖(code 档不碰):resources 里的第三方不应被 app 档之外动
    const depOld = path.join(resourcesDir, 'app/node_modules/some-dep/index.js')
    await fs.mkdir(path.dirname(depOld), { recursive: true })
    await fs.writeFile(depOld, 'dep-old')
    const depNew = path.join(stagingDir, 'app/node_modules/some-dep/index.js')
    await fs.mkdir(path.dirname(depNew), { recursive: true })
    await fs.writeFile(depNew, 'dep-new')

    const applied = await applyPendingUpdate(stagingDir, resourcesDir, statePath)
    assert.equal(applied, true)
    // 整个 app/ 被替换(含第三方依赖)
    assert.equal(
      await fs.readFile(path.join(resourcesDir, 'app/node_modules/some-dep/index.js'), 'utf-8'),
      'dep-new',
    )
    assert.equal(await readUpdateState(statePath).then((s) => s?.appVersion), '0.2.0')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
