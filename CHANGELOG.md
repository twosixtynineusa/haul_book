# CHANGELOG — Haul Book

Shipped work, newest first.

## 2026-11-07 — Windows: make setup builds, clean output
Found on the first real Windows run (cmd → `make.bat` → Git Bash → GNU make for Windows):
- **`make setup` failed while building the images:** Docker Compose's default "Bake" builder
  stopped with "additional privileges requested: pass --allow=fs.read=apps\\web\\Dockerfile". The
  Makefile now sets `COMPOSE_BAKE=false` on Windows, so Compose uses its classic builder.
  Linux, macOS and WSL keep Bake.
- **The help showed `033[0;34m` instead of colours:** GNU make for Windows drops the backslash
  inside `$(shell …)`, so `printf '\033…'` printed `033…`. That same bug silently broke the hidden
  `\r` and `\043` helpers.
  - Colours are now literal ESC bytes in the Makefile.
  - `#` comes from make's own `\#`.
  - CRs in `.env` are stripped with `tr -d '[:cntrl:]'`.
  - No `$(shell …)` contains a backslash any more.
- **`â€”` / `â†’` in the output:** everything make prints is now plain ASCII (`-`, `->`, `OK`,
  `WARNING:`). The `make ci` summary no longer depends on `\n` escapes, and `make.bat` no longer
  switches the console's code page.
- Not yet re-run on Windows; the fix was checked by simulating Windows paths and `.env` CRLFs.

## 2026-11-07 — BELLAMSP-ANIR and HOS247 importers, every sample provider listed, make from cmd
- **Source list = the providers with sample exports.** Wialon, **BELLAMSP-ANIR** and **HOS247** are
  built; **EZLogz, Motive, Swift, Vista ELD** are placeholders (listed as coming soon). The `ez-logs`
  placeholder id is now `ezlogz`, and "Motive Fleet" is "Motive" (nothing had been saved under them).
- **BELLAMSP-ANIR and HOS247 importers: the "IFTA Mileage By State" CSV**
  (`importers/ifta-mileage-by-state.ts`, docs/data-contracts.md §3). Both providers export this
  identical layout, so one reader serves two separate sources.
  - The company comes from the `Carrier:` line, the unit # from the vehicle row (or the file name).
  - The `Period:` becomes one trip, with one leg per state in file order.
  - Miles are rounded to whole miles (half up), and the exact sum is kept as the report's total.
  - Warnings for a period longer than a month or several vehicles in one file.
  - Converts to the same ProMiles TRIPSUMMARY2 file as Wialon, e.g.
    `ACME-TRUCKING-LLC_unit-7_2026-10.csv`.
  - The real BELLAMSP-ANIR and HOS247 samples (kept locally, not in the repo) convert without
    warnings.
- **Files several sources could be from.** Detection now returns every match (`detectFormats`).
  - A file in a shared layout gets `formatOptions`.
  - If its company was converted from exactly one of them before, that one is used.
  - Otherwise it waits for the user to pick (portal and input folder), with "This layout is
    exported by either BELLAMSP-ANIR or HOS247". The pick approves that source for the company,
    so its next files go straight through.
  - New inbox column `format_options` (migration `inbox_format_options`).
- **Tests:**
  - a made-up fixture in the exact format and a hand-derived golden ProMiles file;
  - a spec for detection (both sources), reading, rounding, file-name fallback, CRLF, warnings
    and six refusal cases;
  - e2e: pick, then automatic for that company, plus the source-switch confirmation;
  - inbox: a held file is picked as HOS247 and the company's next file converts on its own;
  - web: the pick message.
- **Windows: `make` works from cmd.** Running `make` in Command Prompt used to print
  `CreateProcess(NULL, printf …) failed` twice and a garbled `ΓåÆ` in its stop message.
  - The Windows check now comes before any `$(shell …)` and its message is plain ASCII.
  - New `make.bat` (CRLF, kept that way by `.gitattributes`) starts the real `make` inside Git Bash
    from cmd (`.\make` in PowerShell), switching the window to UTF-8 while it runs.
  - All logic stays in the Makefile.

