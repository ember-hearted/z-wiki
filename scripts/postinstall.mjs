/**
 * postinstall.mjs — 修复 pi-coding-agent 内置 shrinkwrap 钉死的传递依赖漏洞。
 *
 * 根因: @earendil-works/pi-coding-agent 发布时把 npm-shrinkwrap.json 打进 tarball
 * (140 条传递依赖钉死,含 brace-expansion@5.0.6 / protobufjs@7.6.4)。
 * npm overrides 对 shrinkwrap 物化的子树不生效(实测:同一条 minimatch→brace-expansion
 * ^5.0.5 依赖边,非 shrinkwrap 引用点被 overrides 钉到 5.0.8,该子树仍复活 5.0.6)。
 * 此脚本在 install 后把嵌套脆弱版本物理覆写为安全版本。
 *
 * 安全: 仅替换同 major 的补丁升级(5.0.6→5.0.8, 7.6.4→7.6.5),无 API 破坏性变更。
 * 覆写前验证嵌套版本确为脆弱版、源目录版本确为安全版;pi-coding-agent 升级后
 * 若 shrinkwrap 钉的版本变化,按 vulnerable 匹配自动跳过(打印日志),需人工复核。
 */

import { existsSync } from 'node:fs'
import { cp, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// 脆弱包修复映射。sources 为覆写源候选(非 shrinkwrap 引用点由根 overrides 钉到 safe,
// 物理位置随 hoist 情况变化,取第一个版本命中 safe 的)
const FIXES = [
  {
    pkg: 'brace-expansion',
    vulnerable: '5.0.6',
    safe: '5.0.8',
    nested: path.join(
      ROOT,
      'node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion',
    ),
    sources: [
      path.join(ROOT, 'node_modules/minimatch/node_modules/brace-expansion'),
      path.join(ROOT, 'node_modules/brace-expansion'),
    ],
  },
  {
    pkg: 'protobufjs',
    vulnerable: '7.6.4',
    safe: '7.6.5',
    nested: path.join(ROOT, 'node_modules/@earendil-works/pi-coding-agent/node_modules/protobufjs'),
    sources: [path.join(ROOT, 'node_modules/protobufjs')],
  },
]

/** 在候选源里找版本确为 safe 的目录,找不到返回 null。 */
async function findSafeSource(fix) {
  for (const src of fix.sources) {
    if (!existsSync(path.join(src, 'package.json'))) continue
    const pkg = JSON.parse(await readFile(path.join(src, 'package.json'), 'utf-8'))
    if (pkg.version === fix.safe) return src
  }
  return null
}

async function main() {
  for (const fix of FIXES) {
    // 检查嵌套版本是否为脆弱版本
    if (!existsSync(path.join(fix.nested, 'package.json'))) {
      console.log(`[postinstall] ${fix.pkg}: nested not found, skipping`)
      continue
    }
    const nestedPkg = JSON.parse(await readFile(path.join(fix.nested, 'package.json'), 'utf-8'))
    if (nestedPkg.version === fix.safe) {
      console.log(`[postinstall] ${fix.pkg}: nested already v${fix.safe}, skipping`)
      continue
    }
    if (nestedPkg.version !== fix.vulnerable) {
      console.log(`[postinstall] ${fix.pkg}: nested v${nestedPkg.version} not vulnerable, skipping`)
      continue
    }

    const source = await findSafeSource(fix)
    if (!source) {
      console.log(`[postinstall] ${fix.pkg}: no safe source v${fix.safe} found, skipping`)
      continue
    }

    // 替换嵌套版本为安全版本
    await cp(source, fix.nested, { recursive: true, force: true })
    console.log(`[postinstall] ${fix.pkg}: v${fix.vulnerable} → v${fix.safe} (patched)`)
  }
}

main().catch((err) => {
  console.error('[postinstall] failed:', err)
  process.exit(1)
})
