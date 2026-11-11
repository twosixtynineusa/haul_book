# CLAUDE.md — Haul Book

Instructions for AI agents working in this repo. Read before editing.

## What this is
A local, single-user portal: ELD/telematics mileage reports (Wialon, Bellfam ELD, HOS 247, Ezlogz and
Motive (trip report + distance summary), Swift ELD and Vista ELD (Excel .xls) built) → ProMiles TRIPSUMMARY2 CSV, one file per company, named by company +
unit #, saved to a host folder (`OUTPUT_DIR` in `.env`) and downloadable. Reports dropped in the
watched input folder (`INPUT_DIR`) convert automatically via a BullMQ worker. The saved company →
unit list, the input-folder inbox and the conversion history live in Postgres 18 (Prisma). A
Companies tab manages the companies, their trucks and each one's approved source; a History tab
lists every converted report, and each truck has a page (`/trucks/<id>`). Open source (MIT, [LICENSE](LICENSE)). Stack, versions
and dev rules: [Tech_Stack.md](Tech_Stack.md). File formats: [docs/data-contracts.md](docs/data-contracts.md).

```
packages/shared/   @haulbook/shared — Zod HTTP contracts + constants (build first; apps use dist/)
apps/api/          NestJS:
  src/conversion/importers/   one Importer per source format (detect + read) — wialon.ts,
                              ifta-mileage-by-state.ts (Bellfam ELD + HOS 247), ezlogz.ts,
                              motive.ts, ifta-spreadsheet.ts (Swift ELD + Vista ELD, .xls)
  src/conversion/xls.ts       in-house reader for legacy Excel .xls (OLE2 + BIFF8): cell values only
  src/conversion/promiles.ts  ProMiles writer (pure): trucks → one CSV per company
  src/conversion/conversion.service.ts  detect → read → company/unit → preview / save + name files
  src/companies/              companies + trucks (Prisma): list, edit, merge, move a truck,
                              approved source (/api/v1/companies)
  src/history/                conversion history (/api/v1/history) + a truck with its history (/api/v1/trucks/:id)
  src/inbox/                  watched input folder: inbox.service.ts (scan → convert → archive),
                              inbox.processor.ts (BullMQ job scheduler), inbox.controller.ts (/api/v1/inbox)
  src/main.ts · src/worker.ts two processes, one image: HTTP api (app.module) + worker (worker.module)
  prisma/                     schema.prisma + migrations (make migrate NAME=…)
apps/web/          Next.js 15, proxying /api/v1/* to the api: Dashboard (src/components/portal.tsx;
                   input folder cards inbox-panel.tsx + inbox-recent.tsx, output-files.tsx),
                   Companies tab (companies-page.tsx, company-detail.tsx, move-truck.tsx), History tab (history-page.tsx)
                   and truck pages (truck-page.tsx); company/unit pickers are combobox.tsx
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
- **Undoing a processed file** (converted / duplicate / dismissed row; `DELETE /inbox/:id`,
  `POST /inbox/:id/reprocess`): delete removes the row **and what it produced**: its ProMiles
  file(s) and `conversions` rows (`ConversionService.forget` → `HistoryService.forget`), by the
  owner's decision (2026-11-11). Reprocess moves the source back out of `archive/` (or
  `failed/`) into the input folder, forgets the same way, and converts it again in place (same
  row), with any `SourceChoice` sent as the user's entry. The row is claimed (`processing`)
  before the file moves, so a scan never takes it for a new file. Forgetting puts each truck
  back: its latest activity from what's left of its history, and a saved odometer that
  conversion wrote back to the reading it began from, so converting again starts at the same
  Begin Odo. The archived source is still never deleted.
- Company precedence: user entry → the file → company subfolder → the single saved company with
  that unit # (all of them, for a file with several trucks). Several such companies → the file
  `needs: company` with `companyOptions`; never pick one silently. (ConversionService does the
  unit lookup for the portal too; the inbox passes the subfolder as a hint, not as the user's entry.)
  Same SHA-256 as an already-converted file → `duplicate`, archived, not converted — unless the
  trucks it was converted for were deleted since (their `conversions` rows lost their truck
  link; merges keep it): then it converts again, only for the deleted trucks of a file with
  several (never the ones still converted).
- **UI wording:** the portal says **truck** / "Truck #" for a saved truck's number. "Unit" stays
  in the ProMiles CSV, output file names (`_unit-22_`), the API, the database and the docs.
- **Dashboard:** folder paths and `archive/…` paths are not printed on the page (the owner found
  them confusing, 2026-11-11). Each folder card has a folder button whose tooltip shows the path
  and whose click copies it. Files waiting for input show in a "Waiting for you" card on top,
  only while there are any; the Input folder and Output folder cards sit under the upload steps.
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
  - POSIX shell only: no `read -n`, no bash-isms. **No backslash escapes inside `$(shell …)`**
    (GNU make for Windows drops them there: `printf '\033'` prints `033`): colours are literal
    ESC bytes in the Makefile, `\#` for `#`, `tr -d '[:cntrl:]'` for CRs. Everything make prints is
    plain ASCII (Windows consoles garble the rest). On Windows, `BUILDX_BAKE_ENTITLEMENTS_FS=0`
    (Compose no longer honours `COMPOSE_BAKE=false`).
  - Quote every host path (Windows paths have spaces), and pass host paths to docker as
    `$(ROOT)` / `*_DIR_ABS`, never `$(CURDIR)`/`$(pwd)`. On Windows they're `C:/…` (`host_path`).
  - Keep `MSYS_NO_PATHCONV`, `.gitattributes` (LF, byte-exact fixtures) and polling watchers.
  - **No admin rights on Windows** beyond the one-time Docker Desktop install: per-user Git and
    make (`winget … --scope user`), the project under the user folder. Never add a step that needs
    an elevated prompt.
  - Never add a PowerShell twin of the Makefile. `make.bat` (CRLF) only relaunches `make` in Git
    Bash; keep all logic in the Makefile. The Windows guard must stay before any `$(shell …)`
    and its message plain ASCII.
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
- **Several trucks per file** (Motive): the importer returns `SourceReport.trucks`; the file gets
  `units` (and `unit: null`), each truck becomes its own `TruckReport` with the file's unit #, and
  a typed unit # is ignored. In the input folder the company is the one saved company running all
  of them. Never merge two vehicles' miles into one truck.