## 2026-11-07 — Made-up Wialon test fixture
- **The real Wialon export is gone from the tests.** It was one real truck's October 2026
  route. `apps/api/test/fixtures/22_IFTA_Single_Unit_Mileage_Report_…csv` is now a made-up
  report: an invented 10-state loop (TX → OK → KS → MO → IL → IN → OH → KY → TN → AR), 3,618
  state miles against a 3,619-mile month total (Wialon rounds them separately).
  - It keeps Wialon's exact raw format: the original Windows-1251 `№` header bytes, quoted
    `;`-separated cells with a trailing `;`, CRLF, month → state → crossing rows (some crossings
    with decimals), and the same file name, so the unit # still comes from it.
- **The golden file is hand-derived from the format rules,** not taken from the converter's own
  output, so the byte-for-byte test still checks the converter. Its layout is identical to the
  file FuelTaxOnline accepted on 2026-11-06.
- The Wialon importer, writer and inbox specs now assert the new totals and leg order.
- Docs (data contracts, CLAUDE.md, MANUAL_TODO) no longer describe the fixture as a real export.
  CLAUDE.md adds a rule: never replace fixtures with real customer exports.

## 2026-11-07 — Ready for a public repository (MIT)
- **MIT license** (`LICENSE`); the packages' `license` fields say MIT (they stay `private`, so
  nothing is published to npm). The README states it and that Haul Book isn't affiliated with
  ProMiles, Wialon or any ELD provider.
- **Published** as the public repository https://github.com/twosixtynineusa/haul_book (initial
  commit on `main`); the README clone URLs point to it.
- **`.gitignore` keeps out everything private:**
  - `.env`, converted files (`output/`), the watched folder (`input/`), database backups;
  - real ELD exports and screenshots next to the project (`/*.csv`, `/*.xls(x)`, `/*.png`,
    `/*.txt`, `New folder/`, `samples/`).
  `.dockerignore` matches it.
- **Tech_Stack.md rewritten as a public document:** decisions, layout, versions, ports, the
  Docker-first `make` workflow, Windows support, the CI gate. It no longer describes the private
  house template or infrastructure.
- **Docs:**
  - CLAUDE.md has the layout with the Companies tab and a "public repo, no customer data" rule;
  - the README's clone folder is `haul_book`;
  - MANUAL_TODO is generic about the owner and the local sample exports, and lists what's left
    before pushing (the Wialon fixture decision, the commit itself, the repo URL).

## 2026-11-07 — Renamed to Haul Book
The project grows beyond IFTA mileage, so it is now **Haul Book** (it was "Fuel Tax Portal").
- **App and docs:** the title in the portal, the README, all docs and comments.
- **Packages:** `@haulbook/shared`, `@haulbook/api`, `@haulbook/web` and the root `haul-book`
  (they were `@fueltax/*`); lockfiles regenerated.
- **Docker:** compose project `haul_book` (was `fueltax_portal`), so images and volumes are new.
  - Postgres role and database `haulbook` / `haulbook_test` (was `fueltax`), in compose, CI and
    the env default.
  - The saved companies, trucks and inbox were copied from the old database into the new one
    (`make db-backup` against the old volume, then `make db-restore`). The old `fueltax_portal_*`
    volumes are left in place (MANUAL_TODO §A).
- **Example folders** in the docs are `HaulBook/…`.
- **Unchanged:** ProMiles' own names, **FuelTaxOnline** and `multifleetfueltax.promilesonline.com`.
- **Makefile:**
  - the database name is one `DB` variable;
  - `make db-backup` starts the database first and never leaves an empty file when it fails;
  - `make db-restore` really replaces the database (it used to fail on existing tables) and
    takes `F=backup-….sql` without a prompt.

## 2026-11-07 — Companies tab and source-switch confirmation
- **Companies tab** (`/companies`, next to the Dashboard tab):
  - every saved company with its trucks, searchable by company, USDOT #, unit #, VIN or plate;
  - add a company; edit its details (name, USDOT #, IFTA account #, contact, phone, email,
    notes); rename (refused if the name exists, with a pointer to Merge);
  - **merge** two spellings: trucks move across, a shared unit # keeps the later odometer and
    activity, approved sources combine, blank details are filled in;
  - **delete** a company with its trucks;
  - add, edit and delete trucks: unit #, VIN, plate, notes and the saved odometer + as-of date
    (the next conversion starts from it). Each truck also shows its last source, last period end
    and when it was last converted, all filled in by conversions.
