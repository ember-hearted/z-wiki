import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildDirUrl,
  type DirEntry,
  type DirListing,
  decodeDir,
  filterHidden,
  sanitizeLocationInput,
} from './dirApi.js'

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

test('sanitizeLocationInput: 合法绝对路径/盘符根放行(trim)', () => {
  assert.equal(sanitizeLocationInput('  D:\\  '), 'D:\\')
  assert.equal(sanitizeLocationInput('/a/b'), '/a/b')
  assert.equal(sanitizeLocationInput('C:\\Users'), 'C:\\Users')
})
test('sanitizeLocationInput: 空输入返回空串', () => {
  assert.equal(sanitizeLocationInput(''), '')
  assert.equal(sanitizeLocationInput('   '), '')
})
test('sanitizeLocationInput: 含 .. 段返回空串', () => {
  assert.equal(sanitizeLocationInput('/a/../b'), '')
})
