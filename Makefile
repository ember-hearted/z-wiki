.PHONY: help install run run-w build typecheck lint format format-check clean clean-release package release

WORKTREE ?= $(CURDIR)

help: ## 显示帮助
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-15s %s\n", $$1, $$2}'

install: ## 安装依赖
	npm install --ignore-scripts

run: ## 构建并启动主工作区的 desktop(Electron)
	npm run desktop

run-w: ## 复用主仓库依赖,启动 worktree 的 desktop(在 worktree 或主仓库均可跑)
	@MAIN_ROOT=$$(cd "$$(git rev-parse --git-common-dir)/.." && pwd); \
	test -d "$$MAIN_ROOT/node_modules" || { echo "主仓库 node_modules 不存在,先 cd $$MAIN_ROOT && npm install"; exit 1; }; \
	if [ "$(abspath $(WORKTREE))" != "$$MAIN_ROOT" ]; then \
		ln -sfn "$$MAIN_ROOT/node_modules" "$(abspath $(WORKTREE))/node_modules"; \
	fi
	cd "$(WORKTREE)" && npm run desktop

build: ## 构建前端 + 后端产物
	npm run build

package: ## 打包 desktop(electron-builder,默认当前平台;TARGETS="--mac --win --linux" 三平台交叉打包)
	npm run build
	npm run build -w @z-wiki/desktop
	node desktop/scripts/render-icon.mjs
	cd desktop && npx electron-builder $(TARGETS)
	npx tsx scripts/package-update-bundles.ts
	@echo "产物在 release/(gitignored)。mac 未签名:双击被 Gatekeeper 拦时右键 -> 打开。"

typecheck: ## 全量类型检查
	npm run typecheck

lint: ## Biome lint 检查(不修改)
	npm run lint

format: ## Biome 格式化(写入)
	npm run format

format-check: ## Biome 格式化检查(只读,用于 CI)
	npm run format:check

clean: ## 清理构建产物与依赖
	rm -rf node_modules server/dist web/dist
	@echo "已清理"

clean-release: ## 清理 release/:删其他平台完整包,保留当前 arch + app/code 包 + unpacked 缓存(ADR-0018 D7)
	npx tsx scripts/clean-release.ts

# 发版主路径是远程 release.yml 工作流:本地只触发,打包/tag/release/上传全在 CI(自动分层)。
# 本地打包仅作手动兜底:make package TARGETS="--mac --win --linux",再手动 gh release create。
# 注意:recipe 续行段内不要写 # 注释——make 折叠续行后 # 会吞掉同行后续命令(实测静默 exit 0)。
release: ## 发布新版本:触发远程 release 工作流(自动分层打包 + tag + GitHub release + 上传产物)
	$(eval V := $(shell node -p "require('./package.json').version"))
	$(eval TAG := v$(V))
	@set -eu; \
	SUMMARY="$(SUMMARY)"; \
	if [ -z "$$SUMMARY" ]; then \
	  echo "用法: make release SUMMARY=\"A2A 收件 + 轨道球修复\""; \
	  exit 1; \
	fi; \
	\
	echo "=== 检查 git 状态 ==="; \
	if [ -n "$$(git status --porcelain)" ]; then echo "有未提交改动"; exit 1; fi; \
	CUR_BRANCH=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$CUR_BRANCH" != "main" ]; then echo "不在 main 分支(当前: $$CUR_BRANCH)"; exit 1; fi; \
	git fetch origin main --quiet; \
	if [ "$$(git rev-parse HEAD)" != "$$(git rev-parse origin/main)" ]; then \
	  echo "本地 main 与 origin/main 不同步(远程以 origin/main 打包),先 push 或 pull"; exit 1; \
	fi; \
	if git rev-parse "$(TAG)" >/dev/null 2>&1; then echo "本地 tag $(TAG) 已存在"; exit 1; fi; \
	if git ls-remote --exit-code --tags origin "refs/tags/$(TAG)" >/dev/null 2>&1; then \
	  echo "远程 tag $(TAG) 已存在"; exit 1; \
	fi; \
	echo "→ 发布 $(TAG) - $$SUMMARY"; \
	\
	echo ""; echo "=== 触发远程 release 工作流 ==="; \
	gh workflow run release.yml -f summary="$$SUMMARY"; \
	echo ""; echo "✓ 已触发(远程自动分层打包,完成后建 $(TAG) release)"; \
	echo "  查看: gh run list --workflow release.yml --limit 1"; \
	echo "  跟进: gh run watch"
