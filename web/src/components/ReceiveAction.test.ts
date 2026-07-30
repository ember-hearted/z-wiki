// 收件提示词(ADR-0026):buildReceivePrompt 纯函数契约——
// {port} 替换为运行时端口、三段结构完整、发信关键规则在场。

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildReceivePrompt } from './ReceiveAction.js'

test('buildReceivePrompt: {port} 全部替换为运行时端口', () => {
  const p = buildReceivePrompt('51234')
  assert.ok(p.includes('http://localhost:51234/api/ingest'))
  assert.ok(!p.includes('{port}'))
})

test('buildReceivePrompt: 提示词三段结构 + 末尾粘贴位', () => {
  const p = buildReceivePrompt('3000')
  assert.ok(p.includes('## 怎么投递'))
  assert.ok(p.includes('## 规则'))
  assert.ok(p.includes('## 要投递的内容'))
  // 末尾是内容粘贴位,与用户随后粘贴的内容拼成连贯指令
  assert.ok(p.trimEnd().endsWith('(在这行下面粘贴)'))
})

test('buildReceivePrompt: 发信关键规则在场(原样投递/转告小结/失败话术)', () => {
  const p = buildReceivePrompt('3000')
  assert.ok(p.includes('原样发送,不要总结、不要改写、不要补标题'))
  assert.ok(p.includes('response 字段原样转告我'))
  assert.ok(p.includes('返回 403'))
  assert.ok(p.includes('不要编造已发送'))
})
