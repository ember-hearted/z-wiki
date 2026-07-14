// 开发模式 patch:把 node_modules/electron/dist/Electron.app 的
// CFBundleName/CFBundleDisplayName 从 "Electron" 改为 "z-wiki",
// 让 macOS Mission Control/Dock/应用切换器显示 z-wiki。
//
// 原因:app.setName() 只改应用菜单,不影响 OS 读取的 bundle 名
// (Electron 文档明确:"it does not affect the name that the OS uses")。
// macOS 的 NSRunningApplication.localizedName 取自 bundle Info.plist,
// 故必须改 Electron.app 的 Info.plist。打包后由 electron-builder 的 Info.plist 接管。
//
// 副作用 1:npm i 重装 electron 会还原为 "Electron",需重跑(已集成进 npm run desktop)。
// 副作用 2:plutil 改 Info.plist 会破坏代码签名(sealed resource),macOS 对签名失效的 app
//   不分配输入法(TSM)上下文 -> 中文输入法切不出/composition 事件不触发。
//   故改名后必须 codesign --force 重新 ad-hoc 签名;幂等检查也含签名,签名失效时重签。
// 回退:npm rebuild electron 或 rm -rf node_modules/electron && npm i。
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

// 非 macOS 无需 patch(Windows/Linux 应用名走 app.setName + 图标)。
if (process.platform !== 'darwin') process.exit(0)

const APP_NAME = 'z-wiki'

// require('electron') 返回 Electron 二进制文件路径:
// .../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
const require = createRequire(import.meta.url)
const electronBin = require('electron')
// 二进制是文件不是目录,不能用字符串拼接 ".."(existsSync 不解析 ..,会 ENOTDIR),用 path.resolve 规范化。
const plistPath = path.resolve(electronBin, '../../Info.plist')
const appPath = path.resolve(plistPath, '../..')
if (!existsSync(plistPath)) {
  console.warn('[patch-electron-name] Info.plist not found, skip')
  process.exit(0)
}

const readKey = (key) => {
  try {
    return execFileSync('defaults', ['read', plistPath, key], { encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

// 签名校验:codesign --verify 退出码非 0 视为失效。
const isSignValid = () => {
  try {
    execFileSync('codesign', ['--verify', appPath], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// 幂等:名已是目标名 且 签名有效 才跳过。签名也纳入检查--plutil 改名会破签,
// 若上次 patch 后签名又被破坏(重装/手改),需重签恢复 IME,不能仅凭名一致就跳过。
const nameOk = readKey('CFBundleName') === APP_NAME && readKey('CFBundleDisplayName') === APP_NAME
if (nameOk && isSignValid()) {
  process.exit(0)
}

if (!nameOk) {
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    execFileSync('plutil', ['-replace', key, '-string', APP_NAME, plistPath], { stdio: 'inherit' })
  }
  console.log(`[patch-electron-name] CFBundleName/CFBundleDisplayName -> "${APP_NAME}"`)
}

// 改名破签 或 签名本就失效:重新 ad-hoc 签名恢复 macOS IME 输入上下文。
// --deep 递归签 Electron Helper (Renderer/GPU).app 等子 bundle。
execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
console.log('[patch-electron-name] re-signed (ad-hoc) to restore macOS IME context')
