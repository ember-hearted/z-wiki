// package-update-bundles.test.ts - 打包纯函数测试(ADR-0018 D2/D3,Seam 2)。
// 测 computeVersions / collectCodePatchEntries / collectFullPackages / buildManifest 纯函数;
// main(IO:tar/sha512/读 package.json)不测,靠 make package 手动验证。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { computeVersions } from './lib/release-versions.js'
import {
  buildManifest,
  collectAppBundleEntries,
  collectCodePatchEntries,
  collectFullPackages,
} from './package-update-bundles.js'

test('computeVersions: depsVersion = lockHash 前 12 位, baselineVersion 拼接', () => {
  const v = computeVersions({
    appVersion: '0.2.0',
    electronVersion: '38.8.6',
    rg: '14.1.1',
    fd: '10.1.0',
    pandoc: '3.10',
    lockHash: 'a1b2c3d4e5f67890abcdef',
  })
  assert.equal(v.appVersion, '0.2.0')
  assert.equal(v.depsVersion, 'a1b2c3d4e5f6')
  assert.equal(v.baselineVersion, 'e38.8.6_p3.10_r14.1.1_f10.1.0')
})

test('computeVersions: lockHash 不足 12 位时取全部', () => {
  const v = computeVersions({
    appVersion: '0.1.0',
    electronVersion: '38.0.0',
    rg: '14.0.0',
    fd: '10.0.0',
    pandoc: '3.0',
    lockHash: 'short',
  })
  assert.equal(v.depsVersion, 'short')
})

test('collectCodePatchEntries: 返回 4 处路径(app/dist + @z-wiki/server + web/dist + package.json)', () => {
  const res = '/fake/unpacked/resources'
  const entries = collectCodePatchEntries(res)
  assert.equal(entries.length, 4)
  assert.deepEqual(
    entries.map((e) => e.dest).sort(),
    ['app/dist', 'app/node_modules/@z-wiki/server', 'app/package.json', 'web/dist'].sort(),
  )
  for (const e of entries) {
    assert.ok(e.src.startsWith(res), `${e.src} 应以 resources 开头`)
  }
})

test('buildManifest: 生成 latest.json 结构(三版本号 + code 条目)', () => {
  const manifest = buildManifest(
    {
      appVersion: '0.2.0',
      depsVersion: 'a1b2c3d4e5f6',
      baselineVersion: 'e38.8.6_p3.10_r14.1.1_f10.1.0',
    },
    {
      url: 'https://release/z-wiki-code-0.2.0.tar.gz',
      sha512: 'abc',
      size: 5000000,
    },
  )
  assert.equal(manifest.appVersion, '0.2.0')
  assert.equal(manifest.depsVersion, 'a1b2c3d4e5f6')
  assert.equal(manifest.baselineVersion, 'e38.8.6_p3.10_r14.1.1_f10.1.0')
  assert.equal(manifest.packages.code?.url, 'https://release/z-wiki-code-0.2.0.tar.gz')
  assert.equal(manifest.packages.code?.sha512, 'abc')
  assert.equal(manifest.packages.code?.size, 5000000)
  // 不传 appPackage -> app undefined
  assert.equal(manifest.packages.app, undefined)
  assert.equal(manifest.packages.full, undefined)
})

test('collectAppBundleEntries: 返回 app + web/dist', () => {
  const res = '/fake/unpacked/resources'
  const entries = collectAppBundleEntries(res)
  assert.equal(entries.length, 2)
  assert.deepEqual(entries.map((e) => e.dest).sort(), ['app', 'web/dist'])
  for (const e of entries) {
    assert.ok(e.src.startsWith(res), `${e.src} 应以 resources 开头`)
  }
})

test('buildManifest: 含 app 条目(传 appPackage)', () => {
  const manifest = buildManifest(
    {
      appVersion: '0.2.0',
      depsVersion: 'a1b2c3d4e5f6',
      baselineVersion: 'e38.8.6_p3.10_r14.1.1_f10.1.0',
    },
    { url: 'code-url', sha512: 'code-sha', size: 5000000 },
    { url: 'app-url', sha512: 'app-sha', size: 45000000 },
  )
  assert.equal(manifest.packages.code?.url, 'code-url')
  assert.equal(manifest.packages.app?.url, 'app-url')
  assert.equal(manifest.packages.app?.sha512, 'app-sha')
  assert.equal(manifest.packages.app?.size, 45000000)
  assert.equal(manifest.packages.full, undefined)
})

test('buildManifest: 含 full 按平台 map(传 fullPackages)', () => {
  const full = {
    'mac-arm64': { url: 'z-wiki-0.2.0-mac-arm64.dmg', sha512: 'mac-sha', size: 210000000 },
    'win-x64': { url: 'z-wiki-0.2.0-win-x64.exe', sha512: 'win-sha', size: 200000000 },
  }
  const manifest = buildManifest(
    {
      appVersion: '0.2.0',
      depsVersion: 'a1b2c3d4e5f6',
      baselineVersion: 'e38.8.6_p3.10_r14.1.1_f10.1.0',
    },
    { url: 'code-url', sha512: 'code-sha', size: 5000000 },
    { url: 'app-url', sha512: 'app-sha', size: 45000000 },
    full,
  )
  assert.deepEqual(manifest.packages.full, full)
})

test('collectFullPackages: 按命名收当前版本完整包,排 zip/blockmap/旧命名/旧版本', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-release-'))
  try {
    // 应收的(当前版本 0.2.0,新命名,dmg/exe/AppImage)
    const keep = [
      'z-wiki-0.2.0-mac-arm64.dmg',
      'z-wiki-0.2.0-mac-x64.dmg',
      'z-wiki-0.2.0-win-x64.exe',
      'z-wiki-0.2.0-linux-x64.AppImage',
    ]
    // 应排的:zip 便携 / blockmap / 旧版本 / 旧命名(无 os 段/异前缀)/ 同名目录
    const drop = [
      'z-wiki-0.2.0-win-x64.zip',
      'z-wiki-0.2.0-mac-arm64.dmg.blockmap',
      'z-wiki-0.1.0-mac-arm64.dmg',
      'z-wiki-0.2.0-arm64.dmg',
      'zwiki-setup-0.2.0.exe',
    ]
    for (const f of [...keep, ...drop]) {
      await fs.writeFile(path.join(dir, f), `fake-${f}`)
    }
    await fs.mkdir(path.join(dir, 'z-wiki-0.2.0-linux-arm64.dmg')) // 目录不收

    const packages = collectFullPackages(dir, '0.2.0')
    assert.deepEqual(Object.keys(packages).sort(), ['linux-x64', 'mac-arm64', 'mac-x64', 'win-x64'])
    // url = 相对文件名(与 code/app 包一致),sha512/size 与文件内容匹配
    const dmg = packages['mac-arm64']
    assert.equal(dmg.url, 'z-wiki-0.2.0-mac-arm64.dmg')
    const content = await fs.readFile(path.join(dir, 'z-wiki-0.2.0-mac-arm64.dmg'))
    assert.equal(dmg.sha512, createHash('sha512').update(content).digest('hex'))
    assert.equal(dmg.size, content.length)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('collectFullPackages: releaseDir 不存在 -> 空 map', () => {
  assert.deepEqual(collectFullPackages('/no/such/dir', '0.2.0'), {})
})
