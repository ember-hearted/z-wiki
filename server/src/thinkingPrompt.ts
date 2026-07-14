// 思考语言约束 extension(ADR-0012):思考模式开启时,把 KB_THINKING_LANG_PROMPT
// 追加到该轮 system prompt;off 时不注入(无 thinking token 作用对象,段A 已约束输出语言)。
//
// 为什么用 before_agent_start 而非 appendSystemPrompt:appendSystemPrompt 是 resourceLoader
// 级、共享、buildAgentContext 时定死,拿不到 session 级 thinkingLevel;而思考模式状态是
// session 级的(setThinkingLevel 改单个 session)。before_agent_start 每轮触发,此时
// pi.getThinkingLevel() 已反映最新切换,故无状态读 level 即可。段B 与思考模式切换通过
// pi 事件闭环(需求3 setThinkingLevel -> 下一轮 before_agent_start 读新 level),无需 z-wiki 自己同步状态。
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { KB_OUTPUT_LANG_PROMPT, KB_THINKING_LANG_PROMPT } from './prompt.js'

// 诊断日志末尾预览长度:够看到段B 标签块全文 + 前置 date/cwd 上下文。
const TAIL_PREVIEW_LEN = 160

/** 思考语言注入 extension:仅当 thinkingLevel !== 'off' 时追加段B 到该轮 systemPrompt。 */
export const thinkingPromptFactory: ExtensionFactory = (pi) => {
  pi.on('before_agent_start', async (event) => {
    const level = pi.getThinkingLevel()
    const injectB = level !== 'off'
    // 诊断日志:验证段A(loader 注入,应在 event.systemPrompt)+ 段B(本 handler 追加)。
    // off 时段B 不注入,但段A 应仍在--两种状态都打,便于排查"语言约束没生效"是不是注入问题。
    const hasA = event.systemPrompt.includes(KB_OUTPUT_LANG_PROMPT)
    const base = `[z-wiki] before_agent_start: thinkingLevel=${level} 段A=${hasA ? 'in' : 'MISSING'} 段B=`
    if (injectB) {
      const merged = `${event.systemPrompt}\n\n${KB_THINKING_LANG_PROMPT}`
      console.warn(
        `${base}injecting systemPromptLen=${merged.length} 末尾="${merged.slice(-TAIL_PREVIEW_LEN)}"`,
      )
      return { systemPrompt: merged }
    }
    console.warn(
      `${base}skipped(off) systemPromptLen=${event.systemPrompt.length} 末尾="${event.systemPrompt.slice(-TAIL_PREVIEW_LEN)}"`,
    )
  })
}
