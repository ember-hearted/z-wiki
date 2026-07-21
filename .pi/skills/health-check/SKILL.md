---
name: health-check
description: 对知识库进行健康检查,扫描断链、孤儿、空文件、重复文件名、promoted-to 检查、frontmatter 覆盖率。调用 health_check 工具获取结构化结果,解读后归档到 log.md。
disable-model-invocation: true
---

# health-check:知识库健康检查

## 执行流程

### 1. 调用 health_check 工具

调用 `health_check` 工具(无参数)获取结构化 `HealthReport`。工具只读扫描整个 kb/,返回:

- `broken`:断链列表(`{from, target}`),wikilink 指向不存在的文件
- `orphans`:孤儿 wiki(`{rel, stem}`),wiki/ 中未被任何 .md 引用的页面
- `empties`:空文件(`{rel}`),内容为空或仅 frontmatter
- `dups`:重复文件名(`{stem, paths}`),同名 .md(不同路径)
- `stalePromotions`:过期的晋升(`{wikiRel, promotedTo}`),wiki 的 `promoted-to` 指向的 output 已不存在,应清理字段
- `suggestedPromotions`:建议补 promoted-to(`{wikiStem, outputStem, commonTokens}`),根据 stem 相似度发现 wiki 可能已有对应 output,建议在 wiki frontmatter 加 `promoted-to: <outputStem>`
- `frontmatterPct`:frontmatter 覆盖率(%)
- `wikiStats`:wiki/ 每个文件的行数与 frontmatter 状态
- `fileCount` / `wikiCount`:文件总数 / wiki 篇数

**不要用 bash 跑脚本**(白名单仅放行 pandoc,ADR-0007)。扫描结果全从 `health_check` 工具拿。

### 2. 解读结果,按优先级给建议

按以下优先级解读并给出修复建议:

1. **断链**(最高):每条断链分析原因--目标文件被删?改名?路径错?建议修复引用或恢复目标。
2. **空文件**:确认是否该删除或补内容。
3. **孤儿 wiki**:判断是否需要增加入站链接,或确属孤立内容。
4. **重复文件名**:判断是否该合并或重命名。
5. **建议补 promoted-to**:`suggestedPromotions` 列出 wiki 已有对应 output 但 frontmatter 未标 `promoted-to`——只需在 wiki frontmatter 加 `promoted-to: <outputStem>`,**不要新建 output 文件**(晋升关系已存在)。若 `stalePromotions` 有记录(已标但 output 已删),去掉 wiki 的 `promoted-to` 字段。
6. **frontmatter 覆盖率**:若 < 80%,提示补 frontmatter。

### 3. 追加 log.md lint 记录

在 `log.md` 追加一条 lint 记录(用 write 或 edit 工具),格式:

```
## [YYYY-MM-DD] lint | 知识库健康检查

- .md 文件: <fileCount>  wiki: <wikiCount>
- 断链: <broken.length>  孤儿: <orphans.length>  空文件: <empties.length>  重复: <dups.length>  promote 过期: <stalePromotions.length>  建议补 promoted-to: <suggestedPromotions.length>  frontmatter: <frontmatterPct>%
```

日期用当天。若 `log.md` 已有当天 lint 记录,更新而非重复追加。

## 注意

- 扫描结果以 `health_check` 工具返回的 `HealthReport` 为准,不要自己用 grep/read 重新扫描(那会漏掉占位符过滤、wikilink 转义等精确逻辑)。
- 只读检查,不改 wiki/ 内容(修复建议给用户,由用户决定是否执行);写入 `health-check/YYYY-MM-DD-知识库健康检查-报告.md` 报告(详版,见系统提示词 §8)+ `log.md` 的 lint 记录(索引)。