- **Dateless files** (Motive's distance summary): the importer returns `needsPeriod` (and a
  `suggestedPeriod`) until `SourceChoice.period` is given; the file `needs: period`. Never convert
  one with a guessed period. It becomes one trip per truck for the period, inside one quarter.
- **Source approval:** each company has **one** approved source format (`Company.source`). Its
  first conversion sets it; a saved company's file in any other format `needs: source` and waits
  (portal and input folder alike) until the user sends `confirmSource`, which converts it and
  makes that format the approved source, **replacing** the old one. Never convert a source
  switch silently. A company with none yet (added by hand) takes whatever converts first; within
  one upload, its first file's format counts as approved for the rest.
- **History:** every saved conversion writes `conversions` rows (HistoryService.record, after
  CompaniesService.record), one per truck per source file. Names are kept as written; the
  company/unit links follow merges and go null on delete. Never write history for a preview.
- **Shared layouts:** when several sources export the same layout, `detectFormats` returns them
  all and the file gets `formatOptions`. The company's approved source settles it when it's exactly
  one of them; otherwise it `needs: format`. Never silently pick the first match.
- Companies match case/spacing-insensitively (`companyKey`); odometers are keyed per truck
  (`truckKey(company, unit)`) because unit #s repeat across companies.
- **Excel sources** (Swift ELD, Vista ELD): read with `conversion/xls.ts` (legacy .xls only, values
  only, no library). Their made-up fixtures are built in code (`test/helpers/ifta-report.ts` via
  `xls-writer.ts`), never copied from a real export. Keep the writer and reader in step.

## Converter rules (don't regress)
- Input is the **raw** Wialon export (`;`-delimited, Windows codepage, numbered month → state →
  crossing rows). The unit # comes **only from the file name**. Never accept the old hand-edited
  comma format again. `apps/api/test/fixtures/` holds a sample raw export (made-up trips in the exact Wialon
  format, Windows-1251 + CRLF) plus the golden ProMiles file it must reproduce byte for byte;
  keep that test green. Never replace fixtures with real customer exports.
- One file per company; one trip per truck per month; legs come from the state rows (crossing rows are skipped); the
  odometer carries forward across months.
- Begin Odo precedence: the reading typed for the truck (carried forward) → the trip's own
  odometer when the source records one (`PeriodTrip.odometer`, Motive; the next trip carries on
  from its end) → its saved odometer (`Unit.odometer`, only when the first trip starts after
  `odometerAsOf` and has no file odometer) → `1`. Only real readings are saved (never the
  placeholder), and a save never replaces a later period's reading.
- ProMiles rejects a trip unless **columns A–I** are all filled, so Begin Odo is never blank
  (`DEFAULT_BEGIN_ODO = '1'`).
- A state row's Mileage goes in column H; ProMiles Toll Distance is always `0`.
- Output is LF-terminated, no BOM, 12 columns, matching ProMiles' example file.
- Output files are named `<Company>_unit-<N>_<YYYY-MM>.csv` and never overwritten (`_2`, `_3`, …). The only code that
  deletes one is `ConversionService.forget` (an input-folder row deleted or converted again). Downloads only serve names matching
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