- **Source switches are held for confirmation.** Each company has approved source formats; its
  first conversion approves that format. A saved company's file in a different format (the owner
  moved from Wialon to EZ Logs, say) is no longer converted automatically:
  - **input folder:** the file waits as "needs input" with a "Different source" warning and a
    **Confirm & convert** button; the Input folder card on the Dashboard also shows a banner
    listing the switches;
  - **portal upload:** the file shows the warning with a **Confirm** button, and conversion is
    refused until it is confirmed;
  - confirming converts the file and approves the new format, so later files from it convert
    on their own. Approved sources can also be added or removed on the Companies tab.
- **Database** (migration `company_management`):
  - company details and `sources`; truck VIN, plate, notes, `last_source`, `last_period_end`,
    `last_converted_at`; inbox `known_sources` and `confirm_source`;
  - existing companies and trucks were backfilled with Wialon, the only source used so far.
- **API:**
  - `GET /api/v1/companies` now returns full companies with `trucks[]` (it used to return
    `units: string[]`);
  - new `POST /companies`, `PATCH/DELETE /companies/:id`, `POST /companies/:id/merge`, and
    `POST /companies/:id/trucks`, `PATCH/DELETE /companies/:id/trucks/:truckId`;
  - preview files and inbox entries gain `needs: source` and `knownSources`; `SourceChoice`
    gains `confirmSource`.
- **Tests:**
  - Postgres: company CRUD, conflicts, validation, truck edits feeding the odometer, merge, delete,
    source approval and activity;
  - e2e: a held upload, confirm, then automatic;
  - inbox: a held file, confirm, then the next file converts on its own;
  - web: detail and truck diffs, search, date display, the switch warning text.

## 2026-11-07 — Local-only, open source, Windows support
- **Security checks removed** (owner's decision: the app only runs locally, and it is going open
  source). This drops:
  - npm audit, OSV-Scanner, Semgrep, Gitleaks, Trivy and Hadolint from `make ci`, which now runs
    11 gates: lint, prettier, typecheck, tests and builds;
  - `.github/workflows/security.yml` and the `dependency-audit` job in `ci.yml`;
  - `osv-scanner.toml`, `.gitleaks.toml`, the scanner `make` targets and MANUAL_TODO's
    security-hardening section.
  The `deepmerge-ts` override stays; it only pins a dependency version.
- **Local only:** the shared/server (k8s) deployment item is gone from the ROADMAP.
- **Windows support, with or without WSL 2.** The app still runs in the same containers, driven by
  the same `make` commands. There are two routes:
  - **A. Git Bash + native GNU make**, with Docker Desktop on either engine (WSL 2 or Hyper-V).
    Under Windows the Makefile:
    - turns off Git Bash's path rewriting (`MSYS_NO_PATHCONV`), which would otherwise turn
      `/workspace` into `C:/Program Files/Git/workspace`;
    - converts `C:\…` and `/c/…` folder paths to the `C:/…` form Docker Desktop expects;
    - uses uid/gid 1000;
    - prints colours as real escape bytes, since Git Bash's `echo` shows `\033` literally;
    - stops with a pointer to the README when run from PowerShell or cmd.
  - **B. WSL 2 Ubuntu**, which behaves as Linux.
  - On every OS:
    - `.env` values tolerate Windows line endings (CRLF) and quotes;
    - folder paths are resolved in the shell instead of `$(abspath)`, so paths with spaces work;
    - `make clean`'s prompt no longer uses `read -n`, which fails under Ubuntu's `dash`.
  - New `.gitattributes`: LF for every file regardless of `core.autocrlf`, and the byte-exact
    test fixtures are never converted.
  - The API warns only once when it can't hand a file to the host user (which is normal on
    Windows folders), instead of once per file.
  - Path handling was checked by simulating Windows make on Linux; nothing has been run on an
    actual Windows PC yet (MANUAL_TODO §C).
