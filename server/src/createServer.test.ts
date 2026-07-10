import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createServer } from './index.js'

// 集成测试 createServer:用 app.inject()(不起真实端口)验证 HTTP 行为。
// 关掉 pino-pretty transport(NODE_ENV=production)与日志噪音(LOG_LEVEL=error),
// 避免 transport worker 线程拖慢/挂起 node:test 进程。
process.env.NODE_ENV = 'production'
process.env.LOG_LEVEL = 'error'

// 最小 config.json fixture:buildAgentContext 从此生成 models.json + 注入 apiKey(ADR-0003 D3.1)。
// 火山 ark 齐配置(新 schema:baseUrl/api/model;切片 1 干掉 provider 预设后不再用 provider 字段)。
const CONFIG_JSON = {
  apiKey: 'test-key',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
  api: 'anthropic-messages',
  model: 'ark-code-latest',
}

interface Vault {
  kbRoot: string
  agentDir: string
  root: string
}

// 构造临时 vault:kb/wiki/<file> + .pi/agent/models.json。
async function makeVault(wikiFiles: Record<string, string>): Promise<Vault> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-srv-'))
  const kbRoot = path.join(root, 'kb')
  const agentDir = path.join(root, '.pi/agent')
  await fs.mkdir(kbRoot, { recursive: true })
  for (const [rel, content] of Object.entries(wikiFiles)) {
    const abs = path.join(kbRoot, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf-8')
  }
  await fs.mkdir(agentDir, { recursive: true })
  // config.json 落在 appRoot(= root,agentDir 上两级),buildAgentContext 从此读取并生成 agentDir/models.json。
  await fs.writeFile(path.join(root, 'config.json'), JSON.stringify(CONFIG_JSON), 'utf-8')
  return { kbRoot, agentDir, root }
}

test('createServer: /api/health 返回 ok', async () => {
  const vault = await makeVault({})
  const interaction = await createServer({ kbRoot: vault.kbRoot, agentDir: vault.agentDir })
  try {
    const res = await interaction.app.inject({ method: 'GET', url: '/api/health' })
    assert.equal(res.statusCode, 200)
    assert.equal((res.json() as { ok: boolean }).ok, true)
  } finally {
    await interaction.app.close()
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

test('createServer: /api/pages 返回指定 vault 的内容(wiki 全显,排除 00-知识库导航,ADR-0010)', async () => {
  const vault = await makeVault({
    'wiki/00-知识库导航.md': '# 知识库导航\n\n导航页\n',
    'wiki/01-foo.md': '---\nview: true\n---\n# Foo\n\n正文\n',
    'wiki/02-bar.md': '---\nview: false\n---\n# Bar\n\nx\n',
  })
  const interaction = await createServer({ kbRoot: vault.kbRoot, agentDir: vault.agentDir })
  try {
    const res = await interaction.app.inject({ method: 'GET', url: '/api/pages' })
    assert.equal(res.statusCode, 200)
    const stems = new Set((res.json() as Array<{ stem: string }>).map((p) => p.stem))
    assert.ok(stems.has('01-foo'), '普通 wiki 全显(原 view:true)')
    assert.ok(stems.has('02-bar'), '普通 wiki 全显(原 view:false 不再隐藏)')
    assert.ok(!stems.has('00-知识库导航'), '导航页排除')
  } finally {
    await interaction.app.close()
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

test('createServer: 路径参数生效——不同 vault 返回不同内容', async () => {
  const vaultA = await makeVault({ 'wiki/01-aaa.md': '---\nview: true\n---\n# AAA\n\nx\n' })
  const vaultB = await makeVault({ 'wiki/01-bbb.md': '---\nview: true\n---\n# BBB\n\nx\n' })
  try {
    const a = await createServer({ kbRoot: vaultA.kbRoot, agentDir: vaultA.agentDir })
    const b = await createServer({ kbRoot: vaultB.kbRoot, agentDir: vaultB.agentDir })
    try {
      const [resA, resB] = await Promise.all([
        a.app.inject({ method: 'GET', url: '/api/pages' }),
        b.app.inject({ method: 'GET', url: '/api/pages' }),
      ])
      const stemsA = new Set((resA.json() as Array<{ stem: string }>).map((p) => p.stem))
      const stemsB = new Set((resB.json() as Array<{ stem: string }>).map((p) => p.stem))
      assert.ok(stemsA.has('01-aaa') && !stemsA.has('01-bbb'), 'vault A 应只含 01-aaa')
      assert.ok(stemsB.has('01-bbb') && !stemsB.has('01-aaa'), 'vault B 应只含 01-bbb')
    } finally {
      await Promise.all([a.app.close(), b.app.close()])
    }
  } finally {
    await Promise.all([
      fs.rm(vaultA.root, { recursive: true, force: true }),
      fs.rm(vaultB.root, { recursive: true, force: true }),
    ])
  }
})

// webDistPath 提供时,@fastify/static 同端口 serve 前端构建产物(ADR-0003 D2.1)。
test('createServer: webDistPath 提供时,GET / 返回 index.html,SPA 路由回退 index.html', async () => {
  const vault = await makeVault({})
  // 造一个最小 web/dist:含 index.html 与一个静态资源
  const webDist = path.join(vault.root, 'web/dist')
  await fs.mkdir(webDist, { recursive: true })
  await fs.writeFile(path.join(webDist, 'index.html'), '<!doctype html><body>SPA</body>', 'utf-8')
  await fs.writeFile(path.join(webDist, 'favicon.ico'), 'ICON', 'utf-8')
  const interaction = await createServer({
    kbRoot: vault.kbRoot,
    agentDir: vault.agentDir,
    webDistPath: webDist,
  })
  try {
    const root = await interaction.app.inject({ method: 'GET', url: '/' })
    assert.equal(root.statusCode, 200)
    assert.match(root.body, /SPA/)

    // 已存在的静态资源直接返回
    const ico = await interaction.app.inject({ method: 'GET', url: '/favicon.ico' })
    assert.equal(ico.statusCode, 200)

    // SPA 路由(/pages/01-foo 无对应文件)回退到 index.html,交前端路由
    const spa = await interaction.app.inject({ method: 'GET', url: '/pages/01-foo' })
    assert.equal(spa.statusCode, 200)
    assert.match(spa.body, /SPA/)

    // /api 未知路由仍返回 JSON 404,不被吞成 index.html
    const api404 = await interaction.app.inject({ method: 'GET', url: '/api/nonexistent' })
    assert.equal(api404.statusCode, 404)
    assert.equal((api404.json() as { error: string }).error, 'not found')
  } finally {
    await interaction.app.close()
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

// webDistPath 省略时(dev 形态),/ 仍返回文本占位,不受静态托管影响。
test('createServer: webDistPath 省略时,/ 返回 dev 占位文本', async () => {
  const vault = await makeVault({})
  const interaction = await createServer({ kbRoot: vault.kbRoot, agentDir: vault.agentDir })
  try {
    const res = await interaction.app.inject({ method: 'GET', url: '/' })
    assert.equal(res.statusCode, 200)
    assert.match(res.body, /vite dev server/)
  } finally {
    await interaction.app.close()
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})
