.PHONY: help install run run-w build typecheck lint format format-check clean clean-release package

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
