# CLAUDE.md — Haul Book

Instructions for AI agents working in this repo. Read before editing.

## What this is
A local, single-user portal: ELD/telematics mileage reports (Wialon built; EZ Logs, Motive Fleet,
Vista ELD placeholders) → ProMiles TRIPSUMMARY2 CSV, one file per company, named by company +
unit #, saved to a host folder (`OUTPUT_DIR` in `.env`) and downloadable. Reports dropped in the
watched input folder (`INPUT_DIR`) convert automatically via a BullMQ worker. The saved company →
unit list and the input-folder inbox live in Postgres 18 (Prisma). A Companies tab manages the
companies, their trucks and approved sources. Open source (MIT, [LICENSE](LICENSE)). Stack, versions
and dev rules: [Tech_Stack.md](Tech_Stack.md). File formats: [docs/data-contracts.md](docs/data-contracts.md).

```
packages/shared/   @haulbook/shared — Zod HTTP contracts + constants (build first; apps use dist/)
apps/api/          NestJS:
  src/conversion/importers/   one Importer per source format (detect + read) — wialon.ts, placeholders.ts
  src/conversion/promiles.ts  ProMiles writer (pure): trucks → one CSV per company
  src/conversion/conversion.service.ts  detect → read → company/unit → preview / save + name files
  src/companies/              companies + trucks (Prisma): list, edit, merge, approved sources (/api/v1/companies)
  src/inbox/                  watched input folder: inbox.service.ts (scan → convert → archive),
                              inbox.processor.ts (BullMQ job scheduler), inbox.controller.ts (/api/v1/inbox)
  src/main.ts · src/worker.ts two processes, one image: HTTP api (app.module) + worker (worker.module)
  prisma/                     schema.prisma + migrations (make migrate NAME=…)
apps/web/          Next.js 15, proxying /api/v1/* to the api: Dashboard (src/components/portal.tsx) and
                   Companies tab (src/components/companies-page.tsx, company-detail.tsx)
```

## Input folder rules
- The worker is the only scanner (BullMQ, concurrency 1). The api only queues `scan` jobs and
  handles portal edits; both go through `InboxService`, which claims a row (`updateMany` on its
  status → `processing`) before converting, so a file is never converted twice.
- A file is read only after its size + mtime are unchanged across two scans. Never read it on
  first sight. Mtimes are compared as whole ms: a nanosecond float doesn't round-trip through
  Postgres exactly, and the file would never settle.
- Never delete a source file: converted → `INPUT_DIR/archive/<YYYY-MM-DD>/<rel path>`, set aside
  → `INPUT_DIR/failed/`, both never overwriting (`_2`). Files needing input stay where they are.
- Company precedence: user entry → the file → company subfolder → the single saved company with
  that unit #. Same SHA-256 as an already-converted file → `duplicate`, archived, not converted.
- Tests (`test/inbox.integration.spec.ts`) call `InboxService.scan()` directly against temp
  folders and override the queue token, so they need Postgres but not Redis.

## Hard rules
- **Docker-first.** Never run `node`/`npm`/`npx` on the host. **Never call `docker` / `docker compose`
  directly** — only `make <target>`. Missing a target? Add it to the Makefile first.
- **`make ci` must be green before any commit.** It runs every gate in `.github/workflows/ci.yml` (keep
  the two in lockstep). Stop a running dev stack first (`make down`), since `web build` writes `.next`.
- **No security scanners** (npm audit, OSV, Semgrep, Gitleaks, Trivy, Hadolint) by the owner's
  decision (2026-11-07): the app only ever runs locally, and it is open source. Don't add them back.
- **Windows: Git Bash (native GNU make, with or without WSL 2) or WSL 2 Ubuntu.** The Makefile
  must work in all three of Linux/macOS sh, Ubuntu's dash and Git Bash. That means:
  - POSIX shell only: no `read -n`, no bash-isms. Colours are real ESC bytes from `printf`.
  - Quote every host path (Windows paths have spaces), and pass host paths to docker as
    `$(ROOT)` / `*_DIR_ABS`, never `$(CURDIR)`/`$(pwd)`. On Windows they're `C:/…` (`host_path`).
  - Keep `MSYS_NO_PATHCONV`, `.gitattributes` (LF, byte-exact fixtures) and polling watchers.
  - Never add a PowerShell twin of the Makefile.
