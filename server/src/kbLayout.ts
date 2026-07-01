// kbLayout.ts — layer1(知识层)的目录契约集中点。
// 定义 kb/ 根、四条 sub-seam 路径(Source=raw / Compiled=wiki / Metadata=index+log / Reports=output)
// 及可强制规则(raw/ 只读)。buildView/kbHooks/interaction/agentHost 引用此处,不再硬编码字符串。
// 详见 ADR-0002、CONTEXT.md。
import path from "node:path";

/** layer1 根目录(项目根下的 kb/)。agent 的 cwd 即此。 */
export function kbRoot(projectRoot: string): string {
  return path.join(projectRoot, "kb");
}

// ── sub-seam 路径(相对 projectRoot 的绝对路径)─────────────────
/** sub-seam 目录名(相对 kb/),供 git pathspec 等需相对名的场景用。 */
export const SUBSEAM_DIRS = ["raw", "wiki", "output"] as const;
export const SUBSEAM_FILES = ["index.md", "log.md"] as const;

export function rawDir(projectRoot: string): string {
  return path.join(kbRoot(projectRoot), "raw");
}
export function wikiDir(projectRoot: string): string {
  return path.join(kbRoot(projectRoot), "wiki");
}
export function outputDir(projectRoot: string): string {
  return path.join(kbRoot(projectRoot), "output");
}
export function indexFile(projectRoot: string): string {
  return path.join(kbRoot(projectRoot), "index.md");
}
export function logFile(projectRoot: string): string {
  return path.join(kbRoot(projectRoot), "log.md");
}

/**
 * 判断绝对路径是否落在 Source(raw/) 下。raw/ 全层只读(ADR-0002 决策 2)。
 * 用 relative + 非 .. 前缀判断,避免 raw.txt / wiki/raw-x.md 这类伪匹配。
 */
export function isRawPath(absPath: string, projectRoot: string): boolean {
  const rel = path.relative(rawDir(projectRoot), absPath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * 判断绝对路径是否在 layer1 可写区(wiki/output/index.md/log.md)。
 * raw/ 下只读,返回 false;kb/ 外(如 server/web)非 layer1,返回 false。
 */
export function isWritablePath(absPath: string, projectRoot: string): boolean {
  if (isRawPath(absPath, projectRoot)) return false;
  const rel = path.relative(kbRoot(projectRoot), absPath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
