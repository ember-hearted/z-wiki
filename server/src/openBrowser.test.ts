import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserOpenCommand } from './openBrowser.js'

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
