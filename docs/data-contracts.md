# Haul Book Data Contracts

> Deep reference for every data boundary between this app and something it does not control.
> A "data contract" is the exact, external-owned shape of data we read, query, or produce —
> conform to it or the exchange fails. These are RULES, not tasks: buildable work that USES them
> lives in ROADMAP.md; owner-only actions in MANUAL_TODO.md.
>
> **Status:** verified 2026-11-06 against a real Wialon export, whose converted file imported
> cleanly into ProMiles FuelTaxOnline. The repository's fixture
> `22_IFTA_Single_Unit_Mileage_Report_11-06-2026_05-16-23_pm.csv` (unit 22, October 2026) is a
> made-up report in that exact raw format (codepage, quoting, CRLF, row hierarchy, file name),
> and `promiles_expected_unit22_oct2026.csv` is the ProMiles file it must convert to byte for
> byte, laid out exactly like the accepted one. No real customer data is in the repository.
> **Last verified:** 2026-11-06

| # | Contract | Direction | Consumed by |
|---|---|---|---|
| 1 | Wialon "IFTA Single Unit Mileage Report" export (CSV) | read in | `apps/api/src/conversion/importers/wialon.ts` |
| 2 | ProMiles FuelTaxOnline TRIPSUMMARY2 import (CSV), one file per company | write out | `conversion/promiles.ts`; named + saved by `conversion.service.ts` |
| 3 | "IFTA Mileage By State" export (CSV): Bellfam ELD and HOS247 (same layout) | read in | `importers/ifta-mileage-by-state.ts` |
| 4 | Ezlogz "Mileage Report" export (CSV) | read in | `importers/ezlogz.ts` |
| 5 | Motive · Swift ELD · Vista ELD exports | read in | *placeholders*: `importers/placeholders.ts` (ROADMAP) |

**Format detection:** each uploaded file is offered to every built importer's `detect()` (cheap
header sniffing on the raw bytes). The first match wins; no match means the portal asks the user
to pick the format. The **company** and **unit #** come from the file or its name when the format
carries them (Wialon: unit from the name, no company). Otherwise the user types or picks them from
the saved list in Postgres.

**Watched input folder:** files dropped in `INPUT_DIR` go through the same detection and readers
byte for byte. The only addition is where the company comes from: a file in a subfolder
`INPUT_DIR/<Company name>/` takes the folder name as its company. Otherwise it uses the single
saved company that has that unit #. The produced ProMiles file (contract 2) is identical to a
portal conversion.

**Source approval:** a saved company converts automatically only from its approved source
formats. Its first conversion approves that format. A later file in another format (the owner
moved ELD providers) is held, in the portal and the input folder alike, until the user confirms
the switch, which approves the new format too. The Companies tab shows and edits the list.

---

## 1. Wialon "IFTA Single Unit Mileage Report" export — v2  *(read in)*

- **Source:** Wialon Hosting (`hosting.wialon.us`) → the *IFTA Single Unit Mileage Report* for one
  unit, exported as CSV. Upload the file **exactly as Wialon names it**:
  `<unit>_IFTA_Single_Unit_Mileage_Report_<MM-DD-YYYY>_<hh-mm-ss>_<am|pm>.csv`
  (e.g. `22_IFTA_Single_Unit_Mileage_Report_11-06-2026_05-16-23_pm.csv`).
- **Unit #:** **only in the file name** — everything before `_IFTA_Single_Unit_Mileage_Report`
  (`22`, `29-LB`, `65-GOLDEN`). A browser copy suffix like ` (1)` is fine. No unit in the name → the portal asks
  for it (the file is still read). **No company name** anywhere in the report → always entered or
  picked in the portal.
- **Encoding:** Windows codepage (the `№` header byte is `0xB9`), so not UTF-8; we decode as UTF-8
  when valid, else Latin-1. All data cells are ASCII. **CRLF**, every cell quoted.
