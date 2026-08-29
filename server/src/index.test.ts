import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shouldOpenBrowser } from './index.js'

test('shouldOpenBrowser: 缺省(env 无 ZWIKI_OPEN_BROWSER)为真', () => {
  assert.equal(shouldOpenBrowser({}), true)
})

test('shouldOpenBrowser: 显式 1 为真', () => {
  assert.equal(shouldOpenBrowser({ ZWIKI_OPEN_BROWSER: '1' }), true)
})

test('shouldOpenBrowser: 显式 0/off 为假', () => {
  assert.equal(shouldOpenBrowser({ ZWIKI_OPEN_BROWSER: '0' }), false)
  assert.equal(shouldOpenBrowser({ ZWIKI_OPEN_BROWSER: 'off' }), false)
})
