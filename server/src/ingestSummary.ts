// ingestSummary.ts - 编译小结收集(Interaction sibling helper,同 ingestPrompt.ts 模式)。
// 从 pi 事件流提取 agent 的收尾文本:只保留最后一条 assistant 消息的 text_delta 拼接,
// 中间轮的过渡文本(如"我先读取文件")随新 message_start 丢弃(ADR-0024)。
// 收集结果经 ingest_done 广播给 layer2 展示;同时作 /api/ingest 的 response 返回给 a2a 调用方。

/** pi 事件的最小形状(收集只看这几个字段,其余忽略)。 */
interface ClosingEvent {
  type: string
  message?: { role?: string }
  assistantMessageEvent?: { type: string; delta?: string }
}

/**
 * 创建编译小结收集器:onEvent 喂 pi 事件,text() 取当前收集到的收尾文本。
 * agent 未产出文本(全程只调工具)时 text() 为 '',调用方回退静态模板。
 */
export function collectClosingText(): { onEvent: (event: unknown) => void; text: () => string } {
  let buf = ''
  return {
    onEvent: (event: unknown) => {
      const e = event as ClosingEvent
      // 新 assistant 消息开始 -> 丢弃上一轮过渡文本,只留收尾消息
      if (e.type === 'message_start' && e.message?.role === 'assistant') {
        buf = ''
        return
      }
      if (
        e.type === 'message_update' &&
        e.assistantMessageEvent?.type === 'text_delta' &&
        e.assistantMessageEvent.delta
      ) {
        buf += e.assistantMessageEvent.delta
      }
    },
    text: () => buf,
  }
}
