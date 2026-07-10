# 移除 wiki view 过滤,书本全显(导航页 hardcode 排除)

- 状态:accepted
- 日期:2026-07-10
- 范围:layer1(wiki frontmatter)+ layer3(buildView 过滤规则)+ prompt

## 背景

buildView 原按 wiki frontmatter `view: true` 过滤(ADR-0001),view 由 agent 在 build 时自主决定,设计意图是"通用读者过滤器":`view:true`=通用参考价值,`false`=导航/索引/项目/个人/面试。但 z-wiki 是个人知识库(书本给自己看,非对外分享),"通用 vs 个人"分级语境不匹配。`view:false` 混合"导航/索引(不该进书本)"和"个人/项目(该进)"两类,一刀切排除导致个人知识被藏;且 LLM 误判(如 `02-LLM平台模型与接口` 被设 `view:false`)使有价值的知识页永远看不到。

## 决策

**移除 wiki view 过滤,wiki 全显。** buildView 对 wiki 不再读 `view` 字段,除导航页 `00-知识库导航`(hardcode stem 排除)外全部发布。output 保留 `publish`/行数过滤(短报告不进,机制本身无问题,问题只在 wiki 的 view)。prompt.ts 删 view 引导,agent 不再设 view;新增"知识库总导航页固定命名 `00-知识库导航`"约定(确定性,`healthCheck.ts:181` 已用同 stem 做孤儿检查例外,两处一致)。现有 wiki 的 `view` frontmatter 保留忽略(buildView 不读),不批量清理(kb/ 由 agent 维护,脚本不写),新 wiki 不设 view,死字段随 agent 后续编辑自然消亡。

## 为什么不是前端按钮切换

候选:保留 view 分级,buildView 返回全部 + view flag,前端按钮切换显示 `view:false`。否决:view 分级在个人知识库语境无价值(自己的知识都想看),按钮等于承认 `view:false` 该可看,分级只剩"默认折叠个人内容"意义不大;且 LLM 误判仍在(该 `view:true` 的设 `false`,默认仍看不到)。

## 为什么导航页 hardcode 而非 00- 前缀

`00-` 前缀(通用)靠 agent 命名导航页时用 00-,引入 LLM 判断,有重蹈 view 误判的风险(虽低)。hardcode `00-知识库导航` 确定性,当前唯一导航页,YAGNI;未来多个导航页再改前缀,改动很小。

## 后果

- `buildView.shouldPublish`:wiki 改"排除 stem === `00-知识库导航`",output 不变。
- `prompt.ts`:删 view 引导(line 59-71、186),加导航页命名约定。
- `CONTEXT.md`:view 术语更新(Compiled 不再"`view:true` 进入可视层",改为"除导航页外全进")。
- 现有 wiki `view` 字段成死字段,无副作用。
- ADR-0001 的 buildView 纯函数契约不变(仍是纯函数 + HTTP),仅过滤规则变。