- **Delimiter:** **semicolon**, with a trailing `;` on every line (an empty 7th column).
- **Header:** `"№";"Grouping";"Mileage";"Time in";"Time out";"Total time";` — columns 2–5 are checked
  (column 1's byte varies by codepage; "Total time" is ignored).
- **Rows are a numbered hierarchy** in column 1:

  | № | Grouping | Meaning | We use it as |
  |---|---|---|---|
  | `1`, `2`, … | month name (`October`) | month group; Time in/out = first/last data that month | **one trip**; dates = its Time in/out; Mileage = check total |
  | `1.1`, `1.2`, … | state/province name (`North Dakota`) | total for that state in the month; Time in = first entry | **one leg**; Mileage → ProMiles distance |
  | `1.1.1`, … | a timestamp | one border crossing / visit | **skipped** (the state row already totals them; may have decimals like `4.34 mi`) |
  | `----` | `Total` | grand total for the report | period for a report with no month grouping; check total |

  A report **not grouped by month** has state rows at the top level (`1`, `2`, …); it becomes one
  trip spanning the `Total` row's dates. A quarterly report has `1` Oct, `2` Nov, `3` Dec → three trips.
- **Mileage:** `"<number> mi"` or `"<number> km"` (thousands separators and decimals allowed).
  State totals are whole numbers in practice; Wialon rounds each total independently, so month
  totals can differ from the sum of states by a mile or two.
- **Dates:** `YYYY-MM-DD HH:MM:SS` (wall clock, no zone). Written to ProMiles as `M/D/YYYY`.
- **Can't convert (shown on the file; nothing written):** wrong header (including the
  old hand-edited comma format), unknown state/province, impossible date, unparseable mileage, a
  state twice in one month, miles and km mixed, the same unit + month in two uploaded files, no state
  rows at all.
- **Warnings (file still written):** state rows differ from their month total, or months from the
  `Total` row, by more than max(5, 1%); no month and no `Total` row (dates fall back to the
  earliest/latest state dates); a month with no state rows (skipped); an odometer for a unit not in
  the upload; a saved odometer that isn't before the upload (not used), or one that leaves
  unconverted months in between (used, so Begin Odo is short by their miles).
- **v1 (retired 2026-11-06):** a hand-edited comma CSV (`Unit#,Begin Date,End date,State,Toll
  Distance`) made from this report. It is no longer accepted; always upload the raw export.

## 2. ProMiles TRIPSUMMARY2 import — v1  *(write out)*

- **Target:** Multi-Fleet FuelTaxOnline (`multifleetfueltax.promilesonline.com`) → Import Data →
  Upload. Template: "Template to import trip summaries" (example file:
  `apps/api/test/fixtures/promiles_tripsummary2_example.csv`).
- **Encoding:** ASCII/UTF-8 **without** BOM, LF line endings, 12 columns, standard CSV quoting.
- **Line 1:** `###TRIPSUMMARY2` followed by 11 empty cells.
- **Line 2 (header):** `Unit#, Begin Date, End date, Begin Odo, D(istance) or O(dometer),
  M(iles) or K(ilometers), State, Distance or Odometer, Toll Distance, Empty(Y/N), Off Road(Y/N),
  "Permitting (None, IFTA, Mile, Both)"`.
- **One file per company:** ProMiles imports a file under one customer ("Editing Customer"), so
  trucks of different companies are never mixed in one file.
