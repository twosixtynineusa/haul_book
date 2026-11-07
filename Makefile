# Haul Book — docker-first development (house standard).
#
# NOTHING is installed or executed on the host except docker, docker compose,
# make, and git. Every npm / node / eslint / jest invocation runs INSIDE a
# container. No target here may call npm/node/npx on the host.
# (See Tech_Stack.md "Docker-first development".)
#
# Day one:            make setup   (once) → make up → http://localhost:3100
# Before committing:  make ci      (every gate GitHub Actions runs, in Docker)

COMPOSE := docker compose

CR := $(shell printf '\r')
HASH := $(shell printf '\043')

# Windows, without WSL: GNU make run from Git Bash (README → "Windows"). Recipes need
# Git Bash's POSIX shell, so PowerShell and cmd are refused. Inside WSL, OS isn't set
# and this is all skipped: that's plain Linux.
ifeq ($(OS),Windows_NT)
  ifndef MSYSTEM
    $(error On Windows, run make from Git Bash (or a WSL Ubuntu terminal), not PowerShell or cmd. See README.md → "Windows")
  endif
  # Git Bash rewrites arguments that look like paths (/workspace → C:/Program Files/Git/workspace)
  # before docker sees them. Turn that off for every recipe.
  export MSYS_NO_PATHCONV := 1
  export MSYS2_ARG_CONV_EXCL := *
  # Docker Desktop wants C:/… paths: \ becomes /, and Git Bash's /c/… becomes C:/….
  host_path = $(shell p='$(subst \,/,$(1))'; case "$$p" in (/[A-Za-z]/*|/[A-Za-z]) d=$$(printf '%s' "$$p" | cut -c2 | tr a-z A-Z); p="$$d:$${p$(HASH)/?}" ;; esac; printf '%s' "$$p")
  ABS_PATH_GLOB := /*|[A-Za-z]:*
  # Ownership doesn't apply to Windows folders; Git Bash's own uid (197609…) would only confuse.
  HOST_UID := 1000
  HOST_GID := 1000
else
  host_path = $(1)
  ABS_PATH_GLOB := /*
  HOST_UID := $(shell id -u)
  HOST_GID := $(shell id -g)
endif
export HOST_UID HOST_GID
# The project folder as docker should see it.
ROOT := $(call host_path,$(CURDIR))

# Real escape characters, not "\033": Git Bash's echo prints backslash codes literally.
BLUE := $(shell printf '\033[0;34m')
GREEN := $(shell printf '\033[0;32m')
YELLOW := $(shell printf '\033[0;33m')
RED := $(shell printf '\033[0;31m')
NC := $(shell printf '\033[0m')

# The output folder comes from .env (OUTPUT_DIR). Compose gets it as an absolute
# path, plus your uid/gid so the api hands converted files to you, not root.
-include .env
OUTPUT_DIR ?= ./output
INPUT_DIR ?= ./input
WEB_PORT ?= 3100
API_PORT ?= 3000
DB_PORT ?= 5433
# A .env saved by a Windows editor may have CRLF line endings, and paths with spaces
# may be quoted; compose copes with both, make doesn't. Drop the \r and the quotes.
$(foreach v,OUTPUT_DIR INPUT_DIR INPUT_SCAN_SECONDS WEB_PORT API_PORT DB_PORT,\
	$(eval $(v) := $(subst ",,$(subst $(CR),,$($(v))))))
# Absolute path of a folder from .env (relative = this project folder). Done in the
# shell, not with $(abspath), so paths with spaces (C:\Users\Jane Doe\…) survive.
abs_dir = $(shell p='$(call host_path,$(1))'; case "$$p" in ($(ABS_PATH_GLOB)) ;; (*) p="$(ROOT)/$${p$(HASH)./}" ;; esac; printf '%s' "$${p%/}")
export OUTPUT_DIR_ABS := $(call abs_dir,$(OUTPUT_DIR))
export INPUT_DIR_ABS := $(call abs_dir,$(INPUT_DIR))

# node_modules / dist / .next are masked by named volumes so build artifacts
# never touch the host. `make rebuild` re-seeds them from the lockfiles.
DEP_VOLUMES := haul_book_shared_node_modules haul_book_shared_dist \
	haul_book_api_node_modules haul_book_api_dist haul_book_worker_dist \
	haul_book_web_node_modules haul_book_web_next

LOCKFILES := packages/shared/package-lock.json apps/api/package-lock.json apps/web/package-lock.json

.PHONY: help setup seed lock output-dir input-dir up down restart rebuild logs logs-api logs-web logs-worker logs-db \
	migrate migrate-create migrate-deploy generate studio shell-db sql db-backup db-restore \
	shell-api shell-web test-api test-web test-all ci lint-api lint-web format-api format-web \
	typecheck build-images up-prod clean ps status

.DEFAULT_GOAL := help

help:
	@echo "$(BLUE)Haul Book — make targets$(NC)"
	@echo ""
	@echo "$(GREEN)Development$(NC)"
	@echo "  make setup        - One-time: .env, lockfiles, build images, seed dep volumes (safe to re-run)"
	@echo "  make up           - Start the portal → http://localhost:$(WEB_PORT)"
	@echo "  make down         - Stop and remove containers (converted files are untouched)"
	@echo "  make restart      - Recreate containers WITHOUT rebuilding (.env-only changes, e.g. OUTPUT_DIR)"
	@echo "  make rebuild      - Rebuild images + re-seed dep volumes (Dockerfile/compose/deps changes)"
	@echo "  make logs         - Tail all logs   (logs-api / logs-worker / logs-web / logs-db)"
	@echo "  make output-dir   - Show where converted files are saved"
	@echo "  make input-dir    - Show the watched input folder (INPUT_DIR) — dropped files auto-convert"
	@echo "  make shell-api    - Shell into the api container (also shell-web)"
	@echo "  make lock         - Regenerate package-lock.json files after editing a package.json"
	@echo ""
	@echo "$(GREEN)Database (Postgres 18 — saved companies and units)$(NC)"
	@echo "  make migrate NAME=x     - Create + apply a Prisma migration after editing schema.prisma"
	@echo "  make migrate-create NAME=x - Create a migration without applying it"
	@echo "  make migrate-deploy    - Apply pending migrations (setup/rebuild do this)"
	@echo "  make generate          - Regenerate the Prisma client"
	@echo "  make studio            - Prisma Studio (http://localhost:5555)"
	@echo "  make shell-db          - psql prompt (host port $(DB_PORT))"
	@echo "  make sql Q=\"select 1\"  - Run one SQL statement (non-interactive)"
	@echo "  make db-backup / db-restore - pg_dump to / restore from backup-*.sql"
	@echo ""
	@echo "$(GREEN)Testing & quality$(NC)"
	@echo "  make ci           - Run ALL CI gates locally in Docker (run before you commit)"
	@echo "  make test-all     - api + web test suites"
	@echo "  make lint-api     - eslint (also lint-web)"
	@echo "  make format-api   - auto-format (also format-web)"
	@echo "  make typecheck    - tsc --noEmit across shared/api/web"
	@echo ""
	@echo "$(GREEN)Docker$(NC)"
	@echo "  make build-images - Build all images"
	@echo "  make up-prod      - Run the production images locally (make down first)"
	@echo "  make clean        - Remove containers + ALL volumes, incl. the database (converted files are untouched)"
	@echo ""

# ============================================================================
# DEVELOPMENT
# ============================================================================

## One-time setup: .env, lockfiles, dev images, dependency volumes (in-container
## npm ci), database migrations. Safe to re-run.
setup:
	@[ -f .env ] || (cp .env.example .env && echo "$(YELLOW)>> Created .env from .env.example — set OUTPUT_DIR to the folder you import into ProMiles from$(NC)")
	@for f in $(LOCKFILES); do [ -f $$f ] || { $(MAKE) lock || exit 1; break; }; done
	$(COMPOSE) up -d --wait db redis
	$(COMPOSE) build shared api worker web
	$(MAKE) seed
	$(MAKE) migrate-deploy
	@$(MAKE) --no-print-directory output-dir
	@$(MAKE) --no-print-directory input-dir
	@echo "$(GREEN)Setup complete — run 'make up', open http://localhost:$(WEB_PORT)$(NC)"

## Seed the dependency volumes strictly from the lockfiles (npm ci), build
## @haulbook/shared, generate the Prisma client. (Internal helper of setup/rebuild.)
seed:
	$(COMPOSE) run --rm --no-deps shared sh -c "npm ci && npm run build"
	$(COMPOSE) run --rm --no-deps api sh -c "npm ci && npx prisma generate"
	$(COMPOSE) run --rm --no-deps web npm ci

## (Re)generate the lockfiles from package.json, in-container, owned by you.
## Run after editing any package.json, then `make rebuild`. Uses a bare node
## container with only the source mounted and every node_modules on a throwaway
## tmpfs, so the root-owned dependency volumes are never touched and nothing but
## the lockfiles reaches the host. Resolution uses npm 11: npm 10's arborist
## crashes ("reading 'edgesOut'") on vitest 4's peer set. The images' npm 10
## only replays the lockfile (`npm ci`), which is unaffected.
## One container for all three: the apps' file: link to packages/shared runs
## shared's `prepare` (tsc), which needs shared's own deps installed first.
LOCK_TMPFS := $(foreach d,packages/shared/node_modules packages/shared/dist apps/api/node_modules apps/web/node_modules,\
	--tmpfs /workspace/$(d):uid=$(HOST_UID),gid=$(HOST_GID),exec)
NPM_LOCK := npx -y npm@11 install --ignore-scripts --no-audit --no-fund
lock:
	docker run --rm --user $(HOST_UID):$(HOST_GID) -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
		-v "$(ROOT)":/workspace $(LOCK_TMPFS) node:22-alpine sh -ec \
		"cd /workspace/packages/shared && $(NPM_LOCK) && cd ../../apps/api && $(NPM_LOCK) && cd ../web && $(NPM_LOCK)"

## Created up front so docker doesn't create it root-owned.
output-dir:
	@mkdir -p "$(OUTPUT_DIR_ABS)"
	@echo "Converted files are saved to: $(GREEN)$(OUTPUT_DIR_ABS)$(NC)  (OUTPUT_DIR in .env)"

## The watched folder + its archive/ and failed/ subfolders, created as you.
input-dir:
	@mkdir -p "$(INPUT_DIR_ABS)/archive" "$(INPUT_DIR_ABS)/failed"
	@echo "Watched input folder:        $(GREEN)$(INPUT_DIR_ABS)$(NC)  (INPUT_DIR in .env; scanned every $(or $(INPUT_SCAN_SECONDS),30)s)"

up: output-dir input-dir
	$(COMPOSE) up -d
	@echo "$(GREEN)Portal starting$(NC) — web http://localhost:$(WEB_PORT) · api http://localhost:$(API_PORT)/api/health"
	@echo "Watch it come up: make ps / make logs"

down:
	$(COMPOSE) --profile full down

## Recreate containers from EXISTING images (picks up .env changes only).
restart: down up

## Rebuild images without cache, re-seed dependency volumes from the lockfiles.
## Use after Dockerfile / compose / package.json changes.
rebuild: output-dir input-dir
	$(COMPOSE) --profile full down
	$(COMPOSE) build --no-cache shared api worker web
	docker volume rm -f $(DEP_VOLUMES)
	$(COMPOSE) up -d --wait db
	$(MAKE) seed
	$(MAKE) migrate-deploy
	$(COMPOSE) up -d

logs:
	$(COMPOSE) logs -f --tail=100
logs-api:
	$(COMPOSE) logs -f api
logs-web:
	$(COMPOSE) logs -f web
logs-worker:
	$(COMPOSE) logs -f worker
logs-db:
	$(COMPOSE) logs -f db

shell-api:
	$(COMPOSE) exec api sh
shell-web:
	$(COMPOSE) exec web sh

# ============================================================================
# DATABASE (Postgres 18 via Prisma — apps/api/prisma/schema.prisma)
# ============================================================================

## After editing schema.prisma: make migrate NAME=add_something
migrate:
	@[ -n "$(NAME)" ] || { echo "Usage: make migrate NAME=short_description"; exit 1; }
	$(COMPOSE) up -d --wait db
	$(COMPOSE) run --rm --no-deps api npx prisma migrate dev --name $(NAME)

migrate-create:
	@[ -n "$(NAME)" ] || { echo "Usage: make migrate-create NAME=short_description"; exit 1; }
	$(COMPOSE) up -d --wait db
	$(COMPOSE) run --rm --no-deps api npx prisma migrate dev --create-only --name $(NAME)

migrate-deploy:
	$(COMPOSE) up -d --wait db
	$(COMPOSE) run --rm --no-deps api npx prisma migrate deploy

generate:
	$(COMPOSE) run --rm --no-deps api npx prisma generate

studio:
	$(COMPOSE) up -d --wait db
	$(COMPOSE) run --rm --no-deps -p 5555:5555 api npx prisma studio --port 5555 --browser none

## The Postgres database and role (compose's POSTGRES_USER / POSTGRES_DB). Override only
## to reach an older volume, e.g. one from before the rename (CHANGELOG 2026-11-07).
DB ?= haulbook

shell-db:
	$(COMPOSE) up -d --wait db
	$(COMPOSE) exec db psql -U $(DB) -d $(DB)

sql:
	@test -n "$(Q)" || { echo "Usage: make sql Q=\"select …\""; exit 1; }
	@$(COMPOSE) exec -T db psql -U $(DB) -d $(DB) -c "$(Q)"

## pg_dump to backup-<timestamp>.sql (no owners, so it restores under any role).
db-backup:
	@$(COMPOSE) up -d --wait db >/dev/null || { echo "$(RED)The database isn't running. Is Docker up?$(NC)"; exit 1; }
	@f=backup-$$(date +%Y%m%d-%H%M%S).sql; \
	if $(COMPOSE) exec -T db pg_dump --no-owner -U $(DB) $(DB) > "$$f"; then \
		echo "$(GREEN)Database backed up to $$f$(NC)"; \
	else rm -f "$$f"; echo "$(RED)Backup failed; nothing written.$(NC)"; exit 1; fi

## Replaces the whole database with a backup: make db-restore [F=backup-….sql]
db-restore:
	@f="$(F)"; [ -n "$$f" ] || read -r -p "Backup file to restore (replaces the current database): " f; \
	[ -f "$$f" ] || { echo "$(RED)File not found: $$f$(NC)"; exit 1; }; \
	$(COMPOSE) up -d --wait db >/dev/null && \
	$(COMPOSE) exec -T db psql -q -U $(DB) -d $(DB) -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" && \
	$(COMPOSE) exec -T db psql -q -v ON_ERROR_STOP=1 -U $(DB) -d $(DB) < "$$f" && \
	echo "$(GREEN)Database restored from $$f$(NC)"

# ============================================================================
# TESTING & CODE QUALITY
# ============================================================================

test-api:
	$(COMPOSE) up -d --wait db
	$(COMPOSE) run --rm --no-deps api npm test
test-web:
	$(COMPOSE) run --rm --no-deps web npm test
test-all: test-api test-web

lint-api:
	$(COMPOSE) run --rm --no-deps api npm run lint
lint-web:
	$(COMPOSE) run --rm --no-deps web npm run lint
format-api:
	$(COMPOSE) run --rm --no-deps api npm run format
format-web:
	$(COMPOSE) run --rm --no-deps web npm run format
typecheck:
	$(COMPOSE) run --rm --no-deps shared npm run build
	$(COMPOSE) run --rm --no-deps api npm run typecheck
	$(COMPOSE) run --rm --no-deps web npm run typecheck

## Mirrors every GitHub Actions gate, in Docker, so failures are caught before
## pushing. Requires `make setup` first (dependency volumes must be seeded).
## Runs every gate even if earlier ones fail, then prints a pass/fail summary.
## Note: "web build" writes .next — stop a running dev stack first (`make down`).
ci:
	@$(COMPOSE) up -d --wait db >/dev/null
	@echo "$(BLUE)════════════════════════════════════════════════════════════$(NC)"; \
	echo "$(BLUE)  Haul Book — local CI (mirrors GitHub Actions)$(NC)"; \
	echo "$(BLUE)════════════════════════════════════════════════════════════$(NC)"; \
	PASS=0; FAIL=0; TOTAL=11; RESULTS=""; FIXES=""; \
	run_step() { \
		N=$$1; NAME=$$2; shift 2; \
		printf "$(YELLOW)[%2d/%d] %s$(NC)\n" "$$N" "$$TOTAL" "$$NAME"; \
		eval "$$@" 2>&1; RC=$$?; \
		if [ "$$RC" -eq 0 ]; then RESULTS="$$RESULTS\n  $(GREEN)PASS$(NC)  $$NAME"; PASS=$$((PASS+1)); \
		else RESULTS="$$RESULTS\n  $(RED)FAIL$(NC)  $$NAME"; FAIL=$$((FAIL+1)); FIXES="$$FIXES\n  $$NAME"; fi; \
	}; \
	run_step  1 "shared build"      "$(COMPOSE) run --rm --no-deps shared npm run build"; \
	run_step  2 "api eslint"        "$(COMPOSE) run --rm --no-deps api npm run lint"; \
	run_step  3 "api prettier"      "$(COMPOSE) run --rm --no-deps api npm run format:check"; \
	run_step  4 "api typecheck"     "$(COMPOSE) run --rm --no-deps api npm run typecheck"; \
	run_step  5 "api tests"         "$(COMPOSE) run --rm --no-deps api npm test"; \
	run_step  6 "api build"         "$(COMPOSE) run --rm --no-deps api npm run build"; \
	run_step  7 "web eslint"        "$(COMPOSE) run --rm --no-deps web npm run lint"; \
	run_step  8 "web prettier"      "$(COMPOSE) run --rm --no-deps web npm run format:check"; \
	run_step  9 "web typecheck"     "$(COMPOSE) run --rm --no-deps web npm run typecheck"; \
	run_step 10 "web tests"         "$(COMPOSE) run --rm --no-deps web npm test"; \
	run_step 11 "web build"         "$(COMPOSE) run --rm --no-deps web npm run build"; \
	echo ""; \
	echo "$(BLUE)════════════════════════════════════════════════════════════$(NC)"; \
	echo "$(BLUE)  Summary: $$PASS/$$TOTAL passed, $$FAIL failed$(NC)"; \
	echo "$(BLUE)════════════════════════════════════════════════════════════$(NC)"; \
	echo "$$RESULTS" | sed 's/\\n/\n/g'; \
	echo ""; \
	if [ "$$FAIL" -gt 0 ]; then \
		echo "$(RED)✗ $$FAIL gate(s) failed — fix before committing:$(NC)"; \
		echo "$$FIXES" | sed 's/\\n/\n/g'; \
		echo ""; \
		echo "$(YELLOW)Common fixes:$(NC)"; \
		echo "  eslint / prettier  →  make format-api  /  make format-web"; \
		echo ""; \
		exit 1; \
	else \
		echo "$(GREEN)✓ All $$TOTAL gates passed — safe to commit & push!$(NC)"; \
		echo ""; \
	fi

# ============================================================================
# DOCKER & UTILITY
# ============================================================================

build-images:
	$(COMPOSE) build shared api worker web

up-prod: output-dir input-dir
	$(COMPOSE) --profile full build api-prod worker-prod web-prod
	$(COMPOSE) up -d --wait db redis
	$(COMPOSE) --profile full run --rm --no-deps api-prod npx prisma migrate deploy
	$(COMPOSE) --profile full up -d api-prod worker-prod web-prod

ps status:
	$(COMPOSE) --profile full ps

clean:
	@echo "$(YELLOW)⚠️  Removes all containers AND volumes — including the DATABASE (saved companies/units).$(NC)"
	@echo "$(YELLOW)   Converted files in $(OUTPUT_DIR_ABS) are kept. Back up first: make db-backup$(NC)"
	@read -r -p "Are you sure? [y/N] " REPLY; \
	if [ "$$REPLY" = "y" ] || [ "$$REPLY" = "Y" ]; then \
		$(COMPOSE) --profile full down -v; \
		echo "$(GREEN)Cleaned.$(NC)"; \
	else echo "$(BLUE)Cancelled.$(NC)"; fi
