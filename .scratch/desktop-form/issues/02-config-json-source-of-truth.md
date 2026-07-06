# 02: 启动从 config.json 生成 pi 配置,不再读 .env/.pi/agent/models.json

- 状态:`done`(commit `287b026`)
- 父 PRD:`.scratch/desktop-form/PRD.md`
- 关联 ADR:`docs/adr/0003-desktop-form.md`(D3.1 单一真相源)

## What to build

引入 `config.json` 作为唯一真相源,pi 的 `models.json`/`auth.json` 降级为启动派生产物。这样桌面形态下用户数据可迁移(拷 config.json + kb/ 即可),且 `.env` 不再被需要。

端到端行为:

- `config.json` 含:`apiKey`、`provider`(首版写死 `ark`)、`model`(首版写死 `ark-code-latest`)、已知 Vault 列表 + 当前 Vault、全局偏好。schema 首版最小,只覆盖启动所需字段。
- 启动时 `buildAgentContext` 读 `config.json`(从全局 dir),用其 provider/model 字段生成 `models.json` 到全局 agentDir,喂 `ModelRegistry`;用 apiKey 字段经 `setRuntimeApiKey` 运行时注入,**`auth.json` 不落盘**。
- 不再读 `.env` 的 `ARK_API_KEY`(`agentHost.ts` 的 `dotenv.config` 与 `process.env.ARK_API_KEY` 移除)。
- `generateModelsJson(config)` 是纯函数:输入 config 的 provider/model 字段,输出 models.json 内容(符合 pi 的 `{providers:{...}}` 格式),可独立测试。

## Acceptance criteria

- [x] `config.json` schema 定义清楚(至少含 apiKey/provider/model/vaults/currentVault);首版 provider/model 写死 ark/ark-code-latest,但 schema 支持未来扩展。
- [x] `generateModelsJson(config)` 纯函数 + 测试(输入 config 产出符合 pi 格式的 models.json 内容),参照 `server/src/buildView.test.ts` 风格。
- [x] 启动时 `models.json` 从 config.json 生成到全局 agentDir;删除已存在的 `models.json` 后重启会重新生成。
- [x] apiKey 从 config.json 读,经 `setRuntimeApiKey` 注入;`auth.json` 文件不再被创建。
- [x] `.env` 不再被读(`dotenv.config` 与 `process.env.ARK_API_KEY` 引用移除);`.env.example` 更新或移除说明改走 config.json。
- [x] dev 形态验证:放 config.json(含 apiKey),`npm run dev` 起 agent 能调用 LLM(完成一次对话或 ingest)。
- [x] `make typecheck` 与 `npm test` 通过,无回归。

## Blocked by

- `01-server-embeddable.md`(需要 globalDir 参数,config.json 路径才能传入)

## Notes

首版 provider/model 写死 ark,设置页不暴露 provider 切换(多 provider 是未来产品决策,扩 schema 不破坏架构)。API key 明文存 config.json 的威胁模型判断见 ADR-0003 D3.1(本地单用户工具,keystore 升级留待多用户/暴露网络场景)。