- **README rewritten for open source:**
  - what the app does;
  - installing Docker, make and git on Linux, macOS and Windows (winget, or download links);
  - setup for each OS, including both Windows routes;
  - the folder settings, using it, the input folder, everyday commands;
  - troubleshooting, development and contributing.
  `.env.example` no longer has personal paths.
- **Carrier names anonymized:** the two real carriers named in tests, docs and examples are now
  the fictional **ACME TRUCKING LLC** and **X Y Z FREIGHT LLC** (`ACME` / `XYZ` in short test
  cases). Local data (`input/`, `output/`, the database) is untouched. MANUAL_TODO §D lists what
  is left to settle before publishing: the real Wialon fixture, a license, Tech_Stack.md and the
  repo URL.

## 2026-11-07 — Odometers remembered per truck
- **Each truck's end odometer is saved** in Postgres after a conversion: the begin reading plus
  that upload's miles, as of the last trip's end date. This adds `units.odometer` and
  `units.odometer_as_of` (migration `odometers_per_truck`).
  - It is saved only when the Begin Odo was a real reading, typed or saved, and never when it was
    the placeholder `1`.
  - It never winds back: re-converting an older period doesn't replace a later one's reading.
    The same period, re-converted with a corrected reading, does.
- **The next conversion starts from it.** When no reading is typed for a truck and its first trip
  starts after the saved date, the saved reading becomes Begin Odo and carries forward as before.
  Files from the **input folder** pick it up too, so after one typed reading the chain keeps
  going on its own. A typed reading always wins.
- **Warnings:**
  - a saved reading that isn't before the upload (for example, re-converting the same month) is
    not used;
  - one that leaves unconverted months in between is used, but Begin Odo will be short by those
    months' miles.
- **API contract:** the preview and result now include `savedOdometers`
  (`{ [truckKey]: { reading, asOf } }`): the saved readings this upload uses.
- **Portal:** a truck's Begin odometer input shows its saved reading, with "Saved: end of
  M/D/YYYY", and later months show it carried forward. Typing replaces it.
- **Tests:**
  - writer: saved reading used / typed wins / not-before ignored / gap warning / end readings;
  - Postgres: save, no wind-back, lookup by company spelling;
  - e2e: October then November;
  - inbox: the saved reading is used and updated;
  - web: the `tripOdometers` fallback.

## 2026-11-07 — Watched input folder (automatic conversion)
- **`INPUT_DIR` in `.env`** (default `./input`) is watched every `INPUT_SCAN_SECONDS` (default
  30). The Makefile resolves and creates it, and compose bind-mounts it at `/data/input`. It uses
  polling, not file-system events, because Docker Desktop bind mounts drop inotify events.
- **New `worker` process and Redis 7** (the house split API + worker shape). A BullMQ job
  scheduler `scan-input-folder` runs the scan with concurrency 1, so scans never overlap. The scan
  runs whether or not the portal is open. `make logs-worker` tails it.
- **Each scan:**
  - Picks up a file only once its size and modified time are unchanged between two scans, so it
    has finished copying.
  - Skips `archive/`, `failed/`, dotfiles, Office lock files (`~$…`) and partial downloads
    (`.part`, `.crdownload`, `.download`, `.tmp`).
  - Converts through the same pipeline as a portal upload. The company comes from, in order:
    1. what the user typed in the portal;
    2. the file itself;
    3. a **company subfolder** (`input/ACME TRUCKING LLC/…`), matched to the saved
       spelling;
    4. the one saved company that has that unit #.
  - Converted: the ProMiles file goes to `OUTPUT_DIR` as usual, and the source moves to
    `input/archive/<YYYY-MM-DD>/<same relative path>` (`_2` on a clash).
  - Missing a format, company or unit #: the file stays put and shows in the portal as **needs
    input**. Unreadable files show as **failed** with the reason.
  - A re-dropped identical file (same SHA-256 as one already converted) is archived as a
    **duplicate** and not converted twice. Files taken back out of the folder are forgotten.
