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
| 3 | "IFTA Mileage By State" export (CSV): Bellfam ELD, HOS 247 and Quick E Logs (same layout) | read in | `importers/ifta-mileage-by-state.ts` |
| 4 | Ezlogz "Mileage Report" export (CSV) | read in | `importers/ezlogz.ts` |
| 5 | Motive "IFTA Trip Report" detail and "distance summary" exports (CSV), one or more trucks | read in | `importers/motive.ts` |
| 6 | "IFTA Report" Excel workbook (.xls): Swift ELD and Vista ELD (same layout) | read in | `importers/ifta-spreadsheet.ts` (+ `conversion/xls.ts`) |
| 7 | Forza ELD "IFTA Mileage by State" (CSV) | read in | `importers/forza-eld.ts` |
| 8 | Big Road "Vehicle Mileage" (.xls) | read in | `importers/big-road.ts` (+ `conversion/xls.ts`) |

**Format detection:** each uploaded file is offered to every built importer's `detect()` (cheap
header sniffing on the raw bytes). One match is used. Several (a layout two sources share) are
settled by the company's approved source when it is one of them, else the user picks. No match:
the company's approved source is tried when the company is known (typed, or matched from a typed
unit #), else the user picks the format. The **company** and **unit #** come from the file or its
name when the format carries them (Wialon: unit from the name, no company). Otherwise the company
is the single saved company running the file's unit # (several: the user picks one of them), and
the user types or picks from the saved lists what is still missing. A file with no dates of its
own (Motive's distance summary or Big Road) also needs the period it covers from the user. A file may hold several trucks: each then converts as its own
truck with the unit # the file gives it.

**Watched input folder:** files dropped in `INPUT_DIR` go through the same detection and readers
byte for byte. The only addition is where the company comes from: after the file's own company, a
file in a subfolder `INPUT_DIR/<Company name>/` takes the folder name as its company. Otherwise it
uses the single saved company that has that unit # (every one of them, for a file with several
trucks); several such companies, and the file waits for the user to pick. The
produced ProMiles file (contract 2) is identical to a portal conversion.

**Source approval:** each saved company has **one** approved source format and converts
automatically only from it. Its first conversion approves that format. A later file in another
format (the owner moved ELD providers) is held, in the portal and the input folder alike, until
the user confirms the switch, which makes the new format the approved one, **replacing** the old.
The Companies tab shows it and sets it (a single choice; a new pick replaces the old).

**Conversion history:** every report written to a ProMiles file is logged in Postgres
(`conversions`), one row per truck per source file: company, unit #, source, file names, the dates
it covers, Begin/End odometer (null when the placeholder was used) and total miles, with each
trip. Exact CSV snapshots, exported state-leg detail, recovery and company PDF rules are in
[reporting.md](reporting.md) v1. It is internal to Haul Book, not an external contract: `GET /api/v1/history` and
`GET /api/v1/trucks/:id` (`packages/shared/src/contracts/history.ts`).

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

## 2. ProMiles TRIPSUMMARY2 import — v2  *(write out)*

> **v2 (2026-11-11):** column A is the truck's **ProMiles unit #**, which can differ from the
> truck # in the source (Motive's `Volvo 01` → `2011`), and the file name shows both when they
> differ. Unchanged for every truck whose ProMiles unit # is its own number.

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
| A | Unit# | the truck's **ProMiles unit #**: its own when one is saved on the truck (`Unit.promilesUnit`) or entered for this file (`SourceChoice.promilesUnits`), else its truck # (from the source file or its name, or entered in the portal). A truck not saved yet waits (`needs: promilesUnit`) until the user confirms it, in the portal and the input folder alike; two trucks of one company never share one |
| B / C | Begin / End date | the month row's Time in / Time out (or the `Total` row's), `M/D/YYYY` |
| D | Begin Odo | the odometer entered in the portal for the truck's first trip, carried forward (+ each trip's miles) to later months; else, for a trip whose source records the odometer (Motive), its own start reading (the next trip carries on from its end reading); else, for the truck's first trip, its saved end odometer from its last conversion (only when this trip starts after that period ended), then carried forward; else **`1`** |
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
  The unit #s are the ProMiles ones; when any differs from the truck # in the source, those
  follow: `ACME-TRUCKING-LLC_unit-2011_from-Volvo-01_2026-10.csv`,
  `…_units-2011-22_from-Volvo-01-22_…` (not for `N-units`).
  Characters outside `A–Z a–z 0–9` become `-`;
  never overwritten — repeats get `_2`, `_3`, ….

> **Design consequence:** the converter is a pure function (`convert()`), versioned with these
> contracts and covered by a sample raw export (made up, in the exact Wialon format) plus the
> golden ProMiles file it must reproduce byte for byte (`apps/api/test/fixtures/`); the HTTP
> layer only uploads, decodes, validates and saves.

