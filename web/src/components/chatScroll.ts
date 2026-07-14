/** 对话区是否应滚到底:新消息增长 / 流式中跟随 delta / 流结束收尾 -> 滚;
 *  toggle 思维链胶囊(数量不变、非流式)等不滚。
 *
 *  抽纯函数以便测试--滚动 effect 的 DOM scrollTo 副作用本身难单元测试,
 *  把判断逻辑剥离出来覆盖 toggle 回归。 */
export function shouldScrollToBottom(
  prevLen: number,
  nextLen: number,
  prevStreaming: boolean,
  nextStreaming: boolean,
): boolean {
  return nextLen > prevLen || nextStreaming || (prevStreaming && !nextStreaming)
}
