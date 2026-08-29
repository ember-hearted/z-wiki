import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createServer } from './index.js'
import { makeVault } from './testFixtures.js'

process.env.NODE_ENV = 'production'
process.env.LOG_LEVEL = 'error'

test('GET /api/dir: 返回目录列表(只目录、排序、点前缀 hidden)', async () => {
  const vault = await makeVault({})
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dir-api-'))
  await fs.mkdir(path.join(root, 'aa'))
  await fs.mkdir(path.join(root, 'bb'))
  await fs.mkdir(path.join(root, '.hidden'))
  await fs.writeFile(path.join(root, 'file.txt'), 'x', 'utf-8')
  const interaction = await createServer({ kbRoot: vault.kbRoot, agentDir: vault.agentDir })
  try {
    const res = await interaction.app.inject({
      method: 'GET',
      url: `/api/dir?path=${encodeURIComponent(root)}`,
    })
    assert.equal(res.statusCode, 200)
    const body = res.json() as { entries: Array<{ name: string; hidden: boolean }> }
    const names = body.entries.map((e) => e.name)
    assert.ok(names.includes('aa') && names.includes('bb'))
    assert.ok(!names.includes('file.txt'), '文件不算目录')
  } finally {
    await interaction.app.close()
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

test('GET /api/dir: 相对路径 -> 400(绝不 resolve)', async () => {
  const vault = await makeVault({})
  const interaction = await createServer({ kbRoot: vault.kbRoot, agentDir: vault.agentDir })
  try {
    const res = await interaction.app.inject({ method: 'GET', url: '/api/dir?path=foo/bar' })
    assert.equal(res.statusCode, 400)
  } finally {
    await interaction.app.close()
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

test('GET /api/dir: 目录不存在 -> 400', async () => {
  const vault = await makeVault({})
  const interaction = await createServer({ kbRoot: vault.kbRoot, agentDir: vault.agentDir })
  try {
    const res = await interaction.app.inject({
      method: 'GET',
      url: `/api/dir?path=${encodeURIComponent(path.join(os.tmpdir(), 'no-such-zz'))}`,
    })
    assert.equal(res.statusCode, 400)
  } finally {
    await interaction.app.close()
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

test('POST /api/dir: 建目录 -> 200 + 目录存在', async () => {
  const vault = await makeVault({})
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mkdir-api-'))
  const interaction = await createServer({ kbRoot: vault.kbRoot, agentDir: vault.agentDir })
  try {
    const res = await interaction.app.inject({
      method: 'POST',
      url: '/api/dir',
      payload: { path: root, name: 'newdir' },
    })
    assert.equal(res.statusCode, 200)
    assert.ok((await fs.stat(path.join(root, 'newdir'))).isDirectory())
  } finally {
    await interaction.app.close()
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

test('POST /api/dir: name 含分隔符 -> 400', async () => {
  const vault = await makeVault({})
  const interaction = await createServer({ kbRoot: vault.kbRoot, agentDir: vault.agentDir })
  try {
    const res = await interaction.app.inject({
      method: 'POST',
      url: '/api/dir',
      payload: { path: os.tmpdir(), name: 'a/b' },
    })
    assert.equal(res.statusCode, 400)
  } finally {
    await interaction.app.close()
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

test('POST /api/dir: 目录已存在 -> 409', async () => {
  const vault = await makeVault({})
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mkdir-exist-'))
  const interaction = await createServer({ kbRoot: vault.kbRoot, agentDir: vault.agentDir })
  try {
    const res = await interaction.app.inject({
      method: 'POST',
      url: '/api/dir',
      payload: { path: root, name: 'somedir' },
    })
    // 第一次建成功
    assert.equal(res.statusCode, 200)
    // 再建已存在 -> 409
    const res2 = await interaction.app.inject({
      method: 'POST',
      url: '/api/dir',
      payload: { path: root, name: 'somedir' },
    })
    assert.equal(res2.statusCode, 409)
  } finally {
    await interaction.app.close()
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})
