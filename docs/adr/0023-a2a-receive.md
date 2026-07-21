# ADR-0023: A2A 收件 — Agent-to-Agent 内容投递

- 状态:accepted
- 日期:2026-07-21
- 范围:layer2(web quickbar「收件」按钮 + A2A Modal)、layer3(server POST /api/ingest 守卫 + GET/POST /api/config/a2a + WS a2a_changed 广播)、config(preferences.a2aEnabled)
- 关联:ADR-0009(quickbar 快捷按钮模式)、ADR-0016(kb 路径沙箱,ingest 走 kbHooks)、ADR-0007(non-md 通过 pandoc 转)

## 背景

Issue #6 引入了 `POST /api/ingest` 端点,使外部 agent(Claude Code/Codex/PI 等)可以通过 HTTP 直接向 z-wiki 投递 Markdown 内容并触发 AI 编译。但有两个体验缺口:

1. **无通信控制**:谁有端口号就能往里塞内容。桌面版端口随机(ADR-0003 D2 `port: 0`),但内部网络无鉴权。
2. **无可见入口用户不知道有这个功能,外部 agent 不知道往哪个端口发请求。

同时,`/api/ingest` 原有的 `response` 字段写死「编译完成」,不携带来源信息,前端显示僵硬。

## 决策

### D1: 通信开关 + 服务端执行 + config 持久化

在 quickbar 加「收件」按钮,点击弹出 Modal,内含开关。

```
用户拨动开关
  → POST /api/config/a2a { enabled: boolean }
  → 写 config.preferences.a2aEnabled(updateConfig 串行写)
  → 广播 WS a2a_changed { enabled }
  → 后续 POST /api/ingest 检查本地变量 a2aEnabled
  → 关态返回 403,开态正常处理
```

- **双层控制**:前端 UI + 服务端执行。关态下直接拒掉请求,不依赖前端屏蔽。
- **config 持久化**:`preferences.a2aEnabled`(全局作用域,不随 vault 切换变化)。重启保留。
- **运行时状态**:`createInteraction` 时从 `initialCfg.preferences.a2aEnabled` 初始化本地 `let a2aEnabled` 变量,切换时更新变量并写 config,不重新读文件。

### D2: 端口保持随机,说明文档动态注入运行时 port

桌面版端口保持 `port: 0`(ADR-0003 D2),不改为固定端口。Modal 内的使用说明文档在渲染时通过 `window.location.port` 读取当前端口,动态替换 `{port}` 占位符。

**为什么保持随机**:固定端口可能与其他应用冲突;桌面形态无 Vite proxy,端口已由 Electron loadURL 承载,用户不直接接触端口号。

### D3: 说明文档始终显示,开关不触发布局变化

Modal 内的使用说明(接口地址、请求格式、curl 示例、参数说明)**始终在 DOM 中渲染**,开关仅控制是否发送 API 请求。切换开关时 Modal body 不缩放/闪烁。

**为什么**:开关的功能是控制通信而非控制文档可见性。用户打开 Modal 的目的是「看怎么用」,不应该被开关状态打断。

### D4: Ingest API 加 source 字段

```
POST /api/ingest
Body: {
  content: string      // 必填,Markdown 正文
  title?: string       // 可选,用于生成文件名
  source?: string      // 可选,来源标识,显示在前端聊天记录
}
```

`source` 经 WS `ingest_done` 事件广播到前端,显示为「来自 {source} 的内容已编译」。不传则保持原有「已处理上传文件 {raw},知识库已更新」。

**为什么不加鉴权**:当前威胁模型为 loopback 单用户(ADR-0003 D3.1),`/api/ingest` 仅监听 `127.0.0.1`。将来如需暴露到局域网,需在 A2A 范畴外加鉴权层。

### D5: quickbar 按钮分组

quickbar 按钮按语义分组,用呼吸渐变竖线分隔:

```
[收件] [思考:off] │ [健康检查]
   设置/通信组     │  动作组
```

分组是容器(ChatPanel)的布局决策,不在 QuickAction 组件上加 `group` 字段。

### D6: 被否的备选

- **设置页配端口**:让用户手动填端口号。问题:普通用户不知道端口是什么,也不知道填什么值;agent 需要的只是连通而非固定端口。
- **完全静默关**:开关只影响前端 UI,服务端不收。问题:不满足安全需求,知道端口的 agent 始终能投递。
- **per-vault 开关**:每个 vault 独立控制。问题:A2A 是 app 层面的功能,不因切 vault 变化。全局开关实现更简单,行为更可预测。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `server/src/interaction.ts` | POST 守卫、`source` 字段、`GET/POST /api/config/a2a`、`session_init` 带 `a2aEnabled`、`a2a_changed` 广播 |
| `server/src/config.ts` | ConfigJson.preferences(已是 Record<string,unknown>,无需改类型) |
| `web/src/hooks/useChat.ts` | +`a2aEnabled` state、`a2a_changed` 事件处理、`setA2A()`、ingest_done source 显示 |
| `web/src/components/ChatPanel.tsx` | quickbar 加「收件」按钮 + 引入 A2AModal |
| `web/src/components/A2AModal.tsx` | 新文件:Modal + toggle + 说明文档 + 复制全文 |
| `web/src/components/QuickAction.tsx` | 薄样式组件,封装 .chat-quick 样式层 |
| `web/src/styles/chat.css` | 呼吸渐变动画、quickbar 分隔线、Modal 样式、项目标准滚动条 |
