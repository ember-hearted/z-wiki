// ingestPrompt.ts - ingest 触发 prompt 构造(Interaction sibling helper)。
// 从 interaction.ts 的 runIngest 闭包外提为 buildIngestPrompt(rawName) 纯函数,可单测。
//
// 这是 Interaction 调起 agent 做 ingest 的"命令模板"(per-file user-turn 指令,经 session.prompt 发),
// 不是 layer1 契约 -- 真正的 layer1 编译契约是 §1 编译规则(定义在 KB_SYSTEM_PROMPT,经 resourceLoader
// 注入 system prompt,ingest/query 都用)。此处仅按 rawName 后缀选读法 + 给 7 步流程指引引用 §1。
// 第 7 步是编译小结硬契约(ADR-0024):agent 收尾文本经 ingest_done 广播给 layer2 展示。
import path from 'node:path'
import { PLAINTEXT_EXTS } from './uploadExts.js'

/**
 * 构造 ingest 触发 prompt。
 *
 * 按 `rawName` 后缀选读法:md 或纯文本(.txt/.text/.log)-> 指示 read;其余(含无后缀、.markdown)-> 指示 pandoc 工具转文本。
 * rawName 由上传端点 sanitize 成 safeName(basename + 字符类清洗),此处不再校验,纯字符串构造。
 */
export function buildIngestPrompt(rawName: string): string {
  const ext = path.extname(rawName).toLowerCase()
  const isPlain = ext === '.md' || PLAINTEXT_EXTS.includes(ext)
  const readHint = isPlain
    ? `1. 读取 raw/${rawName} 内容`
    : `1. raw/${rawName} 是非 md 文件,用 pandoc 工具转文本读取:pandoc({ filePath: "raw/${rawName}" })`
  return [
    `已上传文件 raw/${rawName}。请按 Ingest 工作流处理:`,
    readHint,
    `2. 按 §1 编译规则判断是否编译为 wiki(若该主题已积累 ≥3 篇或单篇 >100 行有独立概念价值)`,
    `3. 若值得编译:创建/更新 wiki 文章(含 frontmatter view 字段、来源引用 [[raw/${rawName}]]、反向链接),更新 index.md`,
    `4. 若内容达到产出 output 的条件(如可形成对比分析/报告),可产出 output`,
    `5. 追加 log.md`,
    `6. 若判断不值得编译,简短说明并结束`,
    `7. 最后必须输出编译小结(一两句话,≤80 字):本次动作(新建/合并/更新/未编译)+ 涉及文件 + 一句话理由。wiki/output 文章用 [[NN-主题]] 引用(不带路径与 .md 后缀),raw 文件用纯文本路径。小结会作为系统通知直接展示给用户,之后的对话不再重复`,
  ].join('\n')
}
