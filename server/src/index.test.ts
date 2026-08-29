import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { dataRootFor, desktopUserDataDir, shouldOpenBrowser } from './index.js'

// 跨平台断言:用 path.join 构建期望路径,避免 Windows(\ ) / POSIX(/ ) 分隔符差异。
const join = path.join

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

// ── desktopUserDataDir:复刻 Electron app.getPath('userData') 在 z-wiki 名下的跨平台映射 ──
test('desktopUserDataDir: win32 用 APPDATA/z-wiki', () => {
  assert.equal(
    desktopUserDataDir('win32', { APPDATA: join('C:\\Users\\u\\AppData\\Roaming') }),
    join('C:\\Users\\u\\AppData\\Roaming', 'z-wiki'),
  )
})

test('desktopUserDataDir: darwin 用 HOME/Library/Application Support/z-wiki', () => {
  assert.equal(
    desktopUserDataDir('darwin', { HOME: '/Users/u' }),
    join('/Users/u', 'Library', 'Application Support', 'z-wiki'),
  )
})

test('desktopUserDataDir: linux 用 HOME/.config/z-wiki', () => {
  assert.equal(
    desktopUserDataDir('linux', { HOME: '/home/u' }),
    join('/home/u', '.config', 'z-wiki'),
  )
})

test('desktopUserDataDir: win32 缺 APPDATA 返回空串', () => {
  assert.equal(desktopUserDataDir('win32', {}), '')
})

// ── dataRootFor(env, platform, projectRoot, exists) ──
// exists 是注入的路径存在性谓词;用 path.join 构造"存在"的目录,隔离真实 fs 并适配分隔符。
const desktopWin = join('C:\\Users\\u\\AppData\\Roaming', 'z-wiki')
const desktopLinux = join('/home/u', '.config', 'z-wiki')
const exists = (p: string): boolean => p === desktopWin || p === desktopLinux

test('dataRootFor: ZWIKI_HOME 显式设置则用它(覆盖一切)', () => {
  assert.equal(dataRootFor({ ZWIKI_HOME: '/data' }, 'win32', '/proj', exists), '/data')
})

test('dataRootFor: 桌面目录存在则自动用它', () => {
  assert.equal(
    dataRootFor({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32', '/proj', exists),
    desktopWin,
  )
})

test('dataRootFor: 桌面目录不存在则回退 projectRoot', () => {
  assert.equal(dataRootFor({ HOME: '/empty-home' }, 'linux', '/proj', exists), '/proj')
})

test('dataRootFor: 空串 ZWIKI_HOME 视为未设,走探测', () => {
  // 桌面存在 -> 用桌面
  assert.equal(
    dataRootFor({ ZWIKI_HOME: '', HOME: '/home/u' }, 'linux', '/proj', exists),
    desktopLinux,
  )
})
