# Tech Stack — Haul Book

> The stack, versions, ports and development rules. Keep it current whenever a stack setting
> changes. What the app does is in [README.md](README.md); file formats are in
> [docs/data-contracts.md](docs/data-contracts.md).

## 0. Key decisions

| Decision | Choice |
|---|---|
| **Shape** | Next.js web portal + NestJS API + a NestJS **worker** (same image), sharing Zod contracts. Portal conversions are synchronous requests; the worker scans the watched input folder (`INPUT_DIR`). |
| **Database** | **PostgreSQL 18** via **Prisma 6**: companies and trucks (`companies`, `units`), the input-folder inbox (`inbox_files`). Converted files live in `OUTPUT_DIR`, not the database. |
| **Background jobs** | **BullMQ + Redis 7**: one job scheduler, `scan-input-folder`, every `INPUT_SCAN_SECONDS` (default 30 s), concurrency 1. |
| **File storage** | Host folders bind-mounted into the containers: `OUTPUT_DIR` (ProMiles files to import) and `INPUT_DIR` (reports to convert). No object store. |
| **Users / auth** | **None.** A single-user tool on the user's own computer (localhost); no login, no tenants, no roles. |
| **Where it runs** | **Locally only, in Docker** (`make up`) on Linux, macOS or Windows. It is never deployed to a server: each user runs their own copy. |
| **Security scanning** | **None** in `make ci` or CI (no npm audit, OSV-Scanner, Semgrep, Gitleaks, Trivy or Hadolint): it only runs locally and is open source. |
| **Monitoring** | None (no telemetry; `NEXT_TELEMETRY_DISABLED=1`). |
| **License** | MIT ([LICENSE](LICENSE)). |

## 1. Repository layout

Three standalone npm packages, no workspaces. The apps consume the shared package through a
`file:` dependency (`"@haulbook/shared": "file:../../packages/shared"`) and use its built `dist/`.

```
packages/shared/   @haulbook/shared: Zod HTTP contracts, types and constants
apps/api/          @haulbook/api: NestJS HTTP API (main.ts) + worker (worker.ts), Prisma
apps/web/          @haulbook/web: Next.js portal (Dashboard + Companies tabs)
docs/              file-format reference (data contracts)
```

## 2. Components and versions

| Layer | Choice | Version (major) |
|---|---|---|
| Runtime | Node.js (`.nvmrc`), npm | 22, 10 (lockfiles generated with npm 11) |
| Language | TypeScript, `strict: true` | 5.9 |
| Contracts | Zod (shared by api and web) | 4 |
| Web | Next.js (App Router) + React | 15 + 19 |
| Web styling | Tailwind CSS, hand-rolled primitives (`apps/web/src/components/ui.tsx`), lucide-react icons; dark mode follows the OS | 3 |
| API | NestJS (Express), two processes from one image | 11 |
| ORM | Prisma (`prisma migrate`, client generated on install) | 6 |
| Database | PostgreSQL (`postgres:18`) | 18 |
| Queue | BullMQ on Redis (`redis:7-alpine`) | 5 on 7 |
| CSV parsing | csv-parse | 7 |
| Tests | Jest + supertest (api, including Postgres integration specs), Vitest (web) | 29, 4 |
| Lint / format | ESLint 9 (+ typescript-eslint, eslint-config-next), Prettier 3, `.editorconfig` | |

## 3. Ports

| Service | Inside Docker | On your machine (`.env`) |
|---|---|---|
| Web (Next.js) | 3100 | `WEB_PORT` (3100) |
| API (NestJS) | 3000 | `API_PORT` (3000) |
| PostgreSQL | 5432 | `DB_PORT` (5433), for your own database tools only |
| Redis | 6379 | not published |

The browser only talks to the web app: Next.js rewrites `/api/v1/*` to the API container
(same origin, no CORS).

## 4. Development: Docker-first, `make` only

- **The only host tools are `docker`, `docker compose`, `make` and `git`.** Node, npm, npx and
  Prisma never run on the host; every command runs in a container.
- **Source is bind-mounted** at `/workspace`. `node_modules`, `dist` and `.next` live in named
  Docker volumes (seeded by `make setup`, reset by `make rebuild`), so build output never lands
  on the host.
- **`make` is the single entry point.** Never call `docker` / `docker compose` directly. If an
  action has no target, add one to the Makefile first.
  - `make setup` (once) → `make up`;
  - `make restart` applies `.env` changes;
  - `make rebuild` after Dockerfile, compose or dependency changes;
  - `make lock` after editing a `package.json`;
  - `make migrate NAME=…` after editing the Prisma schema;
  - `make help` lists every target.
- **Dev watchers poll** (`WATCHPACK_POLLING`, `TSC_WATCH*`) because Docker Desktop bind mounts
  drop file-system events. The input folder is scanned by polling for the same reason.
- **Output ownership:** the Makefile passes your uid/gid (`HOST_UID` / `HOST_GID`), so files the
  api writes into `OUTPUT_DIR` / `INPUT_DIR` belong to you, not root.
- **Compose profiles:** the default profile is the dev stack (`shared` tsc watcher, `api`,
  `worker`, `web`, `db`, `redis`). `--profile full` adds the production images (`make up-prod`).

## 5. Windows

Two supported routes, both running the same containers and `make` commands:

- **A. Git Bash + GNU make** (`winget install --scope user ezwinports.make`), with Docker Desktop on
  either engine, WSL 2 or Hyper-V. **No administrator rights** except to install Docker Desktop
  once (and add the user to `docker-users`); Git and make install per user.
- **B. WSL 2 Ubuntu**, which behaves as plain Linux (installing WSL needs admin rights).

To keep both working, the Makefile:
- exports `MSYS_NO_PATHCONV=1` under Git Bash;
- turns folder paths into `C:/…` (`host_path`) and passes host paths to Docker as `$(ROOT)` /
  `*_DIR_ABS`;
- strips CRLF and quotes from `.env` values;
- resolves folder paths in the shell so paths with spaces work;
- uses POSIX shell only (Ubuntu's `/bin/sh` is dash);
- never puts backslash escapes in `$(shell …)` (GNU make for Windows drops them there):
  colours are literal ESC bytes, and everything it prints is plain ASCII;
- sets `BUILDX_BAKE_ENTITLEMENTS_FS=0` on Windows: Compose builds through buildx Bake, whose
  file-access check misreads Windows paths ("additional privileges requested:
  --allow=fs.read=…"). It is a build permission, not admin rights;
- refuses to run outside Git Bash with a plain-ASCII message (checked before any `$(shell …)`,
  since cmd has no `printf`). `make.bat` is a launcher that starts `make` in Git Bash, so
  `make <target>` also works from cmd (`.\make` from PowerShell).

`.gitattributes` forces LF line endings and keeps test fixtures byte-exact.

## 6. Quality gate: `make ci`

`make ci` runs, in Docker, exactly what `.github/workflows/ci.yml` runs (keep the two in
lockstep):

1. shared build;
2. api: eslint, prettier, typecheck, tests (against Postgres), build;
3. web: eslint, prettier, typecheck, tests, build.

It must be green before every commit. Stop a running dev stack first (`make down`), because the
web build writes `.next`.

## 7. Configuration

`.env.example` is committed and `.env` is git-ignored; `make setup` creates `.env` from the
example. `docker-compose.yml` maps it onto the containers' environment, which the API reads in
one typed place (`apps/api/src/config/env.ts`). Settings: `OUTPUT_DIR`, `INPUT_DIR`, `INPUT_SCAN_SECONDS`, `WEB_PORT`, `API_PORT`, `DB_PORT`.
