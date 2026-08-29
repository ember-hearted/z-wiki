import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dataRootFor, shouldOpenBrowser } from './index.js'

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

test('dataRootFor: 缺省(env 无 ZWIKI_HOME)回退 projectRoot', () => {
  assert.equal(dataRootFor({}, '/proj'), '/proj')
})

test('dataRootFor: 显式 ZWIKI_HOME 覆盖 projectRoot', () => {
  assert.equal(dataRootFor({ ZWIKI_HOME: '/data' }, '/proj'), '/data')
})

test('dataRootFor: 空串 ZWIKI_HOME 视为未设,回退 projectRoot', () => {
  assert.equal(dataRootFor({ ZWIKI_HOME: '' }, '/proj'), '/proj')
})