---

## 3. "IFTA Mileage By State" export — v2  *(read in)*

- **Status (2026-11-07):** the real Bellfam ELD and HOS 247 samples convert without warnings.
  Importing a converted file into FuelTaxOnline is still to be confirmed (MANUAL_TODO §C).
- **v2 (2026-11-11):** Quick E Logs added; all four local samples read with the same parser.
- **Sources:** **Bellfam ELD** (`bellamsp-anir`), **HOS 247** (`hos247`) and
  **Quick E Logs** (`quick-e-logs`), three separate sources
  that export this identical layout. Nothing in the file tells them apart, so:
  - if the file's company (its `Carrier:`) has one of the three as its approved source, that one
    is used;
  - otherwise the file waits with `needs: format` and `formatOptions: [bellamsp-anir, hos247, quick-e-logs]`
    (portal and input folder alike) until the user picks. That pick becomes the company's
    approved source, so its next files in this layout go straight through.
  - A company switching between these three can't be noticed from the file; pick the source by
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
  (matches all three sources; see above).
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

## 5. Motive exports: trip report detail and distance summary — v2  *(read in)*

- **Status (2026-11-07):** six real Motive trip reports (October 2026, one holding two trucks)
  convert. The only warning is a real one: a truck's odometer moving with no state rows for a
  week. The real distance summary sample (one truck, 16 states) converts once a period is given.
  Importing a converted file into FuelTaxOnline is still to be confirmed (MANUAL_TODO §C).
- **Source:** **Motive** (`motive`), for both exports: a company approved for Motive takes either.
- Both exports: comma-separated, ASCII/UTF-8, LF line endings with a final newline, no BOM (CRLF is
  accepted); full state names; miles with 2 decimals (`Distance (km)` makes it kilometres); **no
  company**. Columns are found by their header names, so a reordered or extra column still reads.
  The unit # is the `Vehicle` cell as written (`Volvo 7`). A file may hold several vehicles.
- **Company:** never in the file: the user's entry, the input subfolder, or the single saved
  company that runs **every** unit # in the file (several such companies: the user picks).
- **Several trucks per file:** each vehicle converts as its own truck (`SourceFile.units`, and
  `unit` is null). They share the file's company, so they land in one ProMiles file
  (`ACME-TRUCKING-LLC_units-Volvo-7-31_2026-10.csv`). A unit # typed for such a file is ignored.

### 5a. IFTA Trip Report detail

- **File:** `<timestamp>-trip_reports_detail_by_vehicle.csv`. **No period line.**
- **Layout** (fixture: `apps/api/test/fixtures/1794000000-trip_reports_detail_by_vehicle.csv`, made
  up): one header row, then one row per state segment, **newest first**, each vehicle's rows in
  a block of their own.

  ```
  Date,Vehicle,Jurisdiction,Distance (mi),Odometer Start,Odometer End,Manual Odo Edit,Latitude Start,Longitude Start,Latitude End,Longitude End
  "Oct 7, 2026",Volvo 7,Texas,312.80,"431,847","432,160",No,33.8732410,-97.1259873,32.7766642,-96.7969879
  …
  "Oct 14, 2026",31,Idaho,54.99,"1,206,093","1,206,148",No,43.5872103,-116.5636208,43.6150186,-116.2023137
  ```

  - Dates are `Mon D, YYYY`, quoted; odometers in whole miles with thousands separators, quoted.
- **Detection:** the header starts `Date,Vehicle,Jurisdiction,Distance (mi|km),Odometer Start,
  Odometer End`.
- **Trips:** each vehicle's rows, in odometer order, make **one trip per month**, from its first to
  its last day driven (no period line, as with Ezlogz). Within a day the file is newest first,
  so the odometer, not the file order, sets the route order.
- **Legs:** one per state per month, ordered by first entry; that month's rows for the state
  summed, then **rounded to whole miles, half up**. The exact sum is kept as the report's total.
- **Odometer:** the month's first `Odometer Start` and last `Odometer End` are the trip's own
  odometer (`fileOdometer`). Begin Odo is the start reading **unless one is typed** for the
  truck, and the end reading is what's saved for its next conversion (contract 2, column D).
  - A warning lists every jump of more than 10 mi between consecutive rows (`+507 mi between Oct
    5, 2026 and Oct 6, 2026 (1,093 → 1,600)`): those miles are in no state, so check the ELD before
    filing.
  - A warning names the days with `Manual Odo Edit` = Yes.
- **Can't convert:** no trip rows, a row with no vehicle, an unknown state, an unreadable date,
  mileage or odometer.
