// server/src/dirPicker.test.ts

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { buildCrumbs, listDirectory, validateDirName, validateDirPath } from './dirPicker.js'

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
