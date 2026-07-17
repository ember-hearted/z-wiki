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

test('planCleanRelease: 当前 mac-arm64 -> 删其他平台/arch 完整包 + blockmap', () => {
  const plan = planCleanRelease(ENTRIES, 'mac-arm64')
  assert.deepEqual(
    plan.delete.sort(),
    [
      'z-wiki-0.1.0-linux-x64.AppImage',
      'z-wiki-0.1.0-mac-x64.dmg',
      'z-wiki-0.1.0-mac-x64.dmg.blockmap',
      'z-wiki-0.1.0-win-x64.exe',
      'z-wiki-0.1.0-win-x64.exe.blockmap',
      'z-wiki-0.1.0-win-x64.zip',
    ].sort(),
  )
})

test('planCleanRelease: 当前 mac-arm64 -> 保留当前 arch 完整包 + app/code + latest + unpacked', () => {
  const plan = planCleanRelease(ENTRIES, 'mac-arm64')
  assert.ok(plan.keep.includes('z-wiki-0.1.0-mac-arm64.dmg'), '当前 arch dmg 保留')
  assert.ok(plan.keep.includes('z-wiki-0.1.0-mac-arm64.dmg.blockmap'), '当前 arch blockmap 保留')
  assert.ok(plan.keep.includes('z-wiki-app-0.1.0.tar.gz'), 'app 包保留')
  assert.ok(plan.keep.includes('z-wiki-code-0.1.0.tar.gz'), 'code 包保留')
  assert.ok(plan.keep.includes('latest.json'), 'latest.json 保留')
  assert.ok(plan.keep.includes('mac-arm64'), 'unpacked 目录保留')
  assert.ok(plan.keep.includes('win-unpacked'), '其他平台 unpacked 也保留(加速下次打包)')
  assert.ok(plan.keep.includes('builder-debug.yml'), '中间文件保留')
})

test('planCleanRelease: 当前 win-x64 -> 删 mac/linux,保留 win exe+zip', () => {
  const plan = planCleanRelease(ENTRIES, 'win-x64')
  assert.ok(plan.keep.includes('z-wiki-0.1.0-win-x64.exe'))
  assert.ok(plan.keep.includes('z-wiki-0.1.0-win-x64.zip'))
  assert.ok(plan.keep.includes('z-wiki-0.1.0-win-x64.exe.blockmap'))
  assert.ok(plan.delete.includes('z-wiki-0.1.0-mac-arm64.dmg'))
  assert.ok(plan.delete.includes('z-wiki-0.1.0-linux-x64.AppImage'))
})

test('planCleanRelease: 无完整包时 delete 为空', () => {
  const plan = planCleanRelease(
    ['latest.json', 'mac-arm64', 'z-wiki-app-0.1.0.tar.gz'],
    'mac-arm64',
  )
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
