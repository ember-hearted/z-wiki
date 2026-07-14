/** 将 pi 的 AgentSessionEvent 转成前端可消费的 WS 帧,推给 socket。
 *  纯函数(注入 socket + ctx):不依赖 chatSessions / serializeStats / triggerBuild,
 *  闭包外可单测。agent_end 的 stats 收集与 build 触发经 ctx 注入,使转发逻辑本身可测。
 *  ADR-0004 D8 第三环:thinking 事件(thinking_start/delta/end)转发给前端渲染思维链胶囊。 */

/** relayEvent 需要的 socket 接口:只依赖 send,测试可注入 mock。 */
export type RelaySocket = { send: (data: string) => void }

/** agent_end 的依赖注入:stats 收集 + build 触发(两者在 createInteraction 闭包内,故注入)。 */
export interface RelayCtx {
  /** 取当前 socket 对应 session 的累计 stats;无 session 时返回 undefined(退回裸 done)。 */
  getStats: (socket: RelaySocket) => unknown | undefined
  /** agent 写完 wiki/output 后触发 buildView 刷新,有变更推 kb_updated。 */
  triggerBuild: (socket: RelaySocket) => void
}

/** pi AgentSessionEvent 的最小形状(relayEvent 只看这几个字段,其余忽略)。 */
interface PiEvent {
  type: string
  // pi AssistantMessageEvent:text_delta/thinking_delta 用 delta;其余子事件字段 relayEvent 不读
  assistantMessageEvent?: { type: string; delta?: string }
  toolName?: string
  // read 的 args 形如 { file_path, offset?, limit? };其它工具各异,统一序列化
  args?: unknown
  isError?: boolean
}

/** 将 pi 事件转 WS 帧。
 *  message_update:text_delta -> text_delta 帧,thinking_start/delta/end -> thinking_* 帧;
 *  tool_execution_* -> tool_start/end;agent_end -> done(附 stats)+ 触发 build。 */
export function relayEvent(socket: RelaySocket, event: unknown, ctx: RelayCtx): void {
  const e = event as PiEvent
  switch (e.type) {
    case 'message_update': {
      const ae = e.assistantMessageEvent
      if (ae?.type === 'text_delta' && ae.delta) {
        socket.send(JSON.stringify({ type: 'text_delta', text: ae.delta }))
      } else if (ae?.type === 'thinking_start') {
        socket.send(JSON.stringify({ type: 'thinking_start' }))
      } else if (ae?.type === 'thinking_delta' && ae.delta) {
        // pi 的 thinking_delta.delta 映射为 WS 帧的 text(与前端 segment.text 字段对齐)
        socket.send(JSON.stringify({ type: 'thinking_delta', text: ae.delta }))
      } else if (ae?.type === 'thinking_end') {
        socket.send(JSON.stringify({ type: 'thinking_end' }))
      }
      break
    }
    case 'tool_execution_start':
      socket.send(JSON.stringify({ type: 'tool_start', tool: e.toolName, args: e.args }))
      break
    case 'tool_execution_end':
      socket.send(JSON.stringify({ type: 'tool_end', tool: e.toolName, error: Boolean(e.isError) }))
      break
    case 'agent_end': {
      // stats 缺失时退回裸 done,前端不更新 token 面板。
      const stats = ctx.getStats(socket)
      socket.send(JSON.stringify(stats ? { type: 'done', stats } : { type: 'done' }))
      // 闭环刷新:agent 写完 wiki/output 后自动 build,有变更推 kb_updated
      void ctx.triggerBuild(socket)
      break
    }
    default:
      break
  }
}