- **Inbox in Postgres:** a new `inbox_files` table (migration `20261107022127_inbox_files`).
- **API:**
  - `GET /api/v1/inbox`: the files waiting or needing input, plus the last 25 processed.
  - `PATCH /api/v1/inbox/:id`: set the format / company / unit, then convert and archive at once.
  - `POST /api/v1/inbox/:id/retry`.
  - `POST /api/v1/inbox/:id/dismiss`: move the file to `input/failed/`.
  - `POST /api/v1/inbox/scan`: queue a scan now.
- **Portal:** a new **Input folder** card at the top showing:
  - the watched folder (with a copy button) and a badge counting files that need you;
  - one row per waiting file, with format, company and unit pickers (the saved list) plus
    Convert, Retry and Set aside;
  - a "Recently processed" list with download links and where each source was archived.
  - it refreshes every 10 s and updates the Output folder panel when the worker converts something.
- **Tests:** 9 inbox integration scenarios against Postgres and real temp folders, covering
  subfolder company, waiting for the file to settle, nanosecond mtimes, needs input → resolve, a unique saved unit,
  needs format / unit, a coming-soon format → dismiss, duplicates, ignored files, and input
  validation. A file converted from a company subfolder still matches the golden ProMiles file
  byte for byte.
- **Verified live (2026-11-07):**
  - The raw export dropped in `input/ACME TRUCKING LLC/` converted on its own to
    `ACME-TRUCKING-LLC_unit-22_2026-10.csv`, byte-identical to the golden file, and
    the source moved to `archive/2026-11-07/…`.
  - A root-level copy waited in the portal for a company. Once the company was entered it was
    archived as a duplicate, with no second output.
  - Two bugs were found and fixed: on the host bind mount a nanosecond file mtime did not survive
    the Postgres round trip as a float, so files never "settled" (mtimes are now stored as whole
    ms); and the Inbox card updated the page from inside a React state updater (setState-in-render
    warning).
- New `make sql Q="…"` target: run one SQL statement without a psql prompt.

## 2026-11-06 — Multi-source importers, company / unit list (Postgres 18), per-company output
- **Pluggable source importers** (`apps/api/src/conversion/importers/`):
  - Each dropped file's format is auto-detected. When it isn't recognised, the portal asks the user
    to pick one from a dropdown.
  - **Wialon** is built. **EZ Logs, Motive Fleet and Vista ELD** are placeholders: listed as "coming
    soon", never auto-detected, and they explain that the importer isn't built yet. The work to
    build them is on the ROADMAP.
  - Uploads now accept `.csv`, `.xlsx` and `.xls`.
- **Company + unit # per file:**
  - Taken from the file or its name when present (Wialon: the unit from the name).
  - Otherwise the user types them or picks from a saved list; the user's entry always wins.
  - Conversion is refused until every file has a format, company and unit, and the preview says
    what's missing per file.
- **Saved company → unit list in PostgreSQL 18 (Prisma 6, house default):**
  - Every successful conversion adds its companies and units automatically.
  - Companies match case- and spacing-insensitively, keeping the first spelling.
  - New `GET /api/v1/companies` endpoint.
  - New `db` service, migrations, the scaffold's DB `make` targets (`migrate`, `studio`,
    `shell-db`, `db-backup/restore`), and a Postgres service in CI.
- **Output is one ProMiles file per company,** named by company + unit # + period, e.g.
  `ACME-TRUCKING-LLC_unit-22_2026-10.csv`. It used to be `promiles_2026-10_unit-22.csv`.
  ProMiles imports a file under one customer, so companies are never mixed. File contents are
  unchanged: still byte-identical to the file ProMiles accepted.
