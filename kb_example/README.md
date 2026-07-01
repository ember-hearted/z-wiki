# kb/ — 知识库内容目录

此目录是 z-wiki 的 **layer1 知识层**,agent 全权维护,server 只读(除上传归档)。
`kb/` 本身被 gitignore(内容由 agent 维护),本目录(`kb_example/`)是结构样板。

## 起步

```bash
cp -r kb_example kb
```

然后启动 server。server 启动时会检测 `kb/` 存在,缺失则报错退出。

## 四条 sub-seam

| sub-seam | 路径(相对 kb/) | 契约 |
|---|---|---|
| **Source** | `raw/` | 只读源。原始来源(含从非 md 转换而来的 .md)。agent 读取但永不修改 —— 由代码层 tool_call 拦截强制(ADR-0002)。唯一写入方是上传端点归档 |
| **Compiled** | `wiki/` | agent 维护的结构化知识。`view: true` 的文章进入可视层 |
| **Metadata** | `index.md`, `log.md` | 索引与操作时间线。每次有产出的 ingest/query 后追加 |
| **Reports** | `output/` | agent 生成的报告与分析 |
| (工具产物) | `health-check/` | healthCheck 脚本生成的健康检查报告。与 output/ 同级,不进可视层,不归 agent 维护 |

agent 的 cwd = `kb/`,所以工具调用里的路径都是相对 `kb/`(如 `read wiki/01-x.md`)。
