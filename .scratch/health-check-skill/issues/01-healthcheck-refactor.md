Status: ready-for-agent

# 01 - healthCheck 重构:collectReport + formatReport + runHealthCheck(TDD)

## Parent

ADR-0009。本 issue 是 (d) 路径的"复用 healthCheck.ts 精确逻辑"落点。

## What to build

把 `scripts/healthCheck.ts` 搬到 `server/src/healthCheck.ts` 并拆成纯函数,使 agentHost 可导入、make health CLI 行为不变、可单测。

**放置(方案 B')**:库函数 + CLI entry 都在 `server/src/healthCheck.ts`,删 `scripts/healthCheck.ts`,改 `package.json` health script 为 `tsx server/src/healthCheck.ts`。理由:runHealthCheck 要被 agentHost 同包导入;scripts/ 独立 tsconfig 跨包导入 server/src 会拉入整包混乱;一份代码无跨包依赖。

**拆分**:
- `collectReport(kbRoot): Promise<HealthReport>` -- 纯函数,只读扫 kb/,把现有 `main()` 的收集逻辑(gather md files、断链、孤儿、空文件、重复、frontmatter、wiki 统计)抽出。不写盘、不 console。
- `formatReport(report: HealthReport): string` -- 纯函数,HealthReport -> markdown 报告字符串(复用现有 lines 拼接逻辑)。
- `runHealthCheck = collectReport`(导出别名,供 agentHost 用;语义=只读扫描,返回结构化结果)。
- `HealthReport` 类型:`{ fileCount, wikiCount, broken: {from,target}[], orphans: {rel,stem}[], empties: {rel}[], dups: {stem,paths:string[]}[], frontmatterPct, wikiStats: {stem,lines,hasFrontmatter}[] }`。
- CLI `main()`:collectReport + formatReport + 写 `kb/health-check/YYYY-MM-DD-报告.md` + 终端摘要。用 `import.meta.url` guard 仅在直接跑时执行,被 import 时不跑。

**TDD seam**(pre-agreed):collectReport / formatReport 是纯函数,先写测试再重构。复用 `buildView.test.ts` 的 mkdtemp fixture 模式构造临时 kb/。

## Acceptance criteria

- [ ] `server/src/healthCheck.ts` 导出 `runHealthCheck`(=collectReport)、`formatReport`、`HealthReport` 类型
- [ ] `server/src/healthCheck.test.ts` 覆盖:collectReport 对 fixture(含断链/孤儿/空文件/重复)返回正确 HealthReport;formatReport 输出含各检查项段落
- [ ] `scripts/healthCheck.ts` 删除;`package.json` health script 改 `tsx server/src/healthCheck.ts`
- [ ] `make health` 行为不变(生成 `kb/health-check/YYYY-MM-DD-报告.md` + 终端摘要,内容与重构前一致)
- [ ] `npm test` 通过(新测试在 server/src glob 内)
- [ ] `make typecheck` 通过
