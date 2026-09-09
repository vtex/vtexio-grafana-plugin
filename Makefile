.PHONY: bump-stable bump-beta commit-version tag-stable tag-beta push-tag download-zip release-stable release-beta help

REPO := vtex/vtexio-grafana-plugin
BUMP ?= patch
GET_VERSION = node -p "require('./package.json').version"

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ─── Version bumping ────────────────────────────────────────────────

bump-stable: ## Bump the stable version (BUMP=major|minor|patch, default: patch)
	npm version $(BUMP) --no-git-tag-version
	@echo "Bumped to $$($(GET_VERSION))"

bump-beta: ## Bump the beta pre-release version (BUMP=major|minor|patch for new base, omit to increment existing prerelease)
	@current=$$($(GET_VERSION)); \
	if echo "$$current" | grep -q "beta"; then \
		if [ "$(BUMP)" = "minor" ] || [ "$(BUMP)" = "major" ]; then \
			npm version pre$(BUMP) --preid=beta --no-git-tag-version; \
		else \
			npm version prerelease --preid=beta --no-git-tag-version; \
		fi; \
	else \
		npm version pre$(BUMP) --preid=beta --no-git-tag-version; \
	fi
	@echo "Bumped to $$($(GET_VERSION))"

# ─── Git commit ─────────────────────────────────────────────────────

commit-version: ## Commit the version bump (uses current package.json version)
	@version=$$($(GET_VERSION)); \
	git add package.json package-lock.json && \
	git commit -m "chore: bump version to $$version"

# ─── Git tagging ────────────────────────────────────────────────────

tag-stable: ## Create a stable git tag from current package.json version (vX.Y.Z)
	@version=$$($(GET_VERSION)); \
	if echo "$$version" | grep -q "beta"; then \
		echo "Error: current version $$version is a beta version, use 'make tag-beta' instead"; \
		exit 1; \
	fi; \
	git tag "v$$version" && \
	echo "Created tag v$$version"

tag-beta: ## Create a beta git tag from current package.json version (vX.Y.Z-beta.N)
	@version=$$($(GET_VERSION)); \
	if ! echo "$$version" | grep -q "beta"; then \
		echo "Error: current version $$version is not a beta version, use 'make tag-stable' instead"; \
		exit 1; \
	fi; \
	git tag "v$$version" && \
	echo "Created tag v$$version"

# ─── Push tag ───────────────────────────────────────────────────────

push-tag: ## Push the current branch commit and its version tag to origin
	@version=$$($(GET_VERSION)); \
	git push origin HEAD && \
	git push origin "v$$version" && \
	echo "Pushed commit and tag v$$version"

# ─── Download artifact ─────────────────────────────────────────────

download-zip: ## Download the release .zip for the current version (TAG=vX.Y.Z to override)
	@version=$$($(GET_VERSION)); \
	tag="v$$version"; \
	zip="vtexio-grafana-datasource-$$version.zip"; \
	if command -v gh >/dev/null 2>&1; then \
		echo "Downloading $$zip via gh CLI..."; \
		if gh release download "$$tag" \
			--repo "$(REPO)" \
			--pattern "$$zip" \
			--dir . \
			--clobber; then \
			echo "Saved $$zip"; \
		else \
			echo "gh release download failed, falling back to git archive..."; \
			git archive --format=zip --prefix="vtexio-grafana-datasource-$$version/" -o "$$zip" "$$tag" && \
			echo "Saved $$zip (from git archive)"; \
		fi; \
	else \
		echo "gh CLI not found, falling back to git archive..."; \
		git archive --format=zip --prefix="vtexio-grafana-datasource-$$version/" -o "$$zip" "$$tag" && \
		echo "Saved $$zip (from git archive)"; \
	fi

# ─── Combined release workflows ────────────────────────────────────

release-stable: bump-stable commit-version tag-stable push-tag ## Bump, commit, tag, and push a stable release (BUMP=major|minor|patch)
	@echo "Released v$$($(GET_VERSION))"

release-beta: bump-beta commit-version tag-beta push-tag ## Bump, commit, tag, and push a beta release (BUMP=major|minor|patch for new base)
	@echo "Released v$$($(GET_VERSION))"
