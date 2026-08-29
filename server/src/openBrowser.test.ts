import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserOpenCommand, openBrowser } from './openBrowser.js'

test('browserOpenCommand: win32 用 cmd /c start', () => {
  assert.deepEqual(browserOpenCommand('win32', 'http://127.0.0.1:3000/'), [
    'cmd',
    '/c',
    'start',
    '',
    'http://127.0.0.1:3000/',
  ])
})

test('browserOpenCommand: darwin 用 open', () => {
  assert.deepEqual(browserOpenCommand('darwin', 'http://127.0.0.1:3000/'), [
    'open',
    'http://127.0.0.1:3000/',
  ])
})

test('browserOpenCommand: linux 用 xdg-open', () => {
  assert.deepEqual(browserOpenCommand('linux', 'http://127.0.0.1:3000/'), [
    'xdg-open',
    'http://127.0.0.1:3000/',
  ])
})

// openBrowser:非法 URL 应 resolve(false) 且永不 reject(webui 不应因打不开浏览器而崩)。
// 真实 spawn 的 'error'/'spawn' 路径依赖真实系统进程,不在单测中触发(会真的开浏览器/依赖系统命令),
// 以非法 URL 分支作为行为覆盖:它走到 URL 校验直接返回 false,不触发 spawn。
test('openBrowser: 返回 Promise 且非法 URL 解析为 false', async () => {
  const p = openBrowser('not a url')
  assert.ok(p instanceof Promise)
  assert.equal(await p, false)
})