- **Output:** contract 2, unchanged
  (`apps/api/test/fixtures/promiles_expected_motive_2trucks_oct2026.csv`, hand-derived).

### 5b. Distance summary by vehicle

- **File:** `<timestamp>-distance_summary_by_vehicle.csv`, the timestamp being when it was
  exported (Unix seconds; 13 digits = milliseconds). **No dates and no odometer at all.**
- **Layout** (fixture: `apps/api/test/fixtures/1794000000-distance_summary_by_vehicle.csv`, made
  up): one header row, then one row per vehicle and state (Motive lists the states
  alphabetically).

  ```
  Vehicle,Jurisdiction,Distance (mi),Fuel (gal)
  12,Idaho,786.85,0.000
  12,Montana,"1,480.50",0.000
  ```

  - Distances over 999 have thousands separators and are quoted. `Fuel (gal)` is not read.
- **Detection:** the header starts `Vehicle,Jurisdiction,Distance (mi|km)`.
- **Period:** the user gives the dates the export covers (`SourceChoice.period`, `YYYY-MM-DD`,
  both included). Until then the file `needs: period` (portal and input folder alike). The whole
  month before the export timestamp is offered as `suggestedPeriod` (exported Nov 6, 2026 →
  Oct 1–31, 2026), but never used without the user. The period must stay inside **one quarter**.
