# ROADMAP — Haul Book

> Only work **not yet built**. When an item ships, delete it here and add a dated CHANGELOG entry.
>
> **Last groomed:** 2026-11-11

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
