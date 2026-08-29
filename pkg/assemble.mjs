// assemble.mjs —— 把 monorepo 的构建产物汇入本发布包(pkg/),供 npm pack/publish。
// 运行前提:已先 `npm run build`(server/dist 在 ../../server/dist、web/dist 在 ../../web/dist)。
// prepack 自动跑;也可 `cd pkg && npm run assemble` 手动汇入后再 pack。
import { cpSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const REPO_ROOT = path.resolve(PKG_ROOT, '..')

// 需汇入的源(相对仓库根)。server/dist 与 web/dist 均为 build 产物(已 gitignore)。
const SOURCES = [
  ['server/dist', 'dist'],
  ['web/dist', 'web/dist'],
  ['kb_example', 'kb_example'],
  ['LICENSE', 'LICENSE'],
]

// 先清空目标(避免残留),再整目录/文件拷贝。
for (const [src, dest] of SOURCES) {
  const from = path.join(REPO_ROOT, src)
  const to = path.join(PKG_ROOT, dest)
  if (!existsSync(from)) {
    console.error(`[assemble] 缺源:${from} —— 请先在仓库根跑 npm run build`)
    process.exit(1)
  }
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
}
console.log(`[assemble] 已汇入 ${SOURCES.length} 项到 ${PKG_ROOT}`)
