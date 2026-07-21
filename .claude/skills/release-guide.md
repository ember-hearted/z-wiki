---
name: release-guide
description: z-wiki 发版指南。当用户问"发版"、"打包"、"发布"、"打增量包"、"bump version"、"make release"、"出包"、"上传更新"时触发。包含版本号决策、包类型选择、三档版本比对、命令模板。先判断发什么(版本号+包类型),再按对应模板执行。
---

# release-guide: z-wiki 发版指南

本 skill 指导 z-wiki 的发版全流程:决定 bump 类型→选包→打包→发布→本地更新。

## 1. 版本号决策

| bump 类型 | 何时用 | 示例 |
|---|---|---|
| `patch` | 纯代码改动(server/web/desktop 源码),无依赖变更、无 API 变化 | `0.4.0 → 0.4.1` |
| `minor` | 新功能、依赖升级(package.json/lockfile 变)、非破坏性 API 变更 | `0.4.1 → 0.5.0` |
| `major` | 破坏性架构变化、三层间契约变动、ADR 废弃、breaking change | `0.5.0 → 1.0.0` |

**核心原则**:先判断是否动了依赖,再选包类型。

## 2. 包类型决策(三档增量,ADR-0018)

z-wiki 发版的核心是**按改动范围选最轻的包**,不每次都打全平台完整包。

### 三档版本号

客户端用三版本号比对决定下载哪个包:

```
baselineVersion = e{electron}_p{pandoc}_r{rg}_f{fd}  → 变则下完整包
depsVersion     = package-lock.json sha256 前 12 位    → 变则下应用包
appVersion      = package.json version                   → 变则下代码包
```

### 包清单

```text
release/
├── z-wiki-code-{version}.tar.gz            # 代码包:仅 server+web 产物(~900KB)
├── z-wiki-app-{version}.tar.gz             # 应用包:含 node_modules(~28MB)
├── z-wiki-{version}-mac-arm64.dmg          # 完整包(mac ARM)
├── z-wiki-{version}-mac-x64.dmg            # 完整包(mac x64)
├── z-wiki-{version}-win-x64.exe            # 完整包(win)
├── z-wiki-{version}-linux-x64.AppImage     # 完整包(linux)
└── latest.json                             # 更新清单
```

### 选包决策树

```
改动范围?
├─ 只有 server/web/desktop 源码 → 代码包(code) 就够了
│   └→ patch bump, make package (mac only)
├─ node_modules 变了(package-lock 更新) → 代码包 + 应用包(app)
│   └→ minor bump, make package (mac only)
└─ Electron / pandoc / rg / fd 变了 → 完整包(full) + 应用包 + 代码包
    └→ minor/major bump, make release (三平台)
```

## 3. 发版流程

### 场景 A:纯代码小版本(最常用)

```bash
# 1. bump
node scripts/bump-version.mjs patch
git add -A && git commit -m "chore: bump version x.y.z"

# 2. 打包(仅当前平台 mac,够了)
make clean-release    # 清掉上次残留
make package          # 生成 code 包 + app 包 + latest.json

# 3. tag + GitHub release(只传 code 包 + latest.json)
git tag v{x.y.z}
git push origin v{x.y.z}
gh release create "v{x.y.z}" \
  --title "v{x.y.z} - 简短描述" \
  --generate-notes \
  "release/z-wiki-code-{x.y.z}.tar.gz" \
  "release/latest.json"
```

### 场景 B:依赖有变动(非跨平台)

```bash
node scripts/bump-version.mjs minor
git add -A && git commit -m "chore: bump version x.y.z"
make clean-release
make package
git tag v{x.y.z}
git push origin v{x.y.z}
# 上传 code + app 包
gh release create "v{x.y.z}" \
  --title "v{x.y.z} - 简短描述" \
  --generate-notes \
  "release/z-wiki-code-{x.y.z}.tar.gz" \
  "release/z-wiki-app-{x.y.z}.tar.gz" \
  "release/latest.json"
```

### 场景 C:跨平台大版本(Electron/工具链升级)

```bash
node scripts/bump-version.mjs minor  # 或 major
git add -A && git commit -m "chore: bump version x.y.z"

# 用 make release 全自动(三平台打包 + tag + GitHub release)
make -B release SUMMARY="版本描述,多个改动用 + 分隔"

# 其中 make release 做了:
#   make package TARGETS="--mac --win --linux"
#   git tag v{x.y.z} && git push origin v{x.y.z}
#   gh release create ...(所有包:完整包 + app 包 + code 包 + latest.json)
```

### 本地 packaged app 更新

本地 /Applications/z-wiki.app 跑以下步骤(只在打包机本地测试用):

```bash
V="x.y.z"
RESOURCES="/Applications/z-wiki.app/Contents/Resources"
STAGING=$(mktemp -d)

tar -xzf "release/z-wiki-code-${V}.tar.gz" -C "$STAGING"
for rel in app/dist app/node_modules/@z-wiki/server web/dist app/package.json; do
  src="$STAGING/$rel"; target="$RESOURCES/$rel"
  [ -e "$target" ] && mv "$target" "${target}.old"
  mv "$src" "$target"
done
for rel in app/dist app/node_modules/@z-wiki/server web/dist app/package.json; do
  old="$RESOURCES/${rel}.old"; [ -e "$old" ] && rm -rf "$old"
done

STATE="$HOME/Library/Application Support/z-wiki/.update-state.json"
cat > "$STATE" <<EOF
{ "appVersion": "${V}", "depsVersion": "...", "baselineVersion": "...", "platform": "darwin" }
EOF
rm -rf "$STAGING"
```

## 4. 注意事项

1. **`make release` 不在 .PHONY 里**,首次或缓存的 release target 需 `make -B release` 强制重跑
2. **bump 前检查 4 处 package.json 版本一致**(`scripts/bump-version.mjs` 自动统一)
3. **main 是保护分支**,打 tag 前确保 feat 已通过 PR 合并;tag 可单独推(`git push origin v{x.y.z}`)
4. **清洁 release/**:`make clean-release` 保留当前 arch + app/code 包缓存,删多余完整包
5. **本地更新时 depsVersion/baselineVersion 从旧 `.update-state.json` 抄**——它们没变就不更新,直接写同值
6. **mac 打包不签名**:Gatekeeper 拦时 `xattr -dr com.apple.quarantine` 或右键打开
