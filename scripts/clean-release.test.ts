// clean-release.test.ts - planCleanRelease 纯函数测试(ADR-0018 D7,Seam 3)。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentOsArch, planCleanRelease } from './clean-release.js'

// 造假 release/ 条目(各平台完整包 + blockmap + app/code 包 + latest.json + unpacked 目录)
const ENTRIES = [
  'z-wiki-0.1.0-mac-arm64.dmg',
  'z-wiki-0.1.0-mac-arm64.dmg.blockmap',
  'z-wiki-0.1.0-mac-x64.dmg',
  'z-wiki-0.1.0-mac-x64.dmg.blockmap',
  'z-wiki-0.1.0-win-x64.exe',
  'z-wiki-0.1.0-win-x64.exe.blockmap',
  'z-wiki-0.1.0-win-x64.zip',
  'z-wiki-0.1.0-linux-x64.AppImage',
  'z-wiki-app-0.1.0.tar.gz',
  'z-wiki-code-0.1.0.tar.gz',
  'latest.json',
  'mac-arm64',
  'mac',
  'win-unpacked',
  'linux-unpacked',
  'builder-debug.yml',
  '.DS_Store',
]

test('planCleanRelease: 所有完整包(dmg/exe/zip/AppImage)+blockmap 全删', () => {
  const plan = planCleanRelease(ENTRIES)
  for (const name of [
    'z-wiki-0.1.0-mac-arm64.dmg',
    'z-wiki-0.1.0-mac-x64.dmg',
    'z-wiki-0.1.0-win-x64.exe',
    'z-wiki-0.1.0-win-x64.zip',
    'z-wiki-0.1.0-linux-x64.AppImage',
  ]) {
    assert.ok(plan.delete.includes(name), `${name} 应被删`)
  }
})

test('planCleanRelease: 所有增量更新包(app/code tar.gz)全删', () => {
  const plan = planCleanRelease(ENTRIES)
  assert.ok(plan.delete.includes('z-wiki-app-0.1.0.tar.gz'), 'app 包删')
  assert.ok(plan.delete.includes('z-wiki-code-0.1.0.tar.gz'), 'code 包删')
})

test('planCleanRelease: unpacked 缓存 + latest.json + 中间产物保留', () => {
  const plan = planCleanRelease(ENTRIES)
  assert.ok(plan.keep.includes('latest.json'), 'latest.json 保留')
  assert.ok(plan.keep.includes('mac-arm64'), 'unpacked 目录保留')
  assert.ok(plan.keep.includes('mac'), 'mac 缓存保留')
  assert.ok(plan.keep.includes('win-unpacked'), 'win 缓存保留')
  assert.ok(plan.keep.includes('linux-unpacked'), 'linux 缓存保留')
  assert.ok(plan.keep.includes('builder-debug.yml'), 'builder-debug.yml 保留')
  assert.ok(plan.keep.includes('.DS_Store'), '.DS_Store 保留')
})

test('planCleanRelease: 多个版本的全删', () => {
  const mixed = [
    'z-wiki-0.1.0-mac-arm64.dmg',
    'z-wiki-0.2.0-mac-arm64.dmg',
    'z-wiki-app-0.1.0.tar.gz',
    'z-wiki-app-0.2.0.tar.gz',
    'latest.json',
    'mac-arm64',
  ]
  const plan = planCleanRelease(mixed)
  assert.ok(plan.delete.includes('z-wiki-0.1.0-mac-arm64.dmg'))
  assert.ok(plan.delete.includes('z-wiki-0.2.0-mac-arm64.dmg'))
  assert.ok(plan.delete.includes('z-wiki-app-0.1.0.tar.gz'))
  assert.ok(plan.delete.includes('z-wiki-app-0.2.0.tar.gz'))
  assert.deepEqual(plan.keep.sort(), ['latest.json', 'mac-arm64'])
})

test('planCleanRelease: 无成品包 -> delete 为空', () => {
  const plan = planCleanRelease(['latest.json', 'mac-arm64', 'win-unpacked'])
  assert.equal(plan.delete.length, 0)
  assert.equal(plan.keep.length, 3)
})

test('currentOsArch: platform + arch -> os-arch 命名', () => {
  assert.equal(currentOsArch('darwin', 'arm64'), 'mac-arm64')
  assert.equal(currentOsArch('darwin', 'x64'), 'mac-x64')
  assert.equal(currentOsArch('win32', 'x64'), 'win-x64')
  assert.equal(currentOsArch('win32', 'arm64'), 'win-arm64')
  assert.equal(currentOsArch('linux', 'x64'), 'linux-x64')
  assert.equal(currentOsArch('linux', 'arm64'), 'linux-arm64')
})
