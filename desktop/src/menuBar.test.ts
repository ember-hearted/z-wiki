import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldAutoHideMenuBar } from './menuBar.js'

// 回归:linux 桌面版菜单栏曾常驻(main.ts 只给 win32 开 autoHideMenuBar,漏了 linux)。
test('shouldAutoHideMenuBar: win32/linux 隐藏(Alt 可呼出),darwin 不处理', () => {
  assert.equal(shouldAutoHideMenuBar('win32'), true)
  assert.equal(shouldAutoHideMenuBar('linux'), true)
  assert.equal(shouldAutoHideMenuBar('darwin'), false)
})
