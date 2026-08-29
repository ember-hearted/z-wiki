#!/usr/bin/env node
// bin —— z-wiki-web CLI。聚合包入口:复用打包后的 server `startServer()`,传包根。
// npm install 后位于 node_modules/@ember-hearted/z-wiki/bin/z-wiki-web.js。
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../dist/index.js'

// 包根 = bin/ 上一级。web/dist 与 kb_example 都相对包根。
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 默认用户可写数据根:未设 ZWIKI_HOME 且无桌面数据目录时,落到 ~/.z-wiki,避免包安装目录可能只读。
const defaultDataRoot = process.env.ZWIKI_HOME?.trim()
  ? undefined
  : path.join(os.homedir(), '.z-wiki')
await startServer({ projectRoot: pkgRoot, defaultDataRoot })