- **Trips:** one trip per truck (company + unit #) per month (in date order). The first row carries the trip columns (A–F); each further state leg
  leaves A–F blank.

| Col | Field | We write |
|---|---|---|
| A | Unit# | the unit # (from the source file or its name, or entered in the portal) |
| B / C | Begin / End date | the month row's Time in / Time out (or the `Total` row's), `M/D/YYYY` |
| D | Begin Odo | for the truck's first trip: the odometer entered in the portal, else the truck's saved end odometer from its last conversion (only when this trip starts after that period ended); then carried forward (+ that trip's miles) to each later month; else **`1`** |
| E | D or O | `D` (distance mode) |
| F | M or K | from the mileage suffix (`mi` → `M`, `km` → `K`) |
| G | State | 2-letter code (US states, DC, Canadian provinces/territories) |
| H | Distance or Odometer | the state row's Mileage, number only |
| I | Toll Distance | `0` |
| J / K | Empty / Off Road | `n` / `n` |
| L | Permitting | blank |

- **Hard rule found on import:** *"Rows A through I must have a value. Trip not saved."* — every
  trip row must have A–I filled, including **Begin Odo**. `1` is the placeholder ProMiles' own
  example uses and imports cleanly; a real start-of-period reading is better for reports.
- **Leg order:** by first entry into each state (approximates the route).
- **Output file name:** company name + unit # + period:
  `<Company>_unit-<N>_<YYYY-MM>.csv`, e.g. `ACME-TRUCKING-LLC_unit-22_2026-10.csv`.
  Several months: `…_2026-10_to_2026-12.csv`; several trucks: `units-22-25-30` or `N-units`.
  Characters outside `A–Z a–z 0–9` become `-`;
  never overwritten — repeats get `_2`, `_3`, ….

> **Design consequence:** the converter is a pure function (`convert()`), versioned with these
> contracts and covered by a sample raw export (made up, in the exact Wialon format) plus the
> golden ProMiles file it must reproduce byte for byte (`apps/api/test/fixtures/`); the HTTP
> layer only uploads, decodes, validates and saves.

---

## 3. "IFTA Mileage By State" export — v1  *(read in)*

- **Status (2026-11-07):** the real Bellfam ELD and HOS247 samples convert without warnings.
  Importing a converted file into FuelTaxOnline is still to be confirmed (MANUAL_TODO §C).
- **Sources:** **Bellfam ELD** (`bellamsp-anir`) and **HOS247** (`hos247`), two separate sources
  that export this identical layout. Nothing in the file tells them apart, so:
  - if the file's company (its `Carrier:`) was converted from exactly one of the two before,
    that one is used;
  - otherwise the file waits with `needs: format` and `formatOptions: [bellamsp-anir, hos247]`
    (portal and input folder alike) until the user picks. That pick approves the source for
    the company, so its next files in this layout go straight through.
  - A company switching between these two can't be noticed from the file; pick the source by
    hand for that file (choosing a source always wins over detection).
- **File:** one vehicle and one period per file, named
  `Vehicle-<unit #>-<last 6 of VIN>-mileage-report_<YYYYMMDD>-<YYYYMMDD>_<timestamp>.csv`.
  Comma-separated, ASCII/UTF-8, LF line endings, no BOM, no final newline (CRLF is accepted).
- **Layout** (fixture: `apps/api/test/fixtures/Vehicle-7-123456-mileage-report_…csv`, made up):

  ```
  IFTA Mileage By State
  Summary of total mileage by state for all equipment
  Carrier: ACME TRUCKING LLC
  Period: 2026/10/01 - 2026/10/31
  Report Generated: 2026/11/07 9:15:30 am
  Vehicle,Name,Make,Model,Year
  1FAKEVIN0LJ123456,7,Freightliner,Cascadia,2019
  State,Miles
  AR,412.48
  MO,388.5
  …
  ```

- **Detection:** the first line is `IFTA Mileage By State` and a `State,Miles` line follows
  (matches both sources; see above).
- **Company:** the `Carrier:` line. **Unit #:** the vehicle row's `Name`, else the file name's
  `Vehicle-<unit #>-`. With several vehicle rows, the unit # is left for the user (warning).
- **Trip:** the whole `Period:` is **one trip** (Begin/End Date = the period's first and last day).
  This export has no per-month split, so a period longer than a month gets a warning.
- **Legs:** one per state row, in file order (no per-state dates). States are 2-letter codes (full
  names also accepted).
  - **Miles are rounded to whole miles, half up** (`388.5` → `389`), as IFTA reports and the
    Wialon file that imported cleanly use whole miles. The exact sum is kept as the report's
    total for the review's cross-check.
- **Can't convert:** no `Period:` line, an impossible date, a period that ends before it starts,
  an unknown state, a state twice, an unreadable mileage, no state rows.
- **Output:** contract 2, unchanged: e.g. `ACME-TRUCKING-LLC_unit-7_2026-10.csv`
  (`apps/api/test/fixtures/promiles_expected_ifta_by_state_unit7_oct2026.csv`, hand-derived).

---

## 4. Ezlogz "Mileage Report" export — v1  *(read in)*

- **Status (2026-11-07):** four real Ezlogz samples (one unit each, October 2026, one of them a
  team truck with two drivers) convert without warnings; their daily rows add up exactly to the
  unit's state totals. Importing a converted file into FuelTaxOnline is still to be confirmed
  (MANUAL_TODO §C).
- **Source:** **Ezlogz** (`ezlogz`).
- **File:** `Mileage_Report.csv` (the browser adds ` (1)`, ` (2)`, … to repeat downloads; the name
  carries nothing). Comma-separated, ASCII/UTF-8, LF line endings with a final newline, no BOM
  (CRLF is accepted). **No company and no period line** in the file.
- **Layout** (fixture: `apps/api/test/fixtures/Mileage_Report.csv`, made up): four sections, one
  after the other, each opened by its own header row. Full state names; miles carry a ` mi`
  suffix (`305 mi` in the first section, `305.0 mi` in the others).

  ```
  State,Miles                       ← per state, alphabetical
  Illinois,365.6 mi
  …
  Total distance:,2593.5 mi
  Driver,State,Miles                ← per driver: a total row (empty State), then its states
  John Doe,,1767.1 mi
  John Doe,Texas,433.2 mi
  …
  Units,State,Miles                 ← per unit: a total row (empty State), then its states
  52,,2593.5 mi
  52,Texas,433.2 mi
  …
  Date,State,Driver,Unit,Miles      ← per day: a total row (only Date + Miles), then its states
  2026-10-03,,,,531.1 mi
  2026-10-03,Texas,John Doe,Texas,120.4 mi
  …
  ```

  - In the daily rows **the `Unit` column repeats the state name**, not the unit #. That's how
    Ezlogz writes it; the column is ignored.
  - A team truck lists each driver's rows for the same day one after the other, so the order
    within a day is by driver, not by route.
- **Detection:** the first line is `State,Miles` and a `Total distance:,` line follows within the
  first 4 KB (the "IFTA Mileage By State" export of §3 starts with its title line instead).
- **Company:** never in the file: the user's entry, the input subfolder, or the single saved
  company with that unit # (as for Wialon). **Unit #:** the Units section's total row.
- **Trips:** from the daily rows, **one trip per month**. Begin/End Date are the month's first and
  last day driven (as with Wialon), since the file has no period line. A multi-month export
  splits into months by itself.
- **Legs:** one per state per month, ordered by first entry (first day in that state, file order
  within a day). Each leg's miles are that month's daily rows for the state, summed, then
  **rounded to whole miles, half up** (as in §3). The exact sum of the month's daily total rows is
  kept as the report's total for the review's cross-check.
- **Cross-check:** the unit's state totals (Units section) must match the daily rows summed per
  state, else a warning names the states. ProMiles gets the daily rows. The State and Driver
  sections are not read.
- **Can't convert:** no Units section, **more than one unit** (the daily rows don't say which unit
  drove them: export one unit per report), no daily rows, an unknown state, an unreadable date or
  mileage, miles and kilometres mixed.
- **Output:** contract 2, unchanged: e.g. `ACME-TRUCKING-LLC_unit-52_2026-10.csv`
  (`apps/api/test/fixtures/promiles_expected_ezlogz_unit52_oct2026.csv`, hand-derived).

---

## 5. Motive · Swift ELD · Vista ELD — not yet specified  *(read in)*

- **Status:** placeholders. The portal lists them in the "Source format" picker (marked coming
  soon). They never auto-detect, and choosing one says the importer isn't built yet.
- **Samples:** real exports for each are kept locally (git-ignored, never committed). Seen so
  far:
  - **Motive:** CSVs `distance_summary_by_vehicle` (`Vehicle,Jurisdiction,Distance (mi),Fuel (gal)`)
    and `trip_reports_detail_by_vehicle`;
  - **Swift ELD** and **Vista ELD:** `IFTA_Report*.xls`, legacy Excel (needs an Excel reader).
- **To specify each:** record the delimiter or sheet, the header, where the state, miles, dates,
  unit # and company name live, the encoding, and how totals and sub-rows are laid out. Then
  follow ROADMAP.md → "Source importers" with a made-up fixture in the same format.

---

## Change management

External owners can change these formats without notice. On any change: update this file,
bump the contract version above, update `wialon-to-promiles.ts` and its spec (add the new raw sample,
under the name Wialon gave it, to `apps/api/test/fixtures/`), re-verify with a real import, record it in CHANGELOG.md, and refresh
**Last verified** above.