- **Odometers are keyed per truck** (company + unit #), so unit 22 at two companies stays separate.
- **API contract:**
  - Preview/convert take a `sources` field (per-file format / company / unit).
  - Preview always returns 200 with per-file `needs`/`error`, cross-file `errors` and `ready`.
  - The result returns `outputs[]` (one per company) in place of `file`.
- **Web:** a new "Company & unit" step (format picker, company and unit pickers backed by the saved
  list, "Use for all files"), a company shown on each trip, and one download per company file.
- **Security:** npm override `deepmerge-ts` ^8.0.0 (api). Prisma 6's `@prisma/config` pins 7.x,
  which has a high advisory (GHSA-ggr8-5vv4-36mx). Prisma generate and migrate were checked
  working with 8.x.

## 2026-11-06 — Convert the raw Wialon export (data contract v2)
- **The input is now the file exactly as Wialon exports it:** the "IFTA Single Unit Mileage Report"
  CSV, e.g. `22_IFTA_Single_Unit_Mileage_Report_11-06-2026_05-16-23_pm.csv`.
  - The format is semicolon-delimited, in the Windows codepage, with numbered month → state →
    crossing rows.
  - The unit # is read from the file name.
  - Each state row becomes a leg; the per-crossing detail rows are skipped.
- **The hand-edited comma format is no longer accepted.** It was a manual intermediate step
  (`1236554.csv`).
- **Verified:** converting the raw export reproduces, byte for byte, the ProMiles file that already
  imported cleanly. Both files are test fixtures (golden test).
- **Multi-month reports:** each month group becomes its own trip, so a quarterly report converts in
  one go. A unit's odometer carries forward from month to month. Output is named
  `promiles_<first>_to_<last>_unit-N.csv`, and the same unit + month uploaded twice is rejected.
- **API contract:** the preview and result now list `trips` (`TripSummary`, with `sourceFile`) in
  place of `units`.
- **Web app:** one review row per trip, showing the source file name. The odometer is entered once
  per unit, and later months show the carried-forward value. The upload hints now describe the
  Wialon report.

## 2026-11-06 — Web portal (v0.1.0)
- **Portal:** Next.js 15 page to drop Wialon CSVs, review units (trip period, states, miles vs
  Wialon total), enter optional Begin odometers, and convert. Each result is saved to the output
  folder and is downloadable. An Output folder panel lists every converted file with download links.
- **API (NestJS 11):** `POST /api/v1/conversions/preview`, `POST /api/v1/conversions`,
  `GET /api/v1/outputs`, `GET /api/v1/outputs/:name`, `GET /api/health`. Uploads are limited to 20
  files of 2 MB each, `.csv` only. Files are never overwritten, and downloads are restricted to plain
  `*.csv` names in the output folder.
- **Output folder** is configured by `OUTPUT_DIR` in `.env` and bind-mounted into the api. Files
  are handed to the host user.
- **Converter ported from the Python CLI to TypeScript** (`apps/api/src/conversion/`). The rules
  are the same and every Python test was ported, plus more. The Python CLI was removed.
- Docker-first scaffold from the house template (Option 1, no DB, queue or worker), with `make ci`
  and the GitHub Actions CI and security workflows.
- Data contracts documented in `docs/data-contracts.md`.
- **Verified end-to-end:** converting `1236554.csv` in the portal produced a file byte-identical to
  the one that had already imported cleanly into ProMiles. `make ci` passes all 17 gates.
- **Dependency security** (fixes for advisories in the npm audit, OSV and Trivy gates):
  - Version bumps: zod 4.6, csv-parse 7, vitest 4.
  - npm overrides: `multer` ^2.5.0 (api, via @nestjs/platform-express), `postcss` ^8.5.23 (web,
    via next), `glob@^13` → ^14 and `minimatch@^10` → ^11 (dev toolchain). Each override is scoped
    to the vulnerable major only.
  - One OSV ignore, `deepmerge` GHSA-gcqx-w48m-w2h4: there's no fixed release, it's dev-only, and
    it's due for review on 2027-02-06 (`osv-scanner.toml`).
  - GitHub Actions are pinned to commit SHAs.
- Lockfiles are generated with npm 11 (`make lock`), because npm 10 crashes resolving vitest 4's
  peers. Dev watchers poll so hot reload works over Docker Desktop bind mounts.

## 2026-11-06 — Begin Odo fix (Python CLI)
- ProMiles rejected the trip row: *"Rows A through I must have a value."* Begin Odo is now always
  filled, with a per-unit reading or the placeholder `1`. The re-import of unit 22 (October 2026)
  succeeded.

## 2026-11-06 — First converter (Python CLI)
- Wialon per-state export → ProMiles TRIPSUMMARY2: one distance-mode trip per unit, state names
  converted to codes, Wialon's "Toll Distance" moved to the distance column, and a check of the
  legs against the total row.