- **Trips:** **one trip per vehicle over the period** (a summary can't be split by month): Begin
  and End date are the period's. The same truck can't have another trip in any month the period
  touches, in the same upload (contract 2's "more than one file" check spans the months).
- **Legs:** one per state, in file order; a state listed twice is summed; **whole miles, half
  up**. The exact sum is kept as the report's total.
- **Odometer:** none in the file, so Begin Odo follows contract 2 (typed → saved → `1`).
- **Can't convert:** no distance rows, a row with no vehicle, an unknown state or an unreadable
  mileage.
- **Output:** contract 2, unchanged
  (`apps/api/test/fixtures/promiles_expected_motive_summary_2trucks_oct2026.csv`, hand-derived).

---

## 6. "IFTA Report" Excel workbook: Swift ELD and Vista ELD — v1  *(read in)*

- **Status (2026-11-07):** the 9 real samples (2 Swift ELD, 7 Vista ELD, October 2026, one truck
  each) convert without warnings. Importing a converted file into FuelTaxOnline is still to be
  confirmed (MANUAL_TODO §C).
- **Sources:** **Swift ELD** (`swift`) and **Vista ELD** (`vista-eld`), two separate sources that
  export this identical workbook (same generator, "Java Excel API"). As with contract 3, the
  company's approved source settles which; otherwise the file waits with `needs: format` and
  `formatOptions: [swift, vista-eld]` until the user picks, and the pick becomes the company's
  approved source.
- **File:** `IFTA_Report*.xls`: legacy **Excel 97–2003 (BIFF8)** in an OLE2 compound file. Read by
  `apps/api/src/conversion/xls.ts` (cell values only; no formatting). `.xlsx` is not this format.
- **Sheets:** `IFTA Spreadsheet` (per-state tax summary for all trucks, fuel columns zero): not
  read. **`All trucks`**: read. Its layout (0-based rows; columns A, B, …):

  | Row | Cells |
  |---|---|
  | 1 | B `Oct 01, 2026 - Oct 31, 2026` · D `Company Name: ACME TRUCKING LLC` |
  | 2 | B `IFTA by Vehicles: 0412` · D `Address: …` |
  | 3 | D `Phone: …` |
  | 6 | `Truck` · `State/Province` · `Total Miles` [· `Total Kilometers`] |
  | 7… | `0412` · `AR` · `72.49` [· km] — one row per truck and state, states alphabetical |
  | | `0412` · `TOTAL` · `3428.17` — after each truck's rows |

  - The header row is found by its three column names; the period and company are found in any
    cell above it. The period is `Mon DD, YYYY - Mon DD, YYYY`. The Truck cell is text (`0412`
    keeps its leading zero). Miles are numbers with up to 2 decimals.
- **Detection:** an `.xls` name, an OLE2 file, and an `All trucks` sheet with that header.
- **Company:** the `Company Name:` cell. **Unit #:** each `Truck` value; a file with several trucks
  converts each as its own truck (`SourceFile.units`), sharing one ProMiles file.
- **Trips:** the export has no per-month split, so the period becomes **one trip per truck**,
  every leg spanning it (a multi-month period warns, as in contract 3).
- **Legs:** one per state in file order, **rounded to whole miles, half up**. The truck's `TOTAL`
  row is kept as the report's total (the sum of the exact miles when it's missing).
- **Odometer:** none in the file, so Begin Odo follows contract 2 (typed → saved → `1`).
- **Can't convert:** not a readable BIFF8 `.xls`, no `All trucks` sheet with that header, no
  period, a period ending before it begins or an impossible date, a row with no Truck, an
  unknown state, a state twice for one truck, unreadable miles, no state rows.
- **Fixture:** made up and built in code, not a file: `apps/api/test/helpers/ifta-report.ts`
  (cell for cell like the real workbook, via the test-only `xls-writer.ts`). Golden output:
  `apps/api/test/fixtures/promiles_expected_ifta_report_unit0412_oct2026.csv` (hand-derived).

---

## 7. Forza ELD "IFTA Mileage by State" — v1 *(read in)*

- **Source/id:** Forza ELD (`forza-eld`). Verified against three local exports on 2026-11-11;
  actual FuelTaxOnline import remains an owner check (MANUAL_TODO §C).
- **File:** CSV, LF or CRLF, optional BOM. Filenames are arbitrary and never supply a truck.
- **Detection:** title `… - IFTA Mileage by State`, then `Name,Make,Model,Year` and `State,Miles`.
- **Layout** (fictional fixture `apps/api/test/fixtures/forza_ifta.csv`):

  ```text
  FORZAP - IFTA Mileage by State
  Summary of total mileage by state for selected vehicle
  Carrier: ACME TRUCKING LLC
  Period: 10/01/2026 - 10/31/2026
  Report generated: 11/08/2026 05:08
  VIN: 1FAKEVIN0LJ000007
  Vehicle info
  Name,Make,Model,Year
  07,VOLVO,VNL,2018
  State,Miles
  AR,412.49
  MO,388.50
  ```

- **Company/truck:** `Carrier:` and the one vehicle's `Name`, preserving leading zeros.
  Missing values are left for normal company resolution/user entry; VIN is never the truck #.
- **Period:** `MM/DD/YYYY - MM/DD/YYYY`, inclusive; generation date is ignored. One trip for
  the whole period, with a warning when it spans months (no monthly allocation in the export).
- **Miles:** one state leg per row in file order, whole miles half up. The exact sum is the
  reported total. No odometer reading is supplied. Invalid/reversed dates, duplicate or unknown
  states, malformed distances and multiple vehicle rows are refused.
- **Output:** contract 2; golden `promiles_expected_forza_oct2026.csv`.

## 8. Big Road "Vehicle Mileage" — v1 *(read in)*

- **Source/id:** Big Road (`big-road`). All four local samples inspected on 2026-11-11.
  Two have only known-state mileage; two are refused for positive Unknown mileage.
- **File:** legacy Excel `.xls` (OLE2/BIFF8), read through the existing in-house `xls.ts`.
  Fictional workbooks are built by `test/helpers/big-road-report.ts`; never commit real exports.
- **Sheets:** `Summary` (Truck / Mileage (mi) / Exceptions), `Vehicle Mileage`, and optionally
  `Exceptions` (Truck / Start date / End date / Message). The latter contains diagnostic dates
  and messages, not the report period or usable beginning odometer readings.
- **Detection:** `Vehicle Mileage` sheet with first-row `Truck` and `Total (mi)` headers.
  Other columns are state/province codes and optionally `Unknown`. Kilometre exports are not
  supported by this contract.
- **Rows:** one per truck, e.g. `007 | 120.5 | 230.4 | 350.9` under
  `Truck | OR | WA | Total (mi)`. The final `Total` row is a fleet aggregate and is ignored.
  Duplicate truck rows and duplicate/unknown state columns are refused. Blank state cells
  mean zero; zero-distance legs and zero-mileage trucks are omitted.
- **Company/period:** neither exists in the workbook. Resolve the company by normal user,
  folder or saved-truck rules; otherwise ask. Always require an explicit period within one
  quarter (`needs: period`), with no suggested period. Never use the filename's export date or
  exception dates. Each truck gets one trip covering the confirmed period.
- **Unknown policy:** any positive Unknown mileage refuses the entire file, naming the truck
  and mileage and asking for the source report to be corrected. Never drop it or assign a state.
  Blank/zero Unknown is accepted. Negative or unreadable distances are refused.
- **Output:** each truck remains separate, with its own saved/confirmed ProMiles unit #.
  State miles round half up; `Total (mi)` is retained for the writer's total cross-check.
  No source odometer is supplied. Golden single-truck output: `promiles_expected_big_road_oct2026.csv`.

## Change management

External owners can change these formats without notice. On any change: update this file,
bump the affected contract version above, update its importer and specs (add a fictional fixture
matching the new layout to `apps/api/test/fixtures/` or `test/helpers/`), re-verify with a real import, record it in CHANGELOG.md, and refresh
**Last verified** above.
