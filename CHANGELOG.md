# CHANGELOG — Haul Book

Shipped work, newest first.

## 2026-11-11 — ProMiles unit # per truck; in-app confirm dialog
- **Each truck has a ProMiles unit #** (`Unit.promilesUnit`, migration `promiles_unit`): the unit
  # written to column A of the ProMiles CSV, when it differs from the truck # in the source
  (Motive's `Volvo 01` → `2011`). Files still match trucks by their truck #; odometers and
  history go by it too. docs/data-contracts.md §2 is now v2.
  - **A new truck always waits** for its ProMiles unit # to be confirmed (`needs: promilesUnit`,
    `SourceFile.newTrucks`, `SourceChoice.promilesUnits`), the owner's choice. In the portal the
    field is filled in with the truck's own # (shown under the file, editable) and Convert & save
    confirms it. In the input folder the file waits in **Waiting for you**, with the field.
  - Every conversion saves the ProMiles unit # it used on the truck, so later files convert
    without asking. Existing trucks are unchanged (their ProMiles unit # is their own number).
  - **Two trucks of one company never share a ProMiles unit #:** a file that would is refused
    with the clash named; a truck add or edit, a move and a company merge get 409.
  - **File names show both** when they differ: `ACME-TRUCKING-LLC_unit-2011_from-Volvo-01_2026-10.csv`
    (the owner's choice). The History tab and truck page show it under the truck #
    (`conversions.promiles_unit`, as written), and the trip review shows it per truck.
  - Companies tab: a **ProMiles unit #** column and field (blank = the same as the truck #); the
    truck page shows and edits it too; both searches find it.
- **The app asks in its own dialog instead of the browser's** (`useConfirm`,
  `components/confirm-dialog.tsx`; texts in `lib/confirm.ts`). Deleting a truck, a company or
  an input-folder file, merging, moving a truck, converting again and switching a company's
  source now list **exactly what goes** (the truck with its ProMiles unit #, its saved odometer
  and details; the company's trucks; the ProMiles file names and history entries) and **what
  stays** (history, files already written, the original report). Deletes use a red button with
  Cancel focused; Escape or a click outside cancels.
- Specs: new trucks waiting and confirmed (input folder, portal), the CSV and file name, the
  clash refusal, truck edits, move and merge guards; web tests for the confirm texts and the
  ProMiles unit # helpers. Existing specs now save or confirm their trucks first.

## 2026-11-11 — Undo a processed input-folder file; cleaner Dashboard
- **Delete, convert again or correct a processed file** from the Dashboard's Input folder card
  (converted, duplicate or set-aside rows):
  - **Delete** (`DELETE /api/v1/inbox/:id`) removes the row **with the ProMiles file(s) and
    history entries it produced** (owner's decision: nothing it wrote is kept). The same file
    can then be dropped and converted again. A duplicate or set-aside row produced nothing, so
    only the row goes.
  - **Convert again** (`POST /api/v1/inbox/:id/reprocess`) moves the source back out of
    `archive/` (or `failed/`) into the input folder and converts it in place, through the same
    checks as a new file; it can end up waiting for input. What it produced before is replaced
    (the freed ProMiles file name is reused, not `_2`).
  - **Correct** sends a `SourceChoice` with the same call: a changed company, truck #, source
    format or period is the user's entry for the new conversion.
  - The archived source is never deleted. A file whose archived source is gone can't be
    converted again (400, row untouched); a file still in the input folder is refused (400).
- **Forgetting a conversion puts its trucks back** (`ConversionService.forget` →
  `HistoryService.forget`): a truck's latest activity becomes what's left of its history
  ("Never" when nothing is), and a saved odometer that conversion wrote goes back to the
  reading it began from, as of the day before. So converting a report again starts at the same
  Begin Odo instead of `1`. This is the only code that deletes an output file.
- **Dashboard redesign.** The folder paths, the "checked every 30s … moved to archive/" text
  and the `Source → archive/…` lines are gone from the page.
  - Files that need input show in a **Waiting for you** card at the top, only while there are
    any.
  - The upload steps come first; under them the **Input folder** and **Output folder** cards
    sit side by side (stacked on a narrow window), each with an icon, a one-line description
    and status badges. A folder button on each shows the path in its tooltip and copies it.
  - Input folder rows show the file name, company · truck · time, a status badge and the
    actions; the correction form opens under the row.
  - The "Convert & save" step names the saved files instead of printing full paths.
- Specs: delete (with a duplicate), convert again with a corrected company, the odometer
  put back, a set-aside file brought back, refusals; web tests for the confirm texts.

## 2026-11-11 — Move a truck to another company
- **Move a truck** from the Companies tab (the arrows button on its row) or its page ("Move"):
  pick another saved company, confirm, and the truck goes there with its saved odometer, VIN,
  plate, notes, last source / period / converted date, and its conversion history (the rows'
  company link follows; the names as written stay). `POST
  /api/v1/companies/:id/trucks/:truckId/move { into }` → `TruckMoved` (both companies, the
  truck's id where it landed, whether it was merged).
  - **Into a company that already has that truck #:** the confirm says so, and the two become
    one truck by the company-merge rules (later odometer and activity win, blank details filled,
    both histories kept). That fold is now one helper (`foldTruck`) shared by merges and moves.
    The truck page then opens the kept truck.
  - The company it joins takes the truck's last source when it has no approved source yet; the
    one it leaves keeps its own. Moving into the same company (409), an unknown one (404) or
    without `into` (400) is refused.
  - A move is not a delete: a file converted for the truck, dropped again, is still a
    `duplicate`.
  - Specs: plain move, move onto an existing truck #, refusals, and the inbox duplicate after a
    move; web: the confirm text.

## 2026-11-11 — Re-drop a file after deleting its truck; "Truck #" in the portal
- **Fixed: a file dropped again after its company or truck was deleted converts again.** It
  used to come back as `duplicate` forever, because the check matched any earlier converted
  file with the same SHA-256. Now an earlier conversion only counts while its trucks exist:
  the history rows it wrote (`conversions`, matched by source + output file) lose their truck
  link on a delete and keep it through merges.
  - A file with several trucks (Motive) where only some were deleted converts again **only for
    those trucks**, into a new ProMiles file (`ConvertOptions.onlyUnits`); the trucks still
    converted are never written twice. When nothing else names the company, the one running
    the file's other trucks is used.
  - Files converted before the history existed (before 2026-11-07) stay duplicates.
  - Portal uploads never had a duplicate check, so nothing changed there.
  - Specs: deleted company, deleted truck (and not after a merge), Motive with one truck deleted.
- **The portal says "Truck #" instead of "Unit #"** (tables, forms, search boxes, the
  input-folder card, confirms, "Company & truck", and the "enter the truck #" / "already has
  truck" messages). The ProMiles CSV, output file names (`_unit-22_`), the API and the docs
  still say unit.
- ROADMAP: **move a truck to another company** with its odometer and history, merging into the
  new company's truck of the same number.

## 2026-11-07 — Swift ELD and Vista ELD importers (Excel .xls)
- **Swift ELD and Vista ELD are built sources**: the "IFTA Report" Excel workbook
  (`IFTA_Report*.xls`, `importers/ifta-spreadsheet.ts`, docs/data-contracts.md §6, v1). Labels
  "Swift ELD — IFTA Report (Excel)" and "Vista ELD — IFTA Report (Excel)". Every provider with a
  sample export is now built; the placeholder importers (`placeholders.ts`) are gone.
  - Both providers export the same workbook, so like Bellfam ELD / HOS 247 the file gets
    `formatOptions: [swift, vista-eld]` and the company's approved source settles it, or the
    user picks.
  - Read from the "All trucks" sheet: company from "Company Name:", one trip per truck for the
    report's period, one leg per state in file order, whole miles (half up), each truck's TOTAL
    row kept as the report total. Several trucks per file convert as separate trucks.
  - All 9 real samples (2 Swift ELD, 7 Vista ELD; kept locally, not in the repo) convert without
    warnings.
- **`conversion/xls.ts`: an in-house reader for legacy `.xls`** (OLE2 compound file + BIFF8
  records: shared strings across CONTINUE records, LABEL, NUMBER, RK, MULRK, BOOLERR, FORMULA
  results), values only. No spreadsheet library was added. Modern `.xlsx` still can't be read
  (ROADMAP).
- **Tests:** a test-only `.xls` writer (`test/helpers/xls-writer.ts`) builds a made-up workbook
  laid out cell for cell like the real export (`test/helpers/ifta-report.ts`), with a
  hand-derived golden ProMiles file; specs for the reader (every record type, strings split
  mid-CONTINUE, the mini stream, refusals) and the importer (detection, one and several
  trucks, km column, multi-month warning, eight broken files); an e2e case for the pick and
  the approved source settling the next file. The "importer not built yet" tests now pick a
  format that can't read the file.

## 2026-11-07 — Motive distance summary, one approved source, matching by unit #, history
- **Motive's distance summary converts** (`…distance_summary_by_vehicle.csv`), alongside the trip
  report detail. Both are the `motive` source (label "Motive — IFTA Trip Report or Distance
  Summary"); docs/data-contracts.md §5 is now v2 (5a detail, 5b summary).
  - The summary has no dates, so the file `needs: period` until the user gives the dates it
    covers (`SourceChoice.period`, inside one quarter). The month before its export timestamp is
    offered in one click (`suggestedPeriod`), never used on its own. Input-folder files wait the
    same way (new inbox columns `period_begin` / `period_end`).
  - One trip per truck over the period; one leg per state in file order, whole miles (half up).
  - The ProMiles writer's "same month in two files" check now covers every month a trip spans.
  - The real summary sample (16 states) converts without warnings once a period is given.
- **HOS 247** is written with a space everywhere (labels, docs, messages). The id stays `hos247`.
- **One approved source per company** (`Company.source`, replacing the `sources` list; migration
  `single_source_and_history`). Each company kept the source it was approved for last.
  - Confirming a file from another source makes that source the approved one, **replacing** the
    old: files from the old source now wait for confirmation.
  - Within one upload, a company with no source yet takes its first file's format; other formats
    for it wait for confirmation.
  - The Companies tab shows a single "Approved source" drop-down; picking another replaces it
    (after a confirm).
- **Company from the unit #, in the portal too.** A file with no company of its own (after the
  input subfolder) takes the one saved company running its unit # (every unit #, for a file with
  several trucks), marked "by unit #". When several companies run it, the file `needs: company`
  with `companyOptions` listing them, and the portal asks which. A file nothing recognises is
  tried as its company's approved source (company typed, from the subfolder, or matched from a
  typed unit #). `SourceFile.companyDetected` became `companyOrigin` (`user`/`file`/`folder`/`unit`).
  - The inbox now passes its subfolder as a hint after the file's own company, as CLAUDE.md says
    (it used to override it).
- **Company and unit # pickers are drop-down lists you can also type in** (`combobox.tsx`), in the
  upload step and the input folder card: the arrow shows every saved company (with its approved
  source and truck count) or the company's trucks (every saved truck, with its companies, when no
  company is set); typing narrows the list, and a new value is kept as typed.
- **Conversion history.** Every saved conversion (portal or input folder) is logged in Postgres
  (`conversions`), one row per truck per source file: company, unit #, source, file names, date
  range, Begin and End odometer, total miles and each trip. Links follow company merges and go
  null on delete; the names stay as written.
  - **History tab** (`/history`): newest first, searchable, a row opens its trips, download link.
  - **Truck page** (`/trucks/<id>`), opened by clicking a unit # on the Companies or History tab:
    company and approved source, details (editable), totals (reports, miles, dates covered, latest
    end odometer) and every report converted for the truck.
  - API: `GET /api/v1/history`, `GET /api/v1/trucks/:id` (`contracts/history.ts`).
  - History starts with this version; earlier conversions aren't listed.
- **Tests:** a made-up distance summary fixture and its hand-derived golden ProMiles file; specs for
  the summary (needs period, suggestion, golden output, broken files); e2e and input-folder cases
  for the period, unit-# matching and the several-companies question; single-source cases; a new
  history integration spec; web cases for the pickers, periods and history helpers.

## 2026-11-07 — Automatic daily updates
- **`make update`**: `git fetch`; when the branch's remote has new commits, `git pull --ff-only`,
  then `make down`, `make rebuild` and `make up`. With no new commits nothing is pulled or rebuilt,
  and it only runs `make up` so the portal is running.
  - It refuses to pull, and says why, over uncommitted changes, local commits (a diverged
    branch), or with no upstream branch. In each case the portal keeps running.
  - It never prompts (`GIT_TERMINAL_PROMPT=0`; SSH in batch mode unless `GIT_SSH_COMMAND` is
    set), so a scheduled run can't hang.
  - `DRY_RUN=1` prints what it would do.
- **`make schedule-setup`** runs `make update-scheduled` (that's `make update`, logged to the
  git-ignored `update.log`, last 5000 lines kept) daily at 3 am, as the logged-on user, no admin.
  `make schedule-remove` undoes it.
  - Windows (Git Bash): a Task Scheduler task, "Haul Book update", running `make.bat`.
  - WSL: the same Windows task, running make through `wsl.exe` (cron in WSL only runs while WSL is
    open).
  - Linux/macOS: a tagged crontab line. Re-running replaces it, and other cron jobs are kept.
- All the logic is in the Makefile, so there's no separate batch or PowerShell script (CLAUDE.md).
- Checked here:
  - every `make update` path in scratch clones: behind and clean (pull + down, rebuild, up), up
    to date, uncommitted, diverged, no upstream;
  - the three `schedule-setup` branches, against stand-in `schtasks`/`crontab` commands.
  - Not yet run on a real Windows Task Scheduler (MANUAL_TODO §C).

## 2026-11-07 — Motive importer, several trucks per file, odometers from the file
- **Motive is a built source**: the IFTA trip report detail by vehicle
  (`…trip_reports_detail_by_vehicle.csv`, `importers/motive.ts`, docs/data-contracts.md §5, v1).
  The picker calls it "Motive — IFTA Trip Report". Swift ELD and Vista ELD stay placeholders (§6).
  - One trip per truck per month, from its rows in odometer order (the file is newest first),
    one leg per state in order of first entry, whole miles (half up).
  - Motive's distance summary is recognised but refused: it has no dates. The message says to
    export the trip report detail instead.
  - Warnings for odometer jumps of more than 10 mi with no state row (miles in no state) and
    for manual odometer edits.
  - The six real Motive trip reports (kept locally, not in the repo) convert. One warns about a
    real week-long odometer gap.
- **A file can hold several trucks.** Importers may return `SourceReport.trucks`. Each truck
  converts on its own with the unit # the file gives it, and they share one ProMiles file per
  company (`ACME-TRUCKING-LLC_units-Volvo-7-31_2026-10.csv`).
  - `SourceFile.units` and inbox `units` list them. New inbox column `units` (migration
    `inbox_units`).
  - The portal and the input folder show the unit #s read-only, and a typed unit # is ignored.
  - In the input folder, the company is the one saved company running every truck in the file.
- **Begin Odo from the file.** A trip can carry the source's own odometer
  (`PeriodTrip.odometer`, `TripSummary.fileOdometer`). The new precedence is typed reading →
  the file's reading → the saved one → `1`. The next trip carries on from the file's end
  reading, which is also what's saved for the truck's next conversion. The review table shows
  "From the file", and its total column now says "Report total" instead of "Wialon total".
- **Tests:**
  - a made-up two-truck fixture with a hand-derived golden ProMiles file;
  - a spec for detection, odometer order, Begin Odo precedence, CRLF/km, both warnings, the
    summary refusal and six broken files;
  - e2e and input-folder cases for a two-truck file;
  - a web case for the Begin Odo preview.
  - The "importer not built yet" tests now use Swift ELD.

## 2026-11-07 — Source names match the providers' registered names
- Source labels now use each provider's name as registered on FMCSA's ELD list
  (eld.fmcsa.dot.gov): **Ezlogz** (Ezlogz Inc; was "EZLogz"), **Swift ELD** (Swift ELD, not
  the carrier Swift Transportation; was "Swift") and **Bellfam ELD** (Bellfam, bellfameld.com; was
  "BELLAMSP-ANIR", confirmed by the owner). HOS247 (HOS247 LLC), Motive (Motive
  Technologies, Inc.) and Vista ELD already matched.
- Only the labels changed: the source ids (`ezlogz`, `swift`, …) are stored in Postgres as each
  company's approved sources and stay as they are: `bellamsp-anir` is Bellfam ELD.

## 2026-11-07 — EZLogz importer
- **EZLogz is a built source**: the "Mileage Report" CSV (`importers/ezlogz.ts`,
  docs/data-contracts.md §4, now v1). The source list calls it "EZLogz — Mileage Report"; Motive,
  Swift and Vista ELD stay placeholders (§5).
  - Detected by its `State,Miles` first line plus a `Total distance:` line.
  - The unit # comes from the Units section. The file has no company, so it comes from the user,
    the input subfolder or the single saved company with that unit #, as for Wialon.
  - The daily rows make **one trip per month**, from the first to the last day driven, with one
    leg per state in order of first entry. Miles are rounded to whole miles (half up), and the
    month's exact daily totals are kept as the report's total.
  - A warning when the unit's state totals and the daily rows disagree.
  - Refused: a file with several units (its daily rows don't say which unit drove them; EZLogz
    writes the state in their Unit column), no daily rows, unknown states, bad dates or miles.
  - The four real EZLogz samples (kept locally, not in the repo) are detected as EZLogz only and
    convert without warnings.
- **Tests:** a made-up fixture in the exact format (`Mileage_Report.csv`, a team truck with two
  drivers) with a hand-derived golden ProMiles file, plus a spec for detection, month split,
  CRLF, rounding, the cross-check warning and seven refusal cases.

## 2026-11-07 — Windows: the real Bake fix, no admin rights needed
- **`make setup` still stopped** with "additional privileges requested: pass
  --allow=fs.read=apps\\web\\Dockerfile". `COMPOSE_BAKE=false` (previous entry) had no effect: current
  Docker Compose always builds through buildx Bake and no longer reads that setting.
  - The Makefile now sets buildx's own switch on Windows, `BUILDX_BAKE_ENTITLEMENTS_FS=0`. buildx's
    error text names that switch for exactly this check.
  - The message is about a Docker *build* permission (Bake misreads the Windows Dockerfile path as
    outside the project), **not Windows administrator rights**.
  - Builds with the switch set were checked here; the Windows run itself is still to be
    confirmed.
- **No administrator rights, except Docker Desktop's one-time install.**
  - README Windows route A says so up front: an administrator installs Docker Desktop and adds
    the user to `docker-users`; the user does everything else.
  - Git and make install with `winget … --scope user`.
  - Without winget there's a manual path that needs no admin either: Git for one user, and the
    make zip in `%LOCALAPPDATA%` added to the user `Path`. It replaces the Chocolatey hint, which
    needs admin.
  - The project goes under the user folder, since folders directly on `C:\` can need admin.
  - Installing WSL (route B) is marked as needing admin.
  - CLAUDE.md: never add a Windows step that needs an elevated prompt.

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
