/**
 * postinstall.mjs — 修复 npm 无法自动升级的深层传递依赖漏洞。
 *
 * 背景: brace-expansion@5.0.6 和 protobufjs@7.6.4 作为 pi-coding-agent
 * 的嵌套依赖存在漏洞，npm overrides 因多个 major 版本共存无法直接覆盖。
 * 此脚本将嵌套的脆弱版本替换为已 hoist 的安全版本。
 *
 * 安全: 仅替换同 major 版本的补丁升级(5.0.6→5.0.7, 7.6.4→7.6.5)，
 * 不涉及 API 破坏性变更。替换前验证源目录存在。
 */
import { cp, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// 脆弱包修复映射: { 嵌套路径 → 安全版本的 hoist 路径 }
const FIXES = [
  {
    pkg: 'brace-expansion',
    vulnerable: '5.0.6',
    safe: '5.0.7',
    nested: path.join(ROOT, 'node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion'),
    hoisted: path.join(ROOT, 'node_modules/brace-expansion'),
  },
  {
    pkg: 'protobufjs',
    vulnerable: '7.6.4',
    safe: '7.6.5',
    nested: path.join(ROOT, 'node_modules/@earendil-works/pi-coding-agent/node_modules/protobufjs'),
    hoisted: path.join(ROOT, 'node_modules/protobufjs'),
  },
]

async function main() {
  for (const fix of FIXES) {
    // 检查嵌套版本是否为脆弱版本
    if (!existsSync(path.join(fix.nested, 'package.json'))) {
      console.log(`[postinstall] ${fix.pkg}: nested not found, skipping`)
      continue
    }
    const nestedPkg = JSON.parse(await readFile(path.join(fix.nested, 'package.json'), 'utf-8'))
    if (nestedPkg.version !== fix.vulnerable) {
      console.log(`[postinstall] ${fix.pkg}: nested v${nestedPkg.version} not vulnerable, skipping`)
      continue
    }

    // 确认 hoist 的安全版本存在
    if (!existsSync(path.join(fix.hoisted, 'package.json'))) {
      console.log(`[postinstall] ${fix.pkg}: hoisted safe version not found at ${fix.hoisted}, skipping`)
      continue
    }
    const hoistedPkg = JSON.parse(await readFile(path.join(fix.hoisted, 'package.json'), 'utf-8'))
    if (hoistedPkg.version !== fix.safe) {
      console.log(`[postinstall] ${fix.pkg}: hoisted version is ${hoistedPkg.version}, expected ${fix.safe}, skipping`)
      continue
    }

    // 替换嵌套版本为 hoist 的安全版本
    await cp(fix.hoisted, fix.nested, { recursive: true, force: true })
    console.log(`[postinstall] ${fix.pkg}: v${fix.vulnerable} → v${fix.safe} (patched)`)
  }
}

main().catch((err) => {
  console.error('[postinstall] failed:', err)
  process.exit(1)
})