- **Never `git commit` / `git push` unless explicitly asked in the current turn.**
- **Public repo, MIT.** Never commit customer data: real ELD exports, converted files, `.env`,
  database backups (all git-ignored; see `.gitignore`). Test fixtures must be fictional or
  anonymized; company names in tests and docs are made up (ACME TRUCKING LLC, X Y Z FREIGHT LLC).
- After editing any `package.json`: `make lock` then `make rebuild`.
- Database changes: edit `apps/api/prisma/schema.prisma`, then `make migrate NAME=what_changed`;
  commit the generated migration. Never edit an applied migration.

## Source importers
- A new provider = `importers/<id>.ts` implementing `Importer` (cheap never-throwing `detect`, `read`
  returning period trips + detected company/unit), registered in `importers/index.ts`, with
  `available: true` in `SOURCE_FORMATS` (shared), a real sample fixture + spec, and a section in
  docs/data-contracts.md. See ROADMAP.md → "Source importers".
- Company + unit #: user's entry wins, else what the file carries; otherwise the file `needs` it
  and conversion is refused. Every successful conversion records them (CompaniesService.record).
- **Source approval:** each company has approved source formats (`Company.sources`). Its first
  conversion approves that format; a saved company's file in any other format `needs: source` and
  waits (portal and input folder alike) until the user sends `confirmSource`, which converts it
  and approves the format. Never convert a source switch silently. A company with no approved
  sources yet (added by hand) takes whatever converts first.
- Companies match case/spacing-insensitively (`companyKey`); odometers are keyed per truck
  (`truckKey(company, unit)`) because unit #s repeat across companies.

## Converter rules (don't regress)
- Input is the **raw** Wialon export (`;`-delimited, Windows codepage, numbered month → state →
  crossing rows). The unit # comes **only from the file name**. Never accept the old hand-edited
  comma format again. `apps/api/test/fixtures/` holds a sample raw export (made-up trips in the exact Wialon
  format, Windows-1251 + CRLF) plus the golden ProMiles file it must reproduce byte for byte;
  keep that test green. Never replace fixtures with real customer exports.
- One file per company; one trip per truck per month; legs come from the state rows (crossing rows are skipped); the
  odometer carries forward across months.
- Begin Odo precedence: the reading typed for the truck → its saved odometer (`Unit.odometer`,
  only when the first trip starts after `odometerAsOf`) → `1`. Only real readings are saved
  (never the placeholder), and a save never replaces a later period's reading.
- ProMiles rejects a trip unless **columns A–I** are all filled, so Begin Odo is never blank
  (`DEFAULT_BEGIN_ODO = '1'`).
- A state row's Mileage goes in column H; ProMiles Toll Distance is always `0`.
- Output is LF-terminated, no BOM, 12 columns, matching ProMiles' example file.
- Output files are named `<Company>_unit-<N>_<YYYY-MM>.csv` and never overwritten (`_2`, `_3`, …). Downloads only serve names matching
  `^[A-Za-z0-9][A-Za-z0-9._-]*\.csv$` inside the output folder.
- A format change means updating docs/data-contracts.md (bump the version) and adding a fixture plus a spec case.

## Documentation system (5 docs + docs/)
| File | Job |
|---|---|
| README.md | What it is, quickstart |
| CLAUDE.md | This file |
| ROADMAP.md | Only work **not yet built**; delete items when shipped |
| CHANGELOG.md | Shipped work, dated, newest first; items arrive from ROADMAP |
| MANUAL_TODO.md | Owner-only actions; delete when done and log the outcome in CHANGELOG |
| docs/ | Deep reference (data contracts), one file per topic |
