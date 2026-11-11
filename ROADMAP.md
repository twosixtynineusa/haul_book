# ROADMAP — Haul Book

> Only work **not yet built**. When an item ships, delete it here and add a dated CHANGELOG entry.
>
> **Last groomed:** 2026-11-11

## Next — unit # mapping (source unit # → ProMiles unit #)

The source's unit # is kept exactly as the provider exports it (e.g. Motive's `Volvo 01`,
`Volvo 22`). Only the unit # **written to the ProMiles CSV** can differ, and the user sets it.
Usually it's just a number, but not always the source's digits: `Volvo 01` → `2011`,
`Volvo 22` → `22`. So each truck gets a second field, its **ProMiles unit #**:

- **Two fields per truck:** *Source unit #* (from the file, read-only, how files are matched to
  the truck) and *ProMiles unit #* (what the output carries). The ProMiles unit # defaults to
  the source unit # (1:1), so nothing changes for trucks the user never touches. The portal
  calls a truck's own number "Truck #" (since 2026-11-11); label the pair e.g. "Truck # (from
  the source)" and "ProMiles unit #", since "unit" stays the ProMiles / Excel word.
- **At first import:** for a truck not saved yet, the portal and input-folder forms show the
  ProMiles unit # next to the detected source unit #, prefilled 1:1 and editable. The user
  confirms it (or changes it) before the file converts; it's saved on the truck. For a file
  with several trucks (Motive), one row per truck. Once saved, later files convert without
  asking.
- **Later:** the Companies tab's truck detail (and the truck page) shows both fields; the
  ProMiles unit # can be edited there any time. A change applies to the next conversion; past
  ProMiles files and history rows keep what was written.
- **What uses which:** matching (company lookup by unit #, `ownersOfUnits`) and the truck's
  identity use the **source** unit #; the ProMiles CSV's unit # column uses the **ProMiles**
  unit #. Decide before building whether the output file name (`<Company>_unit-<N>_…`) and the
  History tab show the ProMiles unit #, the source one, or both.
- **Guard:** two trucks of one company may not share a ProMiles unit #. The edit is refused
  (it would merge two vehicles' miles in ProMiles). The same goes for moving a truck to
  another company (`CompaniesService.moveTruck`): refuse it when its ProMiles unit # is taken there.
- Needs a schema change (e.g. `Unit.promilesUnit`, null = same as the source), a migration,
  shared contract fields (`Truck`, the file's units in `SourceFile` / `InboxEntry`,
  `SourceChoice`), and a docs/data-contracts.md note on the output's unit # column.

## Next — source importers (new providers)

Every provider with a sample export is built (Wialon, Bellfam ELD, Ezlogz, HOS 247, Motive,
Swift ELD, Vista ELD). Three more providers have real samples in `New folder/` (git-ignored,
never committed):

- **Quick E Logs** (`Quick E Logs/`, 4 monthly CSVs, one truck each): the **same layout** as
  Bellfam ELD / HOS 247 ("IFTA Mileage By State", `Carrier:`, `Period: YYYY/MM/DD - …`, a
  Vehicle/Name/Make/Model/Year row, then State,Miles; file named `Vehicle-<N>-…-mileage-report_…`).
  Mostly a new id: add it to the shared-layout importer (`ifta-mileage-by-state.ts`), so such a
  file gets three `formatOptions` and the company's approved source settles it.
- **Forza ELD** (`FORZA-ELD/`, 3 monthly CSVs, one truck each, random file names): its own
  layout. A title line (`… - IFTA Mileage by State`), `Carrier:`, `Period: MM/DD/YYYY - MM/DD/YYYY`,
  `Report generated:`, `VIN:`, then a `Name,Make,Model,Year` row whose **Name is the unit #**,
  then `State,Miles` rows. Company and unit come from the file, never the file name. Detect on
  the title line + the `Name,Make,Model,Year` / `State,Miles` headers.
- **Big Road** (`big road/`, 4 files): **legacy Excel `.xls`, not CSV**, so it uses
  `conversion/xls.ts`. Sheets `Summary`, `Vehicle Mileage` and sometimes `Exceptions`
  (Truck / Start date / End date / Message). Mileage in miles, with a `Total` and possibly an
  **`Unknown`** jurisdiction column (miles from odometer readings with no GPS state). Decide how
  `Unknown` miles are handled before building (warn and leave them out, or refuse the file);
  never assign them to a state. Read the real layout from the samples with a temporary spec
  first: whether it holds one or several trucks, and whether it names the company (if not, the
  file `needs: company`). The file name's date is the export date, not the period.

When a sample from a new provider arrives (kept locally, git-ignored, MANUAL_TODO §B):

1. Add `importers/<provider>.ts` implementing `Importer`:
   - `detect()` is a cheap, never-throwing check on the raw bytes (header row, sheet name, …).
   - `read()` returns trips per month (or per period) and state, plus the **company name and
     unit #** when the file or its name carries them.
2. Add its id to `SOURCE_FORMATS` / `SourceFormatIdSchema` (`packages/shared/src/contracts/sources.ts`)
   and register it in `importers/index.ts`. A provider listed before its importer exists gets
   `available: false` and an importer whose `read()` explains it isn't built yet.
3. Add a **made-up** export in the exact same format (never the real sample): a file in
   `apps/api/test/fixtures/`, or for Excel a builder in `test/helpers/` using `xls-writer.ts`;
   a spec; and a hand-derived golden ProMiles file.
4. Document the format in `docs/data-contracts.md` and log it in CHANGELOG.

- **Modern Excel (.xlsx) reading:** `conversion/xls.ts` reads legacy `.xls` (BIFF8) only. The
  first provider exporting `.xlsx` needs a reader for it (a zip of XML sheets).

## Next — portal

- **Input folder notifications:** a desktop or email alert when a file lands in "needs input", so
  nobody has to keep the portal open.
- **Quarter guard:** warn when an upload mixes months from different quarters. Month trips never
  cross a quarter themselves, but ProMiles' "force trips into year/quarter" option would then be
  wrong.
- **Pull straight from Wialon:** run the IFTA Single Unit Mileage Report through the Wialon Remote
  API instead of exporting CSVs by hand (needs an API token; see MANUAL_TODO).

## Later

- **Fuel purchases import:** a converter for ProMiles' fuel purchase template.
